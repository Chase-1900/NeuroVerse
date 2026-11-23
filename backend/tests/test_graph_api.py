import json
from datetime import datetime, timedelta

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from jsonschema import Draft202012Validator, FormatChecker
from sqlalchemy import insert, select

from app.core import token_digest, utc_now
from app.database import BACKEND, chunks, documents, edges, node_sources, sessions
from app.main import create_app

API = '/api/v1'
CONTRACT = json.loads((BACKEND.parent / 'contracts/openapi.yaml').read_bytes())
EMPTY_GRAPH = {'nodes': [], 'edges': [], 'graphVersion': 0}
NODE_INPUT = {'title': 'TCP  ACK', 'category': '网络', 'summary': '确认机制'}
CREATED_AT = datetime(2026, 1, 1)
DOC_TEXT = '  原文\n\n保留这段文字。\n'
SOURCE_REF = {'documentId': 'doc-a', 'chunkId': 'chunk-first', 'page': None, 'snippet': '原文'}


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv('DATABASE_URL', f'sqlite:///{(tmp_path / "b04.db").as_posix()}')
    monkeypatch.setenv('APP_ENV', 'test')
    command.upgrade(Config(BACKEND / 'alembic.ini'), 'head')

    app = create_app()
    with TestClient(app) as browser:
        now = utc_now()
        with app.state.engine.begin() as db:
            db.execute(insert(sessions), [
                {'id': owner, 'token_hash': token_digest(owner * 43),
                 'created_at': now, 'expires_at': now + timedelta(days=1)}
                for owner in ('a', 'b')
            ])
        yield browser


def auth(owner='a'):
    return {'Authorization': f'Bearer {owner * 43}'}


def check(response, path, method, status):
    assert response.status_code == status, response.text
    if status == 204:
        assert response.content == b''
        return
    responses = CONTRACT['paths'][API + path][method]['responses']
    schema = responses.get(str(status), responses.get('default'))['content']['application/json']['schema']
    payload = response.json()
    Draft202012Validator(
        {**schema, 'components': CONTRACT['components']}, format_checker=FormatChecker(),
    ).validate(payload)
    return payload


def add_node(client, owner='a', **overrides):
    response = client.post(API + '/nodes', json={**NODE_INPUT, **overrides}, headers=auth(owner))
    return check(response, '/nodes', 'post', 201)['node']


def get_graph(client, owner='a'):
    response = client.get(API + '/graph', headers=auth(owner))
    assert 'no-store' in response.headers['cache-control']
    return check(response, '/graph', 'get', 200)


def seed_documents(engine):
    with engine.begin() as db:
        db.execute(insert(documents), [
            {'id': doc_id, 'owner_id': owner, 'title': title, 'status': status,
             'content_hash': doc_id, 'created_at': CREATED_AT}
            for doc_id, owner, title, status in (
                ('doc-a', 'a', '笔记', 'succeeded'),
                ('pending-a', 'a', '待处理', 'pending'),
                ('doc-b', 'b', '私有资料', 'failed'),
            )
        ])
        db.execute(insert(chunks), [
            {'id': 'chunk-last', 'owner_id': 'a', 'document_id': 'doc-a', 'page': 2,
             'ordinal': 1, 'text': '最后一段'},
            {'id': 'chunk-first', 'owner_id': 'a', 'document_id': 'doc-a', 'page': None,
             'ordinal': 0, 'text': DOC_TEXT},
            {'id': 'chunk-b', 'owner_id': 'b', 'document_id': 'doc-b', 'page': 1,
             'ordinal': 0, 'text': '私有原文'},
        ])


