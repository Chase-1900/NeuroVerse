import sqlalchemy as sa
from alembic import op

revision = '0002_graph'
down_revision = '0001_sessions'


def upgrade():
    op.create_table(
        'documents',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('owner_id', sa.String(36), sa.ForeignKey('sessions.id', ondelete='CASCADE'), nullable=False),
        sa.Column('title', sa.Text(), nullable=False),
        sa.Column('status', sa.String(9), nullable=False, server_default='pending'),
        sa.Column('content_hash', sa.String(64), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.current_timestamp()),
        sa.UniqueConstraint('owner_id', 'id', name='uq_documents_owner_id'),
        sa.CheckConstraint("status IN ('pending', 'running', 'succeeded', 'failed')", name='ck_documents_status'),
    )
    op.create_index('uq_documents_successful_content', 'documents', ['owner_id', 'content_hash'],
                    unique=True, sqlite_where=sa.text("status = 'succeeded'"))
    op.create_table(
        'chunks',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('owner_id', sa.String(36), nullable=False),
        sa.Column('document_id', sa.String(36), nullable=False),
        sa.Column('page', sa.Integer()),
        sa.Column('ordinal', sa.Integer(), nullable=False),
        sa.Column('text', sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(['owner_id', 'document_id'], ['documents.owner_id', 'documents.id'], ondelete='CASCADE'),
        sa.UniqueConstraint('owner_id', 'id', name='uq_chunks_owner_id'),
        sa.UniqueConstraint('owner_id', 'document_id', 'ordinal', name='uq_chunks_document_ordinal'),
        sa.CheckConstraint("page IS NULL OR (typeof(page) = 'integer' AND page >= 1)", name='ck_chunks_page'),
        sa.CheckConstraint("typeof(ordinal) = 'integer' AND ordinal >= 0", name='ck_chunks_ordinal'),
    )
    op.create_table(
        'nodes',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('owner_id', sa.String(36), sa.ForeignKey('sessions.id', ondelete='CASCADE'), nullable=False),
        sa.Column('title', sa.String(120), nullable=False),
        sa.Column('norm_title', sa.Text(), nullable=False),
        sa.Column('category', sa.String(80), nullable=False),
        sa.Column('kind', sa.String(9), nullable=False, server_default='knowledge'),
        sa.Column('summary', sa.String(1000), nullable=False, server_default=''),
        sa.Column('mastery', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.current_timestamp()),
        sa.UniqueConstraint('owner_id', 'id', name='uq_nodes_owner_id'),
        sa.UniqueConstraint('owner_id', 'category', 'norm_title', name='uq_nodes_owner_category_title'),
        sa.CheckConstraint('length(title) BETWEEN 1 AND 120', name='ck_nodes_title'),
        sa.CheckConstraint('length(norm_title) > 0', name='ck_nodes_norm_title'),
        sa.CheckConstraint('length(category) BETWEEN 1 AND 80', name='ck_nodes_category'),
        sa.CheckConstraint('length(summary) <= 1000', name='ck_nodes_summary'),
        sa.CheckConstraint("kind IN ('knowledge', 'idea')", name='ck_nodes_kind'),
        sa.CheckConstraint("typeof(mastery) = 'integer' AND mastery BETWEEN 0 AND 100", name='ck_nodes_mastery'),
    )
    op.create_table(
        'edges',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('owner_id', sa.String(36), nullable=False),
        sa.Column('source_id', sa.String(36), nullable=False),
        sa.Column('target_id', sa.String(36), nullable=False),
        sa.Column('relation', sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(['owner_id', 'source_id'], ['nodes.owner_id', 'nodes.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['owner_id', 'target_id'], ['nodes.owner_id', 'nodes.id'], ondelete='CASCADE'),
        sa.UniqueConstraint('owner_id', 'source_id', 'target_id', 'relation', name='uq_edges_endpoints_relation'),
        sa.CheckConstraint('source_id <> target_id', name='ck_edges_no_loop'),
        sa.CheckConstraint('length(trim(relation, char(9, 10, 11, 12, 13, 32))) > 0', name='ck_edges_relation'),
    )
    op.create_index('ix_edges_owner_target', 'edges', ['owner_id', 'target_id'])
    op.create_table(
        'node_sources',
        sa.Column('owner_id', sa.String(36), primary_key=True),
        sa.Column('node_id', sa.String(36), primary_key=True),
        sa.Column('chunk_id', sa.String(36), primary_key=True),
        sa.Column('snippet', sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(['owner_id', 'node_id'], ['nodes.owner_id', 'nodes.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['owner_id', 'chunk_id'], ['chunks.owner_id', 'chunks.id'], ondelete='CASCADE'),
    )
    op.create_index('ix_node_sources_owner_chunk', 'node_sources', ['owner_id', 'chunk_id'])
    op.create_table(
        'graph_versions',
        sa.Column('owner_id', sa.String(36), sa.ForeignKey('sessions.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('version', sa.Integer(), nullable=False, server_default=sa.text('0')),
        sa.CheckConstraint("typeof(version) = 'integer' AND version >= 0", name='ck_graph_versions_version'),
    )


def downgrade():
    for table in ('graph_versions', 'node_sources', 'edges', 'nodes', 'chunks', 'documents'):
        op.drop_table(table)
