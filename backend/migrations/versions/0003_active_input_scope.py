"""New conditions can be queued while a historical input is still running."""
from alembic import op
import sqlalchemy as sa

revision = '0003'
down_revision = '0002'
branch_labels = None
depends_on = None


def upgrade():
    op.drop_index('run_one_active_project_uq', table_name='runs')
    op.create_index('run_one_active_input_uq', 'runs', ['project_id', 'source_id', 'task_id'], unique=True,
        postgresql_where=sa.text("status IN ('queued','running')"))


def downgrade():
    op.drop_index('run_one_active_input_uq', table_name='runs')
    op.create_index('run_one_active_project_uq', 'runs', ['project_id'], unique=True,
        postgresql_where=sa.text("status IN ('queued','running')"))
