from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.core import APIError, token_digest
from app.database import BACKEND


class Model:
    def __init__(self):
        self.calls = []
        self.fail = False
        self.malformed = False
        self.idea_title = 'Delivery lab'
        self.before_return = None

    def complete_json(self, system, data, schema):
        assert system
        self.calls.append({'system': system, **data})
        if self.fail:
            raise APIError(502, 'MODEL_ERROR', '模型暂不可用')
        if 'answer' in data:
            assert data['expectedAnswer'] == 'ACK confirms receipt.'
            result = {'correct': data['answer'] == 'It confirms receipt', 'feedback': 'Review ACK.'}
        elif 'questionType' in data:
            result = {'question': 'What does an ACK indicate?', 'expectedAnswer': 'ACK confirms receipt.',
                      'rubric': ['Mentions receipt', 'Identifies acknowledgement']}
        else:
            result = {'commonGround': 'Delivery', 'title': self.idea_title, 'description': 'Simulate loss.',
                      'action': 'Compare two runs.'}
        if self.before_return is not None:
            self.before_return()
        try:
            return schema.model_validate({} if self.malformed else result)
        except ValidationError:
            raise APIError(502, 'MODEL_ERROR', '模型暂不可用') from None


@pytest.fixture
def api(tmp_path, monkeypatch):
    from app.learning_api import router
    from app.main import create_app

    monkeypatch.setenv('APP_ENV', 'test')
    monkeypatch.setenv('DATABASE_URL', f'sqlite:///{(tmp_path / "learning.db").as_posix()}')
    command.upgrade(Config(BACKEND / 'alembic.ini'), 'head')
    model = Model()
    app = create_app(model=model)
    if not any(route.path == '/api/v1/collisions' for route in app.routes):
        app.include_router(router)
    with TestClient(app) as client:
        tokens = [client.post('/api/v1/sessions', json={}).json()['sessionToken'] for _ in range(2)]
        headers = [{'Authorization': f'Bearer {token}'} for token in tokens]
        engine = app.state.engine
        with engine.begin() as db:
            a, b = [db.exec_driver_sql('SELECT id FROM sessions WHERE token_hash = ?',
                                       (token_digest(token),)).scalar_one() for token in tokens]
            db.exec_driver_sql('INSERT INTO nodes (id, owner_id, title, norm_title, category, mastery, kind) '
                               'VALUES (?, ?, ?, ?, ?, ?, ?)', [
                ('n1', a, 'TCP', 'tcp', 'Networks', 39, 'knowledge'),
                ('n2', a, 'ACK', 'ack', 'Networks', 20, 'knowledge'),
                ('n3', a, 'Beta', 'beta', 'Networks', 10, 'knowledge'),
                ('n4', a, 'Alpha', 'alpha', 'Networks', 10, 'knowledge'),
                ('n5', a, 'Gamma', 'gamma', 'Networks', 30, 'knowledge'),
                ('idea', a, 'Hypothesis', 'hypothesis', 'Ideas', 0, 'idea'),
                ('foreign', b, 'Private', 'private', 'Networks', 0, 'knowledge'),
            ])
            db.exec_driver_sql('INSERT INTO edges VALUES (?, ?, ?, ?, ?)', [
                ('e1', a, 'n1', 'n2', 'uses'), ('e2', a, 'n3', 'n1', 'related'),
                ('e3', a, 'n1', 'n4', 'related'), ('e4', a, 'n1', 'n5', 'related'),
                ('e5', a, 'idea', 'n1', 'derived'), ('e6', a, 'n2', 'n1', 'related'),
            ])
            db.exec_driver_sql('INSERT INTO documents (id, owner_id, title, content_hash) VALUES (?, ?, ?, ?)',
                               ('doc', a, 'Notes', 'hash'))
            db.exec_driver_sql('INSERT INTO chunks VALUES (?, ?, ?, ?, ?, ?)', ('chunk', a, 'doc', 1, 0, 'TCP uses ACK.'))
            db.exec_driver_sql('INSERT INTO node_sources VALUES (?, ?, ?, ?)', (a, 'n1', 'chunk', 'TCP uses ACK.'))

        def post(path, payload, owner=0):
            return client.post(f'/api/v1/{path}', json=payload, headers={} if owner is None else headers[owner])

        yield post, model, engine, app


def collision(post):
    result = post('collisions', {'nodeIds': ['n2', 'n1']})
    assert result.status_code == 200, result.text
    return result.json()


def question(post, node_id='n1'):
    result = post('tutor/questions', {'nodeId': node_id})
    assert result.status_code == 201, result.text
    return result.json()


