import logging
import os
import secrets
from contextlib import asynccontextmanager
from datetime import timedelta
from time import perf_counter
from uuid import uuid4

from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from fastapi import FastAPI, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy import inspect, insert
from sqlalchemy.exc import SQLAlchemyError
from starlette.exceptions import HTTPException

from app.core import APIError, token_digest, utc_now
from app.database import BACKEND, metadata, open_engine, sessions
from app.graph_api import router as graph_router
from app.import_api import ImportWorker, router as import_router
from app.learning_api import router as learning_router
from app.model import AILimit, ModelProvider

logger = logging.getLogger('uvicorn.error')


class SessionRequest(BaseModel):
    pass


def error_response(status, code, message, headers=None):
    return JSONResponse({'error': {'code': code, 'message': message}}, status, headers)


@asynccontextmanager
async def lifespan(app: FastAPI):
    engine = open_engine()
    worker = None
    provider = None
    try:
        heads = ScriptDirectory.from_config(Config(BACKEND / 'alembic.ini')).get_heads()
        with engine.connect() as connection:
            applied = MigrationContext.configure(connection).get_current_heads()
            if set(applied) != set(heads) or not set(metadata.tables) <= set(inspect(connection).get_table_names()):
                raise RuntimeError('Database schema is not ready; run alembic upgrade head.')
        app.state.engine = engine
        injected = app.state.injected_model
        provider = ModelProvider() if injected is None else None
        app.state.model = provider if injected is None else injected
        app.state.ai_limit = AILimit()
        worker = ImportWorker(engine, app.state.model)
        app.state.import_worker = worker
        worker.start()
        yield
    finally:
        if worker is not None:
            worker.stop()
        if provider is not None:
            provider.close()
        engine.dispose()


def create_app(*, model=None) -> FastAPI:
    if model is not None and os.getenv('APP_ENV') != 'test':
        raise ValueError('An injected model is only allowed in test mode.')
    app = FastAPI(title='NeuroVerse', lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    app.state.injected_model = model
    origins = [origin.strip() for origin in os.getenv('ALLOWED_ORIGINS', '').split(',') if origin.strip()]
    if os.getenv('APP_ENV', 'production') == 'development' and origins:
        if '*' in origins:
            raise ValueError('ALLOWED_ORIGINS must list explicit origins.')
        app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=['GET', 'POST', 'PATCH', 'DELETE'],
                           allow_headers=['Authorization', 'Content-Type'])

    @app.middleware('http')
    async def record_request(request, call_next):
        request_id = uuid4().hex
        started = perf_counter()
        try:
            response = await call_next(request)
        except Exception:
            response = error_response(500, 'INTERNAL_ERROR', '服务暂时无法完成请求')
        response.headers['X-Request-ID'] = request_id
        logger.info('requestId=%s status=%d durationMs=%.1f', request_id, response.status_code,
                    (perf_counter() - started) * 1000)
        return response

    @app.exception_handler(RequestValidationError)
    async def invalid_request(request, error):
        return error_response(400, 'INVALID_INPUT', '请求参数格式不正确')

    @app.exception_handler(HTTPException)
    async def http_error(request, error):
        if isinstance(error, APIError):
            return error_response(error.status_code, error.code, error.message, error.headers)
        code, message = {
            404: ('NOT_FOUND', '资源不存在'),
            405: ('METHOD_NOT_ALLOWED', '不支持该请求方法'),
        }.get(error.status_code, ('HTTP_ERROR', '请求失败'))
        return error_response(error.status_code, code, message, error.headers)

    @app.exception_handler(SQLAlchemyError)
    async def database_error(request, error):
        return error_response(503, 'SERVICE_UNAVAILABLE', '服务暂不可用，请稍后重试')

    @app.get('/health')
    def health():
        return {'status': 'ok'}

    @app.post('/api/v1/sessions', status_code=201)
    def create_session(body: SessionRequest, request: Request, response: Response):
        token = secrets.token_urlsafe(32)
        created_at = utc_now()
        with request.app.state.engine.begin() as connection:
            connection.execute(insert(sessions).values(
                id=str(uuid4()), token_hash=token_digest(token),
                created_at=created_at, expires_at=created_at + timedelta(days=30),
            ))
        response.headers['Cache-Control'] = 'no-store'
        return {'sessionToken': token}

    for router in (graph_router, import_router, learning_router):
        app.include_router(router)
    return app


app = create_app()
