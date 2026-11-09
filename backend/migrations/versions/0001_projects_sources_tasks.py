"""Projects, staged imports and append-only source/task versions."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = '0001'
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('projects',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('name', sa.String(120), nullable=False),
        sa.Column('head_source_id', sa.String(36)), sa.Column('head_task_id', sa.String(36)),
        sa.Column('source_counter', sa.Integer, nullable=False, server_default='0'),
        sa.Column('task_counter', sa.Integer, nullable=False, server_default='0'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()))
    op.create_table('source_versions',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('project_id', sa.String(36), sa.ForeignKey('projects.id'), nullable=False),
        sa.Column('version', sa.Integer, nullable=False),
        sa.Column('content_hash', sa.String(64), nullable=False),
        sa.Column('payload', JSONB, nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint('project_id', 'version', name='source_project_version_uq'))
    op.create_index('ix_source_versions_project_id', 'source_versions', ['project_id'])
    op.create_table('task_specs',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('project_id', sa.String(36), sa.ForeignKey('projects.id'), nullable=False),
        sa.Column('source_id', sa.String(36), sa.ForeignKey('source_versions.id'), nullable=False),
        sa.Column('version', sa.Integer, nullable=False), sa.Column('payload', JSONB, nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint('project_id', 'version', name='task_project_version_uq'))
    op.create_index('ix_task_specs_project_id', 'task_specs', ['project_id'])
    op.create_index('ix_task_specs_source_id', 'task_specs', ['source_id'])
    op.create_table('import_drafts',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('project_id', sa.String(36), sa.ForeignKey('projects.id'), nullable=False),
        sa.Column('expected_source_id', sa.String(36), sa.ForeignKey('source_versions.id')),
        sa.Column('preview', JSONB, nullable=False),
        sa.Column('confirmed_source_id', sa.String(36), sa.ForeignKey('source_versions.id')),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()))
    op.create_index('ix_import_drafts_project_id', 'import_drafts', ['project_id'])
    op.create_foreign_key('projects_head_source_fk', 'projects', 'source_versions', ['head_source_id'], ['id'])
    op.create_foreign_key('projects_head_task_fk', 'projects', 'task_specs', ['head_task_id'], ['id'])
    op.execute("""CREATE FUNCTION wuji_immutable_version() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'WUJI versions are immutable' USING ERRCODE = '23514'; END;
    $$""")
    for table in ['source_versions', 'task_specs']:
        op.execute(f'CREATE TRIGGER immutable_version BEFORE UPDATE OR DELETE ON {table} FOR EACH ROW EXECUTE FUNCTION wuji_immutable_version()')


def downgrade():
    for table in ['source_versions', 'task_specs']:
        op.execute(f'DROP TRIGGER immutable_version ON {table}')
    op.execute('DROP FUNCTION wuji_immutable_version()')
    op.drop_constraint('projects_head_task_fk', 'projects', type_='foreignkey')
    op.drop_constraint('projects_head_source_fk', 'projects', type_='foreignkey')
    for table in ['import_drafts', 'task_specs', 'source_versions', 'projects']:
        op.drop_table(table)