def test_collision_saves_exactly_two_provenance_edges_and_is_idempotent(api):
    post, model, engine, _ = api
    idea = collision(post)
    assert set(idea) == {'ideaId', 'sourceNodeIds', 'title', 'commonGround', 'description', 'action'}
    assert idea['sourceNodeIds'] == ['n2', 'n1']
    assert model.calls[0]['nodes'][1]['sourceRefs'][0]['snippet'] == 'TCP uses ACK.'
    path = f"ideas/{idea['ideaId']}/save"
    first = post(path, {})
    assert first.status_code == 200, first.text
    saved = first.json()
    node = saved['node']
    assert (node['kind'], node['mastery'], node['sourceRefs']) == ('idea', 0, [])
    assert [(e['source'], e['target'], e['relation']) for e in saved['edges']] == [
        (node['id'], 'n2', '来源于'), (node['id'], 'n1', '来源于'),
    ]
    assert post(path, {}).json() == saved
    assert len(model.calls) == 1
    with engine.connect() as db:
        assert db.exec_driver_sql('SELECT version FROM graph_versions').scalar_one() == 1
        assert db.exec_driver_sql('SELECT count(*) FROM edges WHERE source_id = ?', (node['id'],)).scalar_one() == 2


def test_concurrent_saves_create_one_node(api):
    post, _, engine, _ = api
    path = f"ideas/{collision(post)['ideaId']}/save"
    barrier = Barrier(2, timeout=10)

    def save(_):
        barrier.wait()
        return post(path, {})

    with ThreadPoolExecutor(max_workers=2) as pool:
        first, second = pool.map(save, range(2))
    assert first.status_code == second.status_code == 200
    assert first.json() == second.json()
    with engine.connect() as db:
        assert db.exec_driver_sql("SELECT count(*) FROM nodes WHERE title = 'Delivery lab'").scalar_one() == 1
        assert db.exec_driver_sql('SELECT version FROM graph_versions').scalar_one() == 1


def test_conflicting_normalized_title_does_not_link_to_existing_node(api):
    post, model, engine, _ = api
    first = f"ideas/{collision(post)['ideaId']}/save"
    model.idea_title = 'Ｄelivery  LAB'
    second_id = collision(post)['ideaId']
    assert post(first, {}).status_code == 200
    assert post(f'ideas/{second_id}/save', {}).status_code == 409
    with engine.connect() as db:
        assert db.exec_driver_sql('SELECT saved_node_id, was_saved FROM ideas WHERE id = ?', (second_id,)).one() == (None, 0)
        assert db.exec_driver_sql('SELECT version FROM graph_versions').scalar_one() == 1


@pytest.mark.parametrize('deleted', ['source', 'saved_idea', 'source_after_save'])
def test_idea_save_conflicts_after_deletion(api, deleted):
    post, _, engine, _ = api
    idea = collision(post)
    path = f"ideas/{idea['ideaId']}/save"
    target = 'n1'
    if deleted != 'source':
        saved = post(path, {}).json()
        if deleted == 'saved_idea':
            target = saved['node']['id']
    with engine.begin() as db:
        db.exec_driver_sql('DELETE FROM nodes WHERE id = ?', (target,))
    assert post(path, {}).status_code == 409
    with engine.connect() as db:
        assert db.exec_driver_sql('SELECT version FROM graph_versions').scalars().all() == (
            [] if deleted == 'source' else [1])


def test_question_hides_rubric_and_retry_returns_original_grade(api):
    post, model, engine, _ = api
    q = question(post)
    assert set(q) == {'questionId', 'nodeId', 'question'}
    assert model.calls[0]['questionType'] == 'concept'
    answer = {'questionId': q['questionId'], 'answer': 'It confirms receipt'}
    grade = post('tutor/answers', answer)
    assert grade.status_code == 200, grade.text
    assert grade.json() == {'correct': True, 'feedback': 'Review ACK.', 'correctAnswer': 'ACK confirms receipt.',
                            'mastery': 49, 'reviewNodeIds': ['n4', 'n3', 'n2']}
    assert post('tutor/answers', {**answer, 'answer': 'different answer'}).json() == grade.json()
    assert len(model.calls) == 2
    with engine.connect() as db:
        assert db.exec_driver_sql("SELECT mastery FROM nodes WHERE id = 'n1'").scalar_one() == 49
        assert db.exec_driver_sql('SELECT version FROM graph_versions').scalar_one() == 1
        assert db.exec_driver_sql('SELECT count(*) FROM attempts').scalar_one() == 1


@pytest.mark.parametrize(('mastery', 'node_id', 'kind'), [
    (40, 'n1', 'explanation'), (69, 'n1', 'explanation'), (70, 'n1', 'application'), (0, 'idea', 'reflection'),
])
def test_question_type_follows_mastery_and_node_kind(api, mastery, node_id, kind):
    post, model, engine, _ = api
    with engine.begin() as db:
        db.exec_driver_sql('UPDATE nodes SET mastery = ? WHERE id = ?', (mastery, node_id))
    question(post, node_id)
    assert model.calls[-1]['questionType'] == kind


def test_grade_prompt_requires_rubric_based_semantic_acceptance(api):
    post, model, _, _ = api
    q = question(post)
    post('tutor/answers', {'questionId': q['questionId'], 'answer': 'It confirms receipt'})
    grade_call = next(call for call in model.calls if 'expectedAnswer' in call)
    assert '逐条核对 rubric' in grade_call['system']
    assert 'judge correct when the answer covers the key facts' in grade_call['system']


