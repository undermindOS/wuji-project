"""Auditable provider jobs and explicit confirmation of interpretation."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = '0004'
down_revision = '0003'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('intent_drafts',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('project_id', sa.String(36), sa.ForeignKey('projects.id'), nullable=False),
        sa.Column('source_id', sa.String(36), sa.ForeignKey('source_versions.id'), nullable=False),
        sa.Column('task_id', sa.String(36), sa.ForeignKey('task_specs.id'), nullable=False),
        sa.Column('source_hash', sa.String(64), nullable=False),
        sa.Column('request', sa.String(8000), nullable=False),
        sa.Column('request_hash', sa.String(64), nullable=False),
        sa.Column('request_key', sa.String(36), nullable=False),
        sa.Column('model', sa.String(100), nullable=False),
        sa.Column('provider_mode', sa.String(12), nullable=False),
        sa.Column('prompt_version', sa.String(80), nullable=False),
        sa.Column('payload', JSONB, nullable=False),
        sa.Column('price', JSONB, nullable=False),
        sa.Column('max_cost_micro_usd', sa.Integer, nullable=False),
        sa.Column('estimated_max_cost_micro_usd', sa.Integer, nullable=False),
        sa.Column('status', sa.String(24), nullable=False),
        sa.Column('cancel_requested', sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column('worker_token', sa.String(36)),
        sa.Column('response_model', sa.String(100)),
        sa.Column('response_id', sa.String(200)),
        sa.Column('proposal', JSONB(none_as_null=True)),
        sa.Column('usage', JSONB(none_as_null=True)),
        sa.Column('events', JSONB, nullable=False),
        sa.Column('confirmed_task_id', sa.String(36), sa.ForeignKey('task_specs.id')),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('heartbeat_at', sa.DateTime(timezone=True)),
        sa.Column('finished_at', sa.DateTime(timezone=True)),
        sa.UniqueConstraint('project_id', 'request_key', name='intent_request_uq'),
        sa.CheckConstraint("status IN ('queued','running','ready','needs_clarification','failed','cancelled','confirmed')", name='intent_status_ck'))
    op.create_index('ix_intent_drafts_project_id', 'intent_drafts', ['project_id'])
    op.create_index('ix_intent_drafts_status', 'intent_drafts', ['status'])
    op.create_index('intent_one_active_input_uq', 'intent_drafts', ['project_id','source_id','task_id'], unique=True,
        postgresql_where=sa.text("status IN ('queued','running')"))
    op.execute("""CREATE FUNCTION wuji_intent_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'WUJI intent history cannot be deleted' USING ERRCODE = '23514'; END IF;
      IF ROW(NEW.id,NEW.project_id,NEW.source_id,NEW.task_id,NEW.source_hash,NEW.request,NEW.request_hash,
        NEW.request_key,NEW.model,NEW.provider_mode,NEW.prompt_version,NEW.payload,NEW.price,NEW.max_cost_micro_usd,
        NEW.estimated_max_cost_micro_usd,NEW.created_at) IS DISTINCT FROM
        ROW(OLD.id,OLD.project_id,OLD.source_id,OLD.task_id,OLD.source_hash,OLD.request,OLD.request_hash,
        OLD.request_key,OLD.model,OLD.provider_mode,OLD.prompt_version,OLD.payload,OLD.price,OLD.max_cost_micro_usd,
        OLD.estimated_max_cost_micro_usd,OLD.created_at) THEN
        RAISE EXCEPTION 'WUJI intent inputs are immutable' USING ERRCODE = '23514';
      END IF;
      IF OLD.status NOT IN ('queued','running') THEN
        IF OLD.status = 'ready' AND NEW.status = 'confirmed' AND OLD.confirmed_task_id IS NULL
          AND NEW.confirmed_task_id IS NOT NULL
          AND ROW(NEW.proposal,NEW.usage,NEW.response_model,NEW.response_id,NEW.events,NEW.cancel_requested,
            NEW.worker_token,NEW.heartbeat_at,NEW.finished_at)
            IS NOT DISTINCT FROM ROW(OLD.proposal,OLD.usage,OLD.response_model,OLD.response_id,OLD.events,
            OLD.cancel_requested,OLD.worker_token,OLD.heartbeat_at,OLD.finished_at) THEN RETURN NEW; END IF;
        RAISE EXCEPTION 'WUJI intent results are immutable' USING ERRCODE = '23514';
      END IF;
      IF OLD.status = 'queued' AND NEW.status NOT IN ('queued','running','cancelled') THEN
        RAISE EXCEPTION 'WUJI invalid intent transition' USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END; $$""")
    op.execute('CREATE TRIGGER intent_guard BEFORE UPDATE OR DELETE ON intent_drafts FOR EACH ROW EXECUTE FUNCTION wuji_intent_guard()')


def downgrade():
    op.drop_table('intent_drafts')
    op.execute('DROP FUNCTION wuji_intent_guard()')
