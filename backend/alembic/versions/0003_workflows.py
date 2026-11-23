import sqlalchemy as sa
from alembic import op

revision = '0003_workflows'
down_revision = '0002_graph'


def upgrade():
    op.create_table(
        'jobs', sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('owner_id', sa.String(36), nullable=False),
        sa.Column('document_id', sa.String(36), nullable=False, unique=True),
        sa.Column('status', sa.String(9), nullable=False, server_default='pending'),
        sa.Column('error_code', sa.String(64)), sa.Column('error_message', sa.Text()),
        sa.Column('graph_version', sa.Integer()),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.current_timestamp()),
        sa.ForeignKeyConstraint(['owner_id', 'document_id'], ['documents.owner_id', 'documents.id'], ondelete='CASCADE'),
        sa.CheckConstraint("status IN ('pending', 'running', 'succeeded', 'failed')", name='ck_jobs_status'),
    )
    op.create_index('ix_jobs_status_created', 'jobs', ['status', 'created_at', 'id'])
    op.create_table(
        'ideas', sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('owner_id', sa.String(36), sa.ForeignKey('sessions.id', ondelete='CASCADE'), nullable=False),
        sa.Column('source_ids', sa.JSON(), nullable=False), sa.Column('generated_json', sa.JSON(), nullable=False),
        sa.Column('saved_node_id', sa.String(36), sa.ForeignKey('nodes.id', ondelete='SET NULL'), unique=True),
        sa.Column('was_saved', sa.Boolean(), nullable=False, server_default='0'),
    )
    op.create_table(
        'questions', sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('owner_id', sa.String(36), nullable=False), sa.Column('node_id', sa.String(36), nullable=False),
        sa.Column('question', sa.Text(), nullable=False), sa.Column('expected_answer', sa.Text(), nullable=False),
        sa.Column('rubric', sa.JSON(), nullable=False),
        sa.ForeignKeyConstraint(['owner_id', 'node_id'], ['nodes.owner_id', 'nodes.id'], ondelete='CASCADE'),
        sa.UniqueConstraint('owner_id', 'id', name='uq_questions_owner_id'),
    )
    op.create_index('ix_questions_owner_node', 'questions', ['owner_id', 'node_id'])
    op.create_table(
        'attempts', sa.Column('question_id', sa.String(36), primary_key=True),
        sa.Column('owner_id', sa.String(36), nullable=False), sa.Column('result', sa.JSON(), nullable=False),
        sa.ForeignKeyConstraint(['owner_id', 'question_id'], ['questions.owner_id', 'questions.id'], ondelete='CASCADE'),
    )


def downgrade():
    for table in ('attempts', 'questions', 'ideas', 'jobs'):
        op.drop_table(table)
