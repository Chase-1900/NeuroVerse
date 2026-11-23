import hashlib
import json
import sqlite3
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from jsonschema import Draft202012Validator
from sqlalchemy.exc import OperationalError

BACKEND = Path(__file__).resolve().parents[1]
CONTRACT = json.loads((BACKEND.parent / 'contracts/openapi.yaml').read_bytes())


def assert_response(response, path, method, status):
    assert response.status_code == status
    responses = CONTRACT['paths'][path][method]['responses']
    schema = responses.get(str(status), responses.get('default'))['content']['application/json']['schema']
    Draft202012Validator({**schema, 'components': CONTRACT['components']}).validate(response.json())


@pytest.fixture
def database(tmp_path, monkeypatch):
    path = tmp_path / 'b01.db'
    monkeypatch.setenv('DATABASE_URL', f'sqlite:///{path.as_posix()}')
    monkeypatch.setenv('APP_ENV', 'test')
    monkeypatch.delenv('ALLOWED_ORIGINS', raising=False)
    command.upgrade(Config(BACKEND / 'alembic.ini'), 'head')
    return path


@pytest.fixture
def client(database):
    from app.main import create_app

    with TestClient(create_app()) as browser:
        yield browser


def auth(token):
    return {'Authorization': f'Bearer {token}'}


def test_health(client):
    result = client.get('/health')
    assert_response(result, '/health', 'get', 200)
    assert result.json() == {'status': 'ok'}


def test_sessions_persist_digest_and_keep_distinct_owners(client, database):
    first, second = (client.post('/api/v1/sessions', json={}) for _ in range(2))
    for response in (first, second):
        assert_response(response, '/api/v1/sessions', 'post', 201)
        assert set(response.json()) == {'sessionToken'}
        assert 'no-store' in response.headers['cache-control']
    tokens = [response.json()['sessionToken'] for response in (first, second)]
    assert len(set(tokens)) == 2
    with sqlite3.connect(database) as db:
        rows = db.execute('SELECT id, token_hash, created_at, expires_at FROM sessions').fetchall()
    assert len({row[0] for row in rows}) == 2
    assert {row[1] for row in rows} == {hashlib.sha256(token.encode()).hexdigest() for token in tokens}
    assert all(datetime.fromisoformat(row[3]) - datetime.fromisoformat(row[2]) == timedelta(days=30) for row in rows)
    from app.main import create_app

    with TestClient(create_app()) as reopened:
        for token in tokens:
            graph = reopened.get('/api/v1/graph', headers=auth(token))
            assert_response(graph, '/api/v1/graph', 'get', 200)
            assert graph.json() == {'nodes': [], 'edges': [], 'graphVersion': 0}


@pytest.mark.parametrize('headers', [{}, {'Authorization': 'Basic invalid'}, auth('unknown'), auth('A' * 43), auth('café')])
def test_graph_rejects_invalid_session(client, headers):
    response = client.get('/api/v1/graph', headers={key: value.encode('utf-8') for key, value in headers.items()})
    assert_response(response, '/api/v1/graph', 'get', 401)
    assert response.json()['error']['code'] == 'UNAUTHORIZED'
    assert response.headers['www-authenticate'] == 'Bearer'


def test_graph_rejects_expired_session(client, database):
    token = client.post('/api/v1/sessions', json={}).json()['sessionToken']
    with sqlite3.connect(database) as db:
        db.execute('UPDATE sessions SET expires_at = ?', ((datetime.now(UTC) - timedelta(seconds=1)).replace(tzinfo=None).isoformat(sep=' '),))
    response = client.get('/api/v1/graph', headers=auth(token))
    assert_response(response, '/api/v1/graph', 'get', 401)


@pytest.mark.parametrize('body', ['null', '[]', '"secret-input"', '{"broken":'])
def test_invalid_session_body_returns_sanitized_error(client, body):
    response = client.post('/api/v1/sessions', content=body, headers={'Content-Type': 'application/json'})
    assert_response(response, '/api/v1/sessions', 'post', 400)
    assert response.json()['error']['code'] == 'INVALID_INPUT'
    assert 'secret-input' not in response.text
    assert 'detail' not in response.json()


def test_session_body_is_required(client):
    assert_response(client.post('/api/v1/sessions'), '/api/v1/sessions', 'post', 400)


def test_unknown_route_uses_error_envelope(client):
    response = client.get('/api/v1/not-yet-implemented')
    assert response.status_code == 404
    assert response.json()['error']['code'] == 'NOT_FOUND'


def test_database_error_returns_sanitized_503(client, monkeypatch):
    def fail(*args, **kwargs):
        raise OperationalError('hidden statement', {}, RuntimeError('hidden address'))

    monkeypatch.setattr(client.app.state.engine, 'connect', fail)
    response = client.post('/api/v1/sessions', json={})
    assert_response(response, '/api/v1/sessions', 'post', 503)
    assert 'hidden' not in response.text


def test_startup_requires_migration(tmp_path, monkeypatch):
    from app.main import create_app

    monkeypatch.setenv('DATABASE_URL', f'sqlite:///{(tmp_path / "empty.db").as_posix()}')
    with pytest.raises(RuntimeError, match='alembic upgrade head'):
        with TestClient(create_app()):
            pass


@pytest.mark.parametrize('env, expected', [('development', 'http://localhost:5173'), ('production', None)])
def test_cors_only_allows_configured_dev_origin(database, monkeypatch, env, expected):
    from app.main import create_app

    monkeypatch.setenv('APP_ENV', env)
    monkeypatch.setenv('ALLOWED_ORIGINS', 'http://localhost:5173')
    with TestClient(create_app()) as browser:
        for origin, allowed in [('http://localhost:5173', expected), ('http://localhost:5174', None)]:
            result = browser.get('/health', headers={'Origin': origin})
            assert result.headers.get('access-control-allow-origin') == allowed