def test_node_create_update_delete_and_owner_versions(client):
    assert get_graph(client) == EMPTY_GRAPH
    assert get_graph(client, 'b') == EMPTY_GRAPH
    node = add_node(client)
    assert node == {**NODE_INPUT, 'id': node['id'], 'createdAt': node['createdAt'],
                    'kind': 'knowledge', 'mastery': 0, 'sourceRefs': []}
    assert get_graph(client) == {'nodes': [node], 'edges': [], 'graphVersion': 1}
    assert get_graph(client, 'b') == EMPTY_GRAPH
    other_node = add_node(client, 'b')  # uniqueness is per owner
    assert other_node['id'] != node['id']

    path = f"{API}/nodes/{node['id']}"
    check(client.patch(path, headers=auth('b'), json={'title': 'other'}), '/nodes/{id}', 'patch', 404)
    check(client.delete(path, headers=auth('b')), '/nodes/{id}', 'delete', 404)
    assert get_graph(client)['nodes'] == [node]
    patch = {'title': 'ACK', 'summary': '', 'category': '协议'}
    updated = check(client.patch(path, headers=auth(), json=patch), '/nodes/{id}', 'patch', 200)['node']
    assert updated == {**node, **patch}
    assert get_graph(client) == {'nodes': [updated], 'edges': [], 'graphVersion': 2}
    check(client.delete(path, headers=auth()), '/nodes/{id}', 'delete', 204)
    check(client.delete(path, headers=auth()), '/nodes/{id}', 'delete', 404)
    assert get_graph(client) == {**EMPTY_GRAPH, 'graphVersion': 3}
    assert get_graph(client, 'b') == {'nodes': [other_node], 'edges': [], 'graphVersion': 1}


def test_normalized_title_conflicts_leave_graph_unchanged(client):
    add_node(client)
    twin = add_node(client, title='ＴＣＰ ack', category='协议')
    baseline = get_graph(client)
    duplicate = {**NODE_INPUT, 'title': '  ｔｃｐ ack  '}
    check(client.post(API + '/nodes', headers=auth(), json=duplicate), '/nodes', 'post', 409)
    response = client.patch(f"{API}/nodes/{twin['id']}", headers=auth(), json={'category': '网络'})
    check(response, '/nodes/{id}', 'patch', 409)
    assert get_graph(client) == baseline


@pytest.mark.parametrize('patch', [
    {}, {'title': None}, {'summary': None}, {'category': None}, {'title': '　'}, {'title': 'x' * 121},
    {'summary': 'x' * 1001}, {'category': 'x' * 81}, {'category': ''}, {'summary': 0},
    {'mastery': 100}, {'ownerId': 'b'}, {'kind': 'idea'}, {'sourceRefs': []},
])
def test_invalid_patch_does_not_mutate_graph(client, patch):
    node = add_node(client)
    response = client.patch(f"{API}/nodes/{node['id']}", headers=auth(), json=patch)
    assert check(response, '/nodes/{id}', 'patch', 400)['error']['code'] == 'INVALID_INPUT'
    assert get_graph(client) == {'nodes': [node], 'edges': [], 'graphVersion': 1}


@pytest.mark.parametrize('body', [{}, {'title': 'x', 'category': 'y'}, {**NODE_INPUT, 'title': ''}])
def test_invalid_create_does_not_mutate_graph(client, body):
    response = client.post(API + '/nodes', headers=auth(), json=body)
    assert check(response, '/nodes', 'post', 400)['error']['code'] == 'INVALID_INPUT'
    assert get_graph(client) == EMPTY_GRAPH


