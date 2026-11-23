from alembic import op
import sqlalchemy as sa

revision = '0001_sessions'
down_revision = None


def upgrade():
    op.create_table(
        'sessions',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('token_hash', sa.String(64), nullable=False, unique=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('expires_at', sa.DateTime(), nullable=False),
    )


def downgrade():
    op.drop_table('sessions')
