import os
from pathlib import Path

from sqlalchemy import (
    CheckConstraint, Column, DateTime, ForeignKey, ForeignKeyConstraint, Index, Integer,
    MetaData, String, Table, Text, UniqueConstraint, create_engine, event, func, text,
)
from sqlalchemy.engine import make_url

BACKEND = Path(__file__).resolve().parents[1]
metadata = MetaData()
sessions = Table(
    'sessions', metadata,
    Column('id', String(36), primary_key=True),
    Column('token_hash', String(64), unique=True, nullable=False),
    Column('created_at', DateTime(), nullable=False),
    Column('expires_at', DateTime(), nullable=False),
)


documents = Table(
    'documents', metadata,
    Column('id', String(36), primary_key=True),
    Column('owner_id', String(36), ForeignKey('sessions.id', ondelete='CASCADE'), nullable=False),
    Column('title', Text, nullable=False),
    Column('status', String(9), nullable=False, server_default='pending'),
    Column('content_hash', String(64), nullable=False),
    Column('created_at', DateTime(), nullable=False, server_default=func.current_timestamp()),
    UniqueConstraint('owner_id', 'id', name='uq_documents_owner_id'),
    CheckConstraint("status IN ('pending', 'running', 'succeeded', 'failed')", name='ck_documents_status'),
)
Index('uq_documents_successful_content', documents.c.owner_id, documents.c.content_hash,
      unique=True, sqlite_where=documents.c.status == 'succeeded')

chunks = Table(
    'chunks', metadata,
    Column('id', String(36), primary_key=True),
    Column('owner_id', String(36), nullable=False),
    Column('document_id', String(36), nullable=False),
    Column('page', Integer),
    Column('ordinal', Integer, nullable=False),
    Column('text', Text, nullable=False),
    ForeignKeyConstraint(['owner_id', 'document_id'], ['documents.owner_id', 'documents.id'], ondelete='CASCADE'),
    UniqueConstraint('owner_id', 'id', name='uq_chunks_owner_id'),
    UniqueConstraint('owner_id', 'document_id', 'ordinal', name='uq_chunks_document_ordinal'),
    CheckConstraint("page IS NULL OR (typeof(page) = 'integer' AND page >= 1)", name='ck_chunks_page'),
    CheckConstraint("typeof(ordinal) = 'integer' AND ordinal >= 0", name='ck_chunks_ordinal'),
)

nodes = Table(
    'nodes', metadata,
    Column('id', String(36), primary_key=True),
    Column('owner_id', String(36), ForeignKey('sessions.id', ondelete='CASCADE'), nullable=False),
    Column('title', String(120), nullable=False),
    Column('norm_title', Text, nullable=False),
    Column('category', String(80), nullable=False),
    Column('kind', String(9), nullable=False, server_default='knowledge'),
    Column('summary', String(1000), nullable=False, server_default=''),
    Column('mastery', Integer, nullable=False, server_default='0'),
    Column('created_at', DateTime(), nullable=False, server_default=func.current_timestamp()),
    UniqueConstraint('owner_id', 'id', name='uq_nodes_owner_id'),
    UniqueConstraint('owner_id', 'category', 'norm_title', name='uq_nodes_owner_category_title'),
    CheckConstraint('length(title) BETWEEN 1 AND 120', name='ck_nodes_title'),
    CheckConstraint('length(norm_title) > 0', name='ck_nodes_norm_title'),
    CheckConstraint('length(category) BETWEEN 1 AND 80', name='ck_nodes_category'),
    CheckConstraint('length(summary) <= 1000', name='ck_nodes_summary'),
    CheckConstraint("kind IN ('knowledge', 'idea')", name='ck_nodes_kind'),
    CheckConstraint("typeof(mastery) = 'integer' AND mastery BETWEEN 0 AND 100", name='ck_nodes_mastery'),
)

edges = Table(
    'edges', metadata,
    Column('id', String(36), primary_key=True),
    Column('owner_id', String(36), nullable=False),
    Column('source_id', String(36), nullable=False),
    Column('target_id', String(36), nullable=False),
    Column('relation', Text, nullable=False),
    ForeignKeyConstraint(['owner_id', 'source_id'], ['nodes.owner_id', 'nodes.id'], ondelete='CASCADE'),
    ForeignKeyConstraint(['owner_id', 'target_id'], ['nodes.owner_id', 'nodes.id'], ondelete='CASCADE'),
    UniqueConstraint('owner_id', 'source_id', 'target_id', 'relation', name='uq_edges_endpoints_relation'),
    CheckConstraint('source_id <> target_id', name='ck_edges_no_loop'),
    CheckConstraint('length(trim(relation, char(9, 10, 11, 12, 13, 32))) > 0', name='ck_edges_relation'),
    Index('ix_edges_owner_target', 'owner_id', 'target_id'),
)

node_sources = Table(
    'node_sources', metadata,
    Column('owner_id', String(36), primary_key=True),
    Column('node_id', String(36), primary_key=True),
    Column('chunk_id', String(36), primary_key=True),
    Column('snippet', Text, nullable=False),
    ForeignKeyConstraint(['owner_id', 'node_id'], ['nodes.owner_id', 'nodes.id'], ondelete='CASCADE'),
    ForeignKeyConstraint(['owner_id', 'chunk_id'], ['chunks.owner_id', 'chunks.id'], ondelete='CASCADE'),
    Index('ix_node_sources_owner_chunk', 'owner_id', 'chunk_id'),
)

graph_versions = Table(
    'graph_versions', metadata,
    Column('owner_id', String(36), ForeignKey('sessions.id', ondelete='CASCADE'), primary_key=True),
    Column('version', Integer, nullable=False, server_default=text('0')),
    CheckConstraint("typeof(version) = 'integer' AND version >= 0", name='ck_graph_versions_version'),
)


def open_engine():
    url = make_url(os.getenv('DATABASE_URL', 'sqlite:///./data/neuroverse.db'))
    if url.database and url.database != ':memory:':
        Path(url.database).parent.mkdir(parents=True, exist_ok=True)
    engine = create_engine(url, hide_parameters=True)

    @event.listens_for(engine, 'connect')
    def enable_foreign_keys(connection, _):
        connection.execute('PRAGMA foreign_keys=ON')

    return engine
