"""attachments table (anexos no banco)"""
from alembic import op
import sqlalchemy as sa

revision = '0002'
down_revision = '0001'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('attachments',
                    sa.Column('id', sa.String(length=40), nullable=False),
                    sa.Column('data', sa.LargeBinary(), nullable=False),
                    sa.PrimaryKeyConstraint('id'))
    if op.get_bind().dialect.name == 'postgresql':
        # API REST publica do Supabase nao deve enxergar a tabela (acesso so pelo app)
        op.execute('ALTER TABLE attachments ENABLE ROW LEVEL SECURITY')


def downgrade():
    op.drop_table('attachments')
