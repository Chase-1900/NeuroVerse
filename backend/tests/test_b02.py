import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import inspect
from sqlalchemy.exc import IntegrityError

from app.database import BACKEND, open_engine

GRAPH_TABLES = {'documents', 'chunks', 'nodes', 'edges', 'node_sources', 'graph_versions'}


def seed_session(db, owner):
    db.exec_driver_sql('INSERT INTO sessions VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)', (owner, owner * 64))


def seed_graph(db):
    for owner in ('a', 'b'):
        seed_session(db, owner)
        db.exec_driver_sql('INSERT INTO documents (id, owner_id, title, status, content_hash) VALUES (?, ?, ?, ?, ?)',
                           (owner, owner, '网络笔记', 'succeeded', 'hash'))
        db.exec_driver_sql('INSERT INTO chunks (id, owner_id, document_id, page, ordinal, text) VALUES (?, ?, ?, ?, ?, ?)',
                           (owner, owner, owner, 1, 0, 'TCP 使用 ACK'))
    for identifier, owner, title in [('n1', 'a', 'tcp'), ('n2', 'a', 'ack'), ('n3', 'b', 'tcp')]:
        db.exec_driver_sql('INSERT INTO nodes (id, owner_id, title, norm_title, category) VALUES (?, ?, ?, ?, ?)',
                           (identifier, owner, title.upper(), title, '网络'))
    db.exec_driver_sql("INSERT INTO edges (id, owner_id, source_id, target_id, relation) VALUES ('e1', 'a', 'n1', 'n2', '使用')")
    db.exec_driver_sql("INSERT INTO node_sources (owner_id, node_id, chunk_id, snippet) VALUES ('a', 'n1', 'a', 'TCP 使用 ACK')")


@pytest.fixture
def storage(tmp_path, monkeypatch):
    monkeypatch.setenv('DATABASE_URL', f'sqlite:///{(tmp_path / "graph.db").as_posix()}')
    engine = open_engine()
    try:
        yield Config(BACKEND / 'alembic.ini'), engine
    finally:
        engine.dispose()


@pytest.fixture
def graph(storage):
    config, engine = storage
    command.upgrade(config, 'head')
    assert GRAPH_TABLES <= set(inspect(engine).get_table_names())
    with engine.begin() as db:
        seed_graph(db)
        yield db


def test_upgrade_from_b01_preserves_sessions_and_can_round_trip(storage):
    config, engine = storage
    command.upgrade(config, '0001_sessions')
    with engine.begin() as db:
        seed_session(db, 'a')
    command.upgrade(config, 'head')
    assert GRAPH_TABLES <= set(inspect(engine).get_table_names())
    command.check(config)
    command.downgrade(config, '0001_sessions')
    assert GRAPH_TABLES.isdisjoint(inspect(engine).get_table_names())
    command.upgrade(config, 'head')
    with engine.connect() as db:
        assert db.exec_driver_sql('SELECT id, token_hash FROM sessions').all() == [('a', 'a' * 64)]
        assert db.exec_driver_sql('PRAGMA foreign_key_check').all() == []


