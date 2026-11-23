from sqlalchemy import JSON, Boolean, CheckConstraint, Column, DateTime, ForeignKey, ForeignKeyConstraint, Index, Integer, String, Table, Text, UniqueConstraint, func

from app.database import metadata

jobs = Table(
    'jobs', metadata,
    Column('id', String(36), primary_key=True),
    Column('owner_id', String(36), nullable=False),
    Column('document_id', String(36), nullable=False, unique=True),
    Column('status', String(9), nullable=False, server_default='pending'),
    Column('error_code', String(64)),
    Column('error_message', Text),
    Column('graph_version', Integer),
    Column('created_at', DateTime, nullable=False, server_default=func.current_timestamp()),
    ForeignKeyConstraint(['owner_id', 'document_id'], ['documents.owner_id', 'documents.id'], ondelete='CASCADE'),
    CheckConstraint("status IN ('pending', 'running', 'succeeded', 'failed')", name='ck_jobs_status'),
    Index('ix_jobs_status_created', 'status', 'created_at', 'id'),
)

ideas = Table(
    'ideas', metadata,
    Column('id', String(36), primary_key=True),
    Column('owner_id', String(36), ForeignKey('sessions.id', ondelete='CASCADE'), nullable=False),
    Column('source_ids', JSON, nullable=False),
    Column('generated_json', JSON, nullable=False),
    Column('saved_node_id', String(36), ForeignKey('nodes.id', ondelete='SET NULL'), unique=True),
    Column('was_saved', Boolean, nullable=False, server_default='0'),
)

questions = Table(
    'questions', metadata,
    Column('id', String(36), primary_key=True),
    Column('owner_id', String(36), nullable=False),
    Column('node_id', String(36), nullable=False),
    Column('question', Text, nullable=False),
    Column('expected_answer', Text, nullable=False),
    Column('rubric', JSON, nullable=False),
    ForeignKeyConstraint(['owner_id', 'node_id'], ['nodes.owner_id', 'nodes.id'], ondelete='CASCADE'),
    UniqueConstraint('owner_id', 'id', name='uq_questions_owner_id'),
    Index('ix_questions_owner_node', 'owner_id', 'node_id'),
)

attempts = Table(
    'attempts', metadata,
    Column('question_id', String(36), primary_key=True),
    Column('owner_id', String(36), nullable=False),
    Column('result', JSON, nullable=False),
    ForeignKeyConstraint(['owner_id', 'question_id'], ['questions.owner_id', 'questions.id'], ondelete='CASCADE'),
)
