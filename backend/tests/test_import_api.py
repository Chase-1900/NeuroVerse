from io import BytesIO
from time import monotonic, sleep

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject

from app.core import APIError
from app.database import BACKEND
from app.main import create_app


class Extractor:
    def complete_json(self, system, data, schema):
        text = data['text']
        values = {
            'nodes': [{
                'localId': key, 'title': title, 'summary': '网络概念', 'category': '网络',
                'chunkId': data['chunkId'], 'snippet': 'TCP 使用 ACK',
            } for key, title in [('tcp', 'ＴＣＰ'), ('ack', 'ACK')]],
            'edges': [{'source': 'tcp', 'target': 'ack', 'relation': '使用'}],
        }
        if '错误引用' in text:
            values['nodes'][0]['snippet'] = 'tcp 使用 ACK'
        if '悬空边' in text:
            values['edges'][0]['target'] = 'missing'
        return schema.model_validate(values)


@pytest.fixture
def database(tmp_path, monkeypatch):
    monkeypatch.setenv('APP_ENV', 'test')
    monkeypatch.setenv('DATABASE_URL', f'sqlite:///{(tmp_path / "imports.db").as_posix()}')
    monkeypatch.setenv('MAX_UPLOAD_BYTES', '10485760')
    monkeypatch.setenv('MAX_INPUT_CHARS', '50000')
    command.upgrade(Config(BACKEND / 'alembic.ini'), 'head')


@pytest.fixture
def client(database):
    with TestClient(create_app(model=Extractor())) as http:
        yield http


def session(http):
    resp = http.post('/api/v1/sessions', json={})
    assert resp.status_code == 201
    return {'Authorization': f"Bearer {resp.json()['sessionToken']}"}


def submit(http, headers, text):
    return http.post('/api/v1/imports', headers=headers, files={'text': (None, text)})


def finished(http, headers, identifier):
    deadline = monotonic() + 5
    while monotonic() < deadline:
        response = http.get(f'/api/v1/jobs/{identifier}', headers=headers)
        assert response.status_code == 200, response.text
        job = response.json()
        if job['status'] in ('succeeded', 'failed'):
            return job
        assert job['status'] in ('pending', 'running')
        sleep(0.01)
    pytest.fail(f'Job did not finish: {identifier}')


def sql(http, statement):
    with http.app.state.engine.connect() as db:
        return db.exec_driver_sql(statement).all()


def test_import_rejects_blank_text(database):
    with TestClient(create_app()) as http:
        headers = session(http)
        response = submit(http, headers, ' \n\t ')
        assert response.status_code == 400, response.text
        assert response.json()['error']['code'] == 'INVALID_INPUT'


def test_extracts_owner_graph_and_deduplicates_success(client):
    first, second = session(client), session(client)
    text = 'TCP 使用 ACK'
    accepted = submit(client, first, text)
    assert accepted.status_code == 202, accepted.text
    job_id = accepted.json()['jobId']
    assert client.get(f'/api/v1/jobs/{job_id}', headers=second).status_code == 404
    assert client.get(f'/api/v1/jobs/{job_id}').status_code == 401
    assert finished(client, first, job_id) == {
        'jobId': job_id, 'status': 'succeeded', 'graphVersion': 1,
    }
    assert submit(client, first, f'  {text} ').json()['jobId'] == job_id
    independent = submit(client, second, text).json()['jobId']
    assert independent != job_id
    assert finished(client, second, independent)['graphVersion'] == 1
    assert sql(client, 'SELECT norm_title, mastery FROM nodes ORDER BY 1') == [
        ('ack', 0), ('ack', 0), ('tcp', 0), ('tcp', 0),
    ]
    assert sql(client, 'SELECT relation FROM edges') == [('使用',), ('使用',)]
    assert sql(client, 'SELECT snippet, text FROM node_sources JOIN chunks ON chunk_id = chunks.id') == [
        (text, text), (text, text), (text, text), (text, text),
    ]