@pytest.mark.parametrize(('sql', 'reason'), [
    ("UPDATE nodes SET mastery = 101 WHERE id = 'n1'", 'ck_nodes_mastery'),
    ("UPDATE nodes SET mastery = 1.5 WHERE id = 'n1'", 'ck_nodes_mastery'),
    ("UPDATE nodes SET kind = 'other' WHERE id = 'n1'", 'ck_nodes_kind'),
    ("UPDATE nodes SET title = '' WHERE id = 'n1'", 'ck_nodes_title'),
    ("UPDATE nodes SET norm_title = 'tcp' WHERE id = 'n2'", 'UNIQUE constraint'),
    ("UPDATE edges SET target_id = 'n1' WHERE id = 'e1'", 'ck_edges_no_loop'),
    ("UPDATE edges SET relation = ' ' WHERE id = 'e1'", 'ck_edges_relation'),
    ("UPDATE edges SET target_id = 'missing' WHERE id = 'e1'", 'FOREIGN KEY constraint'),
    ("UPDATE edges SET source_id = 'n3' WHERE id = 'e1'", 'FOREIGN KEY constraint'),
    ("UPDATE edges SET target_id = 'n3' WHERE id = 'e1'", 'FOREIGN KEY constraint'),
    ("INSERT INTO edges SELECT 'e2', owner_id, source_id, target_id, relation FROM edges", 'UNIQUE constraint'),
    ("INSERT INTO node_sources SELECT * FROM node_sources", 'UNIQUE constraint'),
    ("UPDATE node_sources SET chunk_id = 'b' WHERE node_id = 'n1'", 'FOREIGN KEY constraint'),
    ("UPDATE node_sources SET node_id = 'n3' WHERE node_id = 'n1'", 'FOREIGN KEY constraint'),
    ("UPDATE node_sources SET chunk_id = 'missing' WHERE node_id = 'n1'", 'FOREIGN KEY constraint'),
    ("UPDATE chunks SET document_id = 'b' WHERE id = 'a'", 'FOREIGN KEY constraint'),
    ("UPDATE chunks SET page = 0 WHERE id = 'a'", 'ck_chunks_page'),
    ("INSERT INTO graph_versions (owner_id, version) VALUES ('a', -1)", 'ck_graph_versions_version'),
])
def test_database_rejects_invalid_graph_rows(graph, sql, reason):
    assert graph.exec_driver_sql('PRAGMA foreign_keys').scalar_one() == 1
    with pytest.raises(IntegrityError, match=reason):
        graph.exec_driver_sql(sql)


def test_deleting_node_preserves_document_and_chunk(graph):
    graph.exec_driver_sql("DELETE FROM nodes WHERE id = 'n1'")
    assert graph.exec_driver_sql('SELECT id FROM nodes ORDER BY id').scalars().all() == ['n2', 'n3']
    assert graph.exec_driver_sql('SELECT id FROM edges').all() == []
    assert graph.exec_driver_sql('SELECT node_id FROM node_sources').all() == []
    assert graph.exec_driver_sql("SELECT text FROM chunks WHERE id = 'a'").scalar_one() == 'TCP 使用 ACK'
    assert graph.exec_driver_sql("SELECT title FROM documents WHERE id = 'a'").scalar_one() == '网络笔记'


def test_successful_document_dedup_allows_retry_after_failure(graph):
    graph.exec_driver_sql("INSERT INTO documents (id, owner_id, title, status, content_hash) VALUES ('retry', 'a', '重试', 'failed', 'hash')")
    with pytest.raises(IntegrityError, match='UNIQUE constraint'):
        graph.exec_driver_sql("UPDATE documents SET status = 'succeeded' WHERE id = 'retry'")
    graph.exec_driver_sql("UPDATE documents SET status = 'succeeded', content_hash = 'new-hash' WHERE id = 'retry'")
    assert graph.exec_driver_sql("SELECT status FROM documents WHERE id = 'retry'").scalar_one() == 'succeeded'


def test_node_delete_rolls_back_with_its_edges_and_sources(graph):
    savepoint = graph.begin_nested()
    graph.exec_driver_sql("DELETE FROM nodes WHERE id = 'n2'")
    assert graph.exec_driver_sql('SELECT id FROM edges').all() == []
    graph.exec_driver_sql("DELETE FROM nodes WHERE id = 'n1'")
    assert graph.exec_driver_sql('SELECT node_id FROM node_sources').all() == []
    savepoint.rollback()
    assert graph.exec_driver_sql('SELECT id FROM edges').scalar_one() == 'e1'
    assert graph.exec_driver_sql('SELECT node_id FROM node_sources').scalar_one() == 'n1'


def test_graph_identity_allows_other_category_and_version_per_owner(graph):
    graph.exec_driver_sql("INSERT INTO nodes (id, owner_id, title, norm_title, category) VALUES ('n4', 'a', 'TCP', 'tcp', '实验')")
    graph.exec_driver_sql("INSERT INTO graph_versions (owner_id) VALUES ('a'), ('b')")
    assert graph.exec_driver_sql('SELECT version FROM graph_versions ORDER BY owner_id').scalars().all() == [0, 0]
    with pytest.raises(IntegrityError, match='UNIQUE constraint'):
        graph.exec_driver_sql("INSERT INTO graph_versions (owner_id) VALUES ('a')")