def test_graph_and_patch_return_provenance_and_delete_cascades(client):
    engine = client.app.state.engine
    seed_documents(engine)
    a, b, c = (add_node(client, title=title)['id'] for title in ('A', 'B', 'C'))
    x, y = (add_node(client, owner='b', title=title)['id'] for title in ('A', 'B'))
    with engine.begin() as db:
        db.execute(insert(edges), [
            {'id': 'e2', 'owner_id': 'a', 'source_id': b, 'target_id': a, 'relation': '关联'},
            {'id': 'e1', 'owner_id': 'a', 'source_id': a, 'target_id': c, 'relation': '包含'},
            {'id': 'e3', 'owner_id': 'b', 'source_id': x, 'target_id': y, 'relation': '私有'},
        ])
        db.execute(insert(node_sources), [
            {'owner_id': 'a', 'node_id': a, 'chunk_id': 'chunk-first', 'snippet': '原文'},
            {'owner_id': 'b', 'node_id': x, 'chunk_id': 'chunk-b', 'snippet': '私有原文'},
        ])
    graph = get_graph(client)
    assert graph['edges'] == [
        {'id': 'e1', 'source': a, 'target': c, 'relation': '包含'},
        {'id': 'e2', 'source': b, 'target': a, 'relation': '关联'},
    ]
    assert get_graph(client)['edges'] == graph['edges']
    assert {node['id']: node['sourceRefs'] for node in graph['nodes']} == {a: [SOURCE_REF], b: [], c: []}
    assert [edge['id'] for edge in get_graph(client, 'b')['edges']] == ['e3']

    path = f'{API}/nodes/{a}'
    response = client.patch(path, headers=auth(), json={'summary': '手动编辑'})
    patched = check(response, '/nodes/{id}', 'patch', 200)['node']
    assert patched['summary'] == '手动编辑'
    assert patched['sourceRefs'] == [SOURCE_REF]
    check(client.delete(path, headers=auth()), '/nodes/{id}', 'delete', 204)
    graph = get_graph(client)
    assert graph['graphVersion'] == 5
    assert graph['edges'] == []
    assert {node['id'] for node in graph['nodes']} == {b, c}
    with engine.connect() as db:
        assert db.execute(select(node_sources.c.node_id)).scalars().all() == [x]
        assert db.scalar(select(chunks.c.text).where(chunks.c.id == 'chunk-first')) == DOC_TEXT
    assert [edge['id'] for edge in get_graph(client, 'b')['edges']] == ['e3']


def test_failed_version_update_rolls_back_node_change(client):
    node = add_node(client)
    with client.app.state.engine.begin() as db:
        db.exec_driver_sql("""CREATE TRIGGER reject_version_update BEFORE UPDATE ON graph_versions
                              BEGIN SELECT RAISE(ABORT, 'test failure'); END""")
    response = client.delete(f"{API}/nodes/{node['id']}", headers=auth())
    check(response, '/nodes/{id}', 'delete', 503)
    assert get_graph(client) == {'nodes': [node], 'edges': [], 'graphVersion': 1}


def test_documents_list_and_detail_are_owner_scoped_and_preserve_text(client):
    seed_documents(client.app.state.engine)
    docs = check(client.get(API + '/documents', headers=auth()), '/documents', 'get', 200)['documents']
    assert {doc['documentId']: doc for doc in docs} == {
        'doc-a': {'documentId': 'doc-a', 'title': '笔记', 'createdAt': '2026-01-01T00:00:00Z', 'status': 'succeeded'},
        'pending-a': {'documentId': 'pending-a', 'title': '待处理', 'createdAt': '2026-01-01T00:00:00Z', 'status': 'pending'},
    }
    other_docs = check(client.get(API + '/documents', headers=auth('b')), '/documents', 'get', 200)
    assert [doc['documentId'] for doc in other_docs['documents']] == ['doc-b']
    detail = check(client.get(API + '/documents/doc-a', headers=auth()), '/documents/{id}', 'get', 200)
    assert detail == {
        'documentId': 'doc-a', 'title': '笔记', 'createdAt': '2026-01-01T00:00:00Z',
        'chunks': [{'chunkId': 'chunk-first', 'page': None, 'text': DOC_TEXT},
                   {'chunkId': 'chunk-last', 'page': 2, 'text': '最后一段'}],
    }
    assert check(client.get(API + '/documents/pending-a', headers=auth()),
                 '/documents/{id}', 'get', 200)['chunks'] == []
    for doc_id in ('doc-b', 'missing'):
        response = client.get(f'{API}/documents/{doc_id}', headers=auth())
        assert check(response, '/documents/{id}', 'get', 404)['error']['code'] == 'NOT_FOUND'


@pytest.mark.parametrize(('method', 'path', 'url', 'body'), [
    ('get', '/graph', '/graph', {}),
    ('post', '/nodes', '/nodes', {'json': NODE_INPUT}),
    ('patch', '/nodes/{id}', '/nodes/sample', {'json': {'title': 'update'}}),
    ('delete', '/nodes/{id}', '/nodes/sample', {}),
    ('get', '/documents', '/documents', {}),
    ('get', '/documents/{id}', '/documents/sample', {}),
])
def test_endpoints_require_a_session(client, method, path, url, body):
    result = client.request(method, API + url, **body)
    assert check(result, path, method, 401)['error']['code'] == 'UNAUTHORIZED'
