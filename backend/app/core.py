import hashlib
import re
from datetime import UTC, datetime

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from starlette.exceptions import HTTPException

from app.database import sessions

bearer = HTTPBearer(auto_error=False, scheme_name='bearerAuth')
token_pattern = re.compile(r'[A-Za-z0-9_-]{43}')


class APIError(HTTPException):
    def __init__(self, status, code, message, headers=None):
        super().__init__(status, headers=headers)
        self.code = code
        self.message = message


def token_digest(token: str) -> str:
    return hashlib.sha256(token.encode('ascii')).hexdigest()


def utc_now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def session_owner(request: Request, authorization: HTTPAuthorizationCredentials | None = Depends(bearer)) -> str:
    if authorization is not None and token_pattern.fullmatch(authorization.credentials):
        with request.app.state.engine.connect() as connection:
            owner = connection.scalar(select(sessions.c.id).where(
                sessions.c.token_hash == token_digest(authorization.credentials),
                sessions.c.expires_at > utc_now(),
            ))
        if owner is not None:
            return owner
    raise APIError(401, 'UNAUTHORIZED', '会话无效或已过期', {'WWW-Authenticate': 'Bearer'})