@pytest.mark.parametrize('invalid', ['错误引用', '悬空边'])
def test_invalid_model_output_preserves_graph_and_allows_retry(client, invalid):
    headers = session(client)
    existing = submit(client, headers, 'TCP 使用 ACK').json()['jobId']
    assert finished(client, headers, existing)['status'] == 'succeeded'
    text = f'TCP 使用 ACK {invalid}'
    identifier = submit(client, headers, text).json()['jobId']
    failed = finished(client, headers, identifier)
    assert failed['status'] == 'failed'
    assert failed['error']['code']
    assert 'graphVersion' not in failed
    assert sql(client, 'SELECT version FROM graph_versions') == [(1,)]
    assert sql(client, 'SELECT count(*) FROM node_sources') == [(2,)]
    retry = submit(client, headers, text)
    assert retry.status_code == 202
    assert retry.json()['jobId'] != identifier


def pdf(phrase=None, encrypted=False):
    writer = PdfWriter()
    writer.add_blank_page(200, 200)
    if phrase:
        page = writer.add_blank_page(200, 200)
        def name(value):
            return NameObject('/' + value)

        font = DictionaryObject({name('Type'): name('Font'), name('Subtype'): name('Type1'),
                                 name('BaseFont'): name('Helvetica')})
        page[name('Resources')] = DictionaryObject({name('Font'): DictionaryObject({name('F1'): font})})
        stream = DecodedStreamObject()
        stream.set_data(f'BT /F1 12 Tf 20 100 Td ({phrase}) Tj ET'.encode('ascii'))
        page.replace_contents(stream)
    if encrypted:
        writer.encrypt('secret')
    output = BytesIO()
    writer.write(output)
    return output.getvalue()


def test_pdf_keeps_original_page_number(database):
    class PdfExtractor:
        def complete_json(self, system, data, schema):
            return schema.model_validate({'nodes': [{
                'localId': 'tcp', 'title': 'TCP', 'summary': 'Network protocol', 'category': 'Network',
                'chunkId': data['chunkId'], 'snippet': 'TCP uses ACK',
            }], 'edges': []})

    with TestClient(create_app(model=PdfExtractor())) as http:
        headers = session(http)
        response = http.post('/api/v1/imports', headers=headers,
                             files={'file': ('lecture.PDF', pdf('TCP uses ACK'), 'application/pdf')})
        assert response.status_code == 202, response.text
        assert finished(http, headers, response.json()['jobId'])['status'] == 'succeeded'
        assert sql(http, 'SELECT page, ordinal, text FROM chunks') == [(2, 0, 'TCP uses ACK')]


def test_upload_bounds_and_type_validation(client, monkeypatch):
    headers = session(client)
    for filename, content in [('empty.pdf', pdf()), ('encrypted.pdf', pdf(encrypted=True)),
                              ('bad.pdf', b'not PDF'), ('bad.txt', b'\xff'), ('bad.doc', b'plain')]:
        response = client.post('/api/v1/imports', headers=headers, files={'file': (filename, content)})
        assert response.status_code == 400, (filename, response.text)
    mixed = client.post('/api/v1/imports', headers=headers, files={
        'file': ('note.txt', b'TCP'), 'text': (None, ''),
    })
    assert mixed.status_code == 400
    monkeypatch.setenv('MAX_INPUT_CHARS', '5')
    assert submit(client, headers, '123456').status_code == 413
    monkeypatch.setenv('MAX_UPLOAD_BYTES', '3')
    response = client.post('/api/v1/imports', headers=headers, files={'file': ('note.txt', b'1234')})
    assert response.status_code == 413
    assert sql(client, 'SELECT count(*) FROM jobs') == [(0,)]


def test_txt_bom_chunk_overlap_and_existing_node_preservation(client):
    headers = session(client)
    initial = submit(client, headers, 'TCP 使用 ACK').json()['jobId']
    assert finished(client, headers, initial)['status'] == 'succeeded'
    with client.app.state.engine.begin() as db:
        db.exec_driver_sql("UPDATE nodes SET summary = '已编辑', mastery = 80 WHERE norm_title = 'tcp'")
    text = 'TCP 使用 ACK' + '甲' * 1040 + 'TCP 使用 ACK' + '乙' * 105
    response = client.post('/api/v1/imports', headers=headers,
                           files={'file': ('note.txt', ('\ufeff' + text).encode('utf-8'))})
    assert response.status_code == 202, response.text
    identifier = response.json()['jobId']
    assert finished(client, headers, identifier)['graphVersion'] == 2
    first, second = sql(client, "SELECT text FROM chunks JOIN documents ON documents.id = chunks.document_id "
                                "WHERE documents.title = 'note.txt' ORDER BY ordinal")
    assert first[0][-100:] == second[0][:100]
    assert first[0] + second[0][100:] == text
    assert sql(client, "SELECT summary, mastery FROM nodes WHERE norm_title = 'tcp'") == [('已编辑', 80)]
    assert sql(client, 'SELECT count(*) FROM edges') == [(1,)]