@pytest.mark.parametrize(('start', 'answer', 'end'), [(2, 'wrong', 0), (20, 'wrong', 15), (99, 'It confirms receipt', 100)])
def test_grade_clamps_and_persists_mastery(api, start, answer, end):
    post, _, engine, _ = api
    with engine.begin() as db:
        db.exec_driver_sql("UPDATE nodes SET mastery = ? WHERE id = 'n1'", (start,))
    q = question(post)
    assert post('tutor/answers', {'questionId': q['questionId'], 'answer': answer}).json()['mastery'] == end
    with engine.connect() as db:
        assert db.exec_driver_sql("SELECT mastery FROM nodes WHERE id = 'n1'").scalar_one() == end


def test_validation_and_owner_isolation_do_not_call_model(api):
    post, model, _, _ = api
    idea, q = collision(post), question(post)
    answer = {'questionId': q['questionId'], 'answer': 'test'}
    assert post('collisions', {'nodeIds': ['n1', 'n2']}, None).status_code == 401
    for ids in (['n1'], ['n1', 'n1'], ['n1', 'n2', 'n3'], ['n1', '']):
        assert post('collisions', {'nodeIds': ids}).status_code == 400
    for text in ('', '   ', 'a' * 2001):
        assert post('tutor/answers', {**answer, 'answer': text}).status_code == 400
    assert post('collisions', {'nodeIds': ['n1', 'foreign']}).status_code == 404
    assert post('tutor/questions', {'nodeId': 'foreign'}).status_code == 404
    assert post(f"ideas/{idea['ideaId']}/save", {}, 1).status_code == 404
    assert post('tutor/answers', answer, 1).status_code == 404
    assert len(model.calls) == 2


def test_model_errors_do_not_persist_partial_work(api):
    post, model, engine, _ = api
    q = question(post)
    model.malformed = True
    assert post('collisions', {'nodeIds': ['n1', 'n2']}).status_code == 502
    assert post('tutor/questions', {'nodeId': 'n2'}).status_code == 502
    model.fail = True
    assert post('tutor/answers', {'questionId': q['questionId'], 'answer': 'wrong'}).status_code == 502
    with engine.connect() as db:
        for table, count in [('ideas', 0), ('questions', 1), ('attempts', 0), ('graph_versions', 0)]:
            assert db.exec_driver_sql(f'SELECT count(*) FROM {table}').scalar_one() == count
        assert db.exec_driver_sql("SELECT mastery FROM nodes WHERE id = 'n1'").scalar_one() == 39


def test_rate_limit_only_gates_model_requests(api, monkeypatch):
    post, model, _, app = api
    idea, q = collision(post), question(post)
    answer = {'questionId': q['questionId'], 'answer': 'test'}
    grade = post('tutor/answers', answer)
    assert grade.status_code == 200

    def limited(self, owner):
        raise APIError(429, 'RATE_LIMITED', '请稍后重试')

    monkeypatch.setattr(type(app.state.ai_limit), 'check', limited)
    assert post('tutor/questions', {'nodeId': 'n1'}).status_code == 429
    assert post(f"ideas/{idea['ideaId']}/save", {}).status_code == 200
    assert post('tutor/answers', answer).json() == grade.json()
    assert len(model.calls) == 3


def test_concurrent_grades_commit_one_attempt(api):
    post, model, engine, _ = api
    q = question(post)
    barrier = Barrier(2, timeout=10)
    model.before_return = barrier.wait

    def submit(answer):
        return post('tutor/answers', {'questionId': q['questionId'], 'answer': answer})

    with ThreadPoolExecutor(max_workers=2) as pool:
        first, second = pool.map(submit, ('wrong', 'It confirms receipt'))
    assert first.status_code == second.status_code == 200
    assert first.json() == second.json()
    with engine.connect() as db:
        assert db.exec_driver_sql('SELECT count(*) FROM attempts').scalar_one() == 1
        assert db.exec_driver_sql('SELECT version FROM graph_versions').scalar_one() == 1
        assert db.exec_driver_sql("SELECT mastery FROM nodes WHERE id = 'n1'").scalar_one() == first.json()['mastery']


@pytest.mark.parametrize('route', ['collisions', 'tutor/questions', 'tutor/answers'])
def test_deletion_while_model_runs_is_rechecked(api, route):
    post, model, engine, _ = api
    q = question(post)

    def delete_node():
        with engine.begin() as db:
            db.exec_driver_sql('BEGIN IMMEDIATE')
            db.exec_driver_sql("DELETE FROM nodes WHERE id = 'n1'")

    model.before_return = delete_node
    data = {'collisions': {'nodeIds': ['n1', 'n2']}, 'tutor/questions': {'nodeId': 'n1'},
            'tutor/answers': {'questionId': q['questionId'], 'answer': 'wrong'}}
    assert post(route, data[route]).status_code == 404
    with engine.connect() as db:
        for table in ('ideas', 'questions', 'attempts', 'graph_versions'):
            assert db.exec_driver_sql(f'SELECT count(*) FROM {table}').scalar_one() == 0
