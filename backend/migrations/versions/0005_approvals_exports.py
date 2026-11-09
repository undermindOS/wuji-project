"""Immutable manual revisions, validation, approvals and content-addressed export receipts."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = '0005'
down_revision = '0004'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('projects', sa.Column('revision_counter', sa.Integer, nullable=False, server_default='0'))
    op.add_column('projects', sa.Column('head_approval_id', sa.String(36)))
    op.create_table('scenario_revisions',
        sa.Column('id',sa.String(36),primary_key=True),
        sa.Column('project_id',sa.String(36),sa.ForeignKey('projects.id'),nullable=False),
        sa.Column('source_id',sa.String(36),sa.ForeignKey('source_versions.id'),nullable=False),
        sa.Column('task_id',sa.String(36),sa.ForeignKey('task_specs.id'),nullable=False),
        sa.Column('run_id',sa.String(36),sa.ForeignKey('runs.id'),nullable=False),
        sa.Column('base_scenario_id',sa.String(100),nullable=False),
        sa.Column('parent_revision_id',sa.String(36),sa.ForeignKey('scenario_revisions.id')),
        sa.Column('version',sa.Integer,nullable=False),
        sa.Column('source_hash',sa.String(64),nullable=False),
        sa.Column('request_key',sa.String(36),nullable=False),
        sa.Column('request_hash',sa.String(64),nullable=False),
        sa.Column('scenario',JSONB,nullable=False),
        sa.Column('created_at',sa.DateTime(timezone=True),nullable=False),
        sa.UniqueConstraint('project_id','version',name='revision_version_uq'),
        sa.UniqueConstraint('project_id','request_key',name='revision_request_uq'))
    op.create_index('ix_scenario_revisions_project_id','scenario_revisions',['project_id'])
    op.create_index('ix_scenario_revisions_run_id','scenario_revisions',['run_id'])
    op.create_table('revision_validations',
        sa.Column('revision_id',sa.String(36),sa.ForeignKey('scenario_revisions.id'),primary_key=True),
        sa.Column('validator_version',sa.String(80),primary_key=True),
        sa.Column('payload',JSONB,nullable=False),
        sa.Column('created_at',sa.DateTime(timezone=True),nullable=False))
    op.create_table('approvals',
        sa.Column('id',sa.String(36),primary_key=True),
        sa.Column('project_id',sa.String(36),sa.ForeignKey('projects.id'),nullable=False),
        sa.Column('source_id',sa.String(36),sa.ForeignKey('source_versions.id'),nullable=False),
        sa.Column('task_id',sa.String(36),sa.ForeignKey('task_specs.id'),nullable=False),
        sa.Column('run_id',sa.String(36),sa.ForeignKey('runs.id'),nullable=False),
        sa.Column('scenario_id',sa.String(100),nullable=False),
        sa.Column('revision_id',sa.String(36),sa.ForeignKey('scenario_revisions.id')),
        sa.Column('candidate_hash',sa.String(64),nullable=False),
        sa.Column('snapshot',JSONB,nullable=False),
        sa.Column('created_at',sa.DateTime(timezone=True),nullable=False))
    op.create_index('ix_approvals_project_id','approvals',['project_id'])
    op.create_foreign_key('projects_approval_fk','projects','approvals',['head_approval_id'],['id'])
    op.create_table('approval_requests',
        sa.Column('id',sa.String(36),primary_key=True),
        sa.Column('project_id',sa.String(36),sa.ForeignKey('projects.id'),nullable=False),
        sa.Column('request_key',sa.String(36),nullable=False),
        sa.Column('request_hash',sa.String(64),nullable=False),
        sa.Column('approval_id',sa.String(36),sa.ForeignKey('approvals.id'),nullable=False),
        sa.Column('created_at',sa.DateTime(timezone=True),nullable=False),
        sa.UniqueConstraint('project_id','request_key',name='approval_request_uq'))
    op.create_table('approved_exports',
        sa.Column('id',sa.String(36),primary_key=True),
        sa.Column('project_id',sa.String(36),sa.ForeignKey('projects.id'),nullable=False),
        sa.Column('approval_id',sa.String(36),sa.ForeignKey('approvals.id'),nullable=False),
        sa.Column('format',sa.String(8),nullable=False),
        sa.Column('exporter_version',sa.String(80),nullable=False),
        sa.Column('sha256',sa.String(64),nullable=False),
        sa.Column('size',sa.Integer,nullable=False),
        sa.Column('filename',sa.String(160),nullable=False),
        sa.Column('media_type',sa.String(100),nullable=False),
        sa.Column('created_at',sa.DateTime(timezone=True),nullable=False),
        sa.UniqueConstraint('approval_id','format','exporter_version',name='approved_export_uq'),
        sa.CheckConstraint("format IN ('csv','xlsx')",name='approved_export_format_ck'))
    op.create_index('ix_approved_exports_project_id','approved_exports',['project_id'])
    for table in ['scenario_revisions','revision_validations','approvals','approval_requests','approved_exports']:
        op.execute(f'CREATE TRIGGER immutable_version BEFORE UPDATE OR DELETE ON {table} FOR EACH ROW EXECUTE FUNCTION wuji_immutable_version()')


def downgrade():
    op.drop_constraint('projects_approval_fk','projects',type_='foreignkey')
    for table in ['approved_exports','approval_requests','approvals','revision_validations','scenario_revisions']:
        op.drop_table(table)
    op.drop_column('projects','head_approval_id')
    op.drop_column('projects','revision_counter')