def test_sql_failure_rolls_back_nodes_sources_and_version(client):
    headers = session(client)
    with client.app.state.engine.begin() as db:
        db.exec_driver_sql("CREATE TRIGGER reject_edge BEFORE INSERT ON edges BEGIN "
                           "SELECT RAISE(ABORT, 'private database detail'); END")
    identifier = submit(client, headers, 'TCP 使用 ACK').json()['jobId']
    job = finished(client, headers, identifier)
    assert job['status'] == 'failed'
    assert 'private database detail' not in str(job)
    assert sql(client, 'SELECT count(*) FROM nodes') == [(0,)]
    assert sql(client, 'SELECT count(*) FROM node_sources') == [(0,)]
    assert sql(client, 'SELECT count(*) FROM graph_versions') == [(0,)]
    assert sql(client, 'SELECT status FROM documents') == [('failed',)]


def test_dedup_does_not_consume_ai_quota(database, monkeypatch):
    monkeypatch.setenv('AI_REQUESTS_PER_MINUTE', '1')
    with TestClient(create_app(model=Extractor())) as http:
        headers = session(http)
        accepted = submit(http, headers, 'TCP 使用 ACK')
        assert accepted.status_code == 202, accepted.text
        identifier = accepted.json()['jobId']
        assert submit(http, headers, 'TCP 使用 ACK').json()['jobId'] == identifier
        assert finished(http, headers, identifier)['status'] == 'succeeded'
        assert submit(http, headers, 'TCP 使用 ACK').json()['jobId'] == identifier
        response = submit(http, headers, '另一份资料')
        assert response.status_code == 429, response.text
        assert sql(http, 'SELECT count(*) FROM jobs') == [(1,)]


def test_provider_error_is_sanitized(database):
    class UnavailableExtractor:
        def complete_json(self, system, data, schema):
            raise APIError(502, 'MODEL_ERROR', 'private provider detail')

    with TestClient(create_app(model=UnavailableExtractor())) as http:
        headers = session(http)
        accepted = submit(http, headers, 'TCP 使用 ACK')
        assert accepted.status_code == 202, accepted.text
        job = finished(http, headers, accepted.json()['jobId'])
        assert job['status'] == 'failed'
        assert job['error']['code'] == 'MODEL_ERROR'
        assert 'private provider detail' not in str(job)
        assert sql(http, 'SELECT count(*) FROM nodes') == [(0,)]


def test_restart_recovers_persisted_jobs(database):
    with TestClient(create_app(model=Extractor())) as http:
        headers = session(http)
        with http.app.state.engine.begin() as db:
            owner = db.exec_driver_sql('SELECT id FROM sessions').scalar_one()
            for status in ('pending', 'running'):
                db.exec_driver_sql('INSERT INTO documents (id, owner_id, title, status, content_hash) VALUES (?, ?, ?, ?, ?)',
                                   (status, owner, status, status, status))
                db.exec_driver_sql('INSERT INTO chunks (id, owner_id, document_id, ordinal, text) VALUES (?, ?, ?, 0, ?)',
                                   (status, owner, status, 'TCP 使用 ACK'))
                db.exec_driver_sql('INSERT INTO jobs (id, owner_id, document_id, status) VALUES (?, ?, ?, ?)',
                                   (status, owner, status, status))

    with TestClient(create_app(model=Extractor())) as http:
        assert finished(http, headers, 'running')['status'] == 'failed'
        assert finished(http, headers, 'pending')['status'] == 'succeeded'
        assert sql(http, 'SELECT id, status FROM documents ORDER BY id') == [
            ('pending', 'succeeded'), ('running', 'failed'),
        ]
