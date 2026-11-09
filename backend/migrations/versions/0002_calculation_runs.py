"""Durable calculation queue and immutable completed results."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = '0002'
down_revision = '0001'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('runs',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('project_id', sa.String(36), sa.ForeignKey('projects.id'), nullable=False),
        sa.Column('source_id', sa.String(36), sa.ForeignKey('source_versions.id'), nullable=False),
        sa.Column('task_id', sa.String(36), sa.ForeignKey('task_specs.id'), nullable=False),
        sa.Column('source_hash', sa.String(64), nullable=False),
        sa.Column('engine_version', sa.String(100), nullable=False),
        sa.Column('request_key', sa.String(36), nullable=False),
        sa.Column('request_context', sa.String(64), nullable=False),
        sa.Column('max_time_seconds', sa.Integer, nullable=False),
        sa.Column('status', sa.String(24), nullable=False),
        sa.Column('cancel_requested', sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column('worker_token', sa.String(36)),
        sa.Column('events', JSONB, nullable=False),
        sa.Column('result', JSONB(none_as_null=True)),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('started_at', sa.DateTime(timezone=True)),
        sa.Column('finished_at', sa.DateTime(timezone=True)),
        sa.Column('heartbeat_at', sa.DateTime(timezone=True)),
        sa.UniqueConstraint('project_id', 'request_key', name='run_request_uq'),
        sa.CheckConstraint("status IN ('queued','running','completed','needs_clarification','failed','cancelled')", name='run_status_ck'),
        sa.CheckConstraint('max_time_seconds BETWEEN 1 AND 30', name='run_time_ck'))
    op.create_index('ix_runs_project_id', 'runs', ['project_id'])
    op.create_index('ix_runs_status', 'runs', ['status'])
    op.create_index('run_one_active_project_uq', 'runs', ['project_id'], unique=True,
        postgresql_where=sa.text("status IN ('queued','running')"))
    op.execute("""CREATE FUNCTION wuji_run_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'WUJI runs cannot be deleted' USING ERRCODE = '23514';
      END IF;
      IF OLD.status NOT IN ('queued','running') THEN
        RAISE EXCEPTION 'WUJI completed runs are immutable' USING ERRCODE = '23514';
      END IF;
      IF ROW(NEW.id,NEW.project_id,NEW.source_id,NEW.task_id,NEW.source_hash,NEW.engine_version,
          NEW.request_key,NEW.request_context,NEW.max_time_seconds,NEW.created_at)
          IS DISTINCT FROM ROW(OLD.id,OLD.project_id,OLD.source_id,OLD.task_id,OLD.source_hash,OLD.engine_version,
          OLD.request_key,OLD.request_context,OLD.max_time_seconds,OLD.created_at) THEN
        RAISE EXCEPTION 'WUJI run inputs are immutable' USING ERRCODE = '23514';
      END IF;
      IF (OLD.status = 'queued' AND NEW.status NOT IN ('queued','running','cancelled'))
          OR (OLD.status = 'running' AND NEW.status = 'queued') THEN
        RAISE EXCEPTION 'WUJI invalid run transition' USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END; $$""")
    op.execute('CREATE TRIGGER run_guard BEFORE UPDATE OR DELETE ON runs FOR EACH ROW EXECUTE FUNCTION wuji_run_guard()')


def downgrade():
    op.drop_table('runs')
    op.execute('DROP FUNCTION wuji_run_guard()')
