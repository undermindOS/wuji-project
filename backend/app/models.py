from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class Project(Base):
    __tablename__ = 'projects'
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    head_source_id: Mapped[str | None] = mapped_column(ForeignKey('source_versions.id', name='projects_head_source_fk', use_alter=True))
    head_task_id: Mapped[str | None] = mapped_column(ForeignKey('task_specs.id', name='projects_head_task_fk', use_alter=True))
    source_counter: Mapped[int] = mapped_column(Integer, default=0)
    task_counter: Mapped[int] = mapped_column(Integer, default=0)
    revision_counter: Mapped[int] = mapped_column(Integer, default=0, server_default='0')
    head_approval_id: Mapped[str | None] = mapped_column(ForeignKey('approvals.id', name='projects_approval_fk', use_alter=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class SourceRecord(Base):
    __tablename__ = 'source_versions'
    __table_args__ = (UniqueConstraint('project_id', 'version', name='source_project_version_uq'),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    project_id: Mapped[str] = mapped_column(ForeignKey('projects.id'), index=True)
    version: Mapped[int] = mapped_column(Integer)
    content_hash: Mapped[str] = mapped_column(String(64))
    payload: Mapped[dict] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class TaskRecord(Base):
    __tablename__ = 'task_specs'
    __table_args__ = (UniqueConstraint('project_id', 'version', name='task_project_version_uq'),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    project_id: Mapped[str] = mapped_column(ForeignKey('projects.id'), index=True)
    source_id: Mapped[str] = mapped_column(ForeignKey('source_versions.id'), index=True)
    version: Mapped[int] = mapped_column(Integer)
    payload: Mapped[dict] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ImportDraft(Base):
    __tablename__ = 'import_drafts'
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    project_id: Mapped[str] = mapped_column(ForeignKey('projects.id'), index=True)
    expected_source_id: Mapped[str | None] = mapped_column(ForeignKey('source_versions.id'))
    preview: Mapped[dict] = mapped_column(JSONB)
    confirmed_source_id: Mapped[str | None] = mapped_column(ForeignKey('source_versions.id'))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class RunRecord(Base):
    __tablename__ = 'runs'
    __table_args__ = (UniqueConstraint('project_id', 'request_key', name='run_request_uq'),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    project_id: Mapped[str] = mapped_column(ForeignKey('projects.id'), index=True)
    source_id: Mapped[str] = mapped_column(ForeignKey('source_versions.id'))
    task_id: Mapped[str] = mapped_column(ForeignKey('task_specs.id'))
    source_hash: Mapped[str] = mapped_column(String(64))
    engine_version: Mapped[str] = mapped_column(String(100))
    request_key: Mapped[str] = mapped_column(String(36))
    request_context: Mapped[str] = mapped_column(String(64), default='direct')
    max_time_seconds: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(24), index=True)
    cancel_requested: Mapped[bool] = mapped_column(Boolean, default=False)
    worker_token: Mapped[str | None] = mapped_column(String(36))
    events: Mapped[list] = mapped_column(JSONB)
    result: Mapped[dict | None] = mapped_column(JSONB(none_as_null=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    heartbeat_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class IntentRecord(Base):
    __tablename__ = 'intent_drafts'
    __table_args__ = (UniqueConstraint('project_id', 'request_key', name='intent_request_uq'),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    project_id: Mapped[str] = mapped_column(ForeignKey('projects.id'), index=True)
    source_id: Mapped[str] = mapped_column(ForeignKey('source_versions.id'))
    task_id: Mapped[str] = mapped_column(ForeignKey('task_specs.id'))
    source_hash: Mapped[str] = mapped_column(String(64))
    request: Mapped[str] = mapped_column(String(8000))
    request_hash: Mapped[str] = mapped_column(String(64))
    request_key: Mapped[str] = mapped_column(String(36))
    model: Mapped[str] = mapped_column(String(100))
    provider_mode: Mapped[str] = mapped_column(String(12))
    prompt_version: Mapped[str] = mapped_column(String(80))
    payload: Mapped[dict] = mapped_column(JSONB)
    price: Mapped[dict] = mapped_column(JSONB)
    max_cost_micro_usd: Mapped[int] = mapped_column(Integer)
    estimated_max_cost_micro_usd: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(24), index=True)
    cancel_requested: Mapped[bool] = mapped_column(Boolean, default=False)
    worker_token: Mapped[str | None] = mapped_column(String(36))
    response_model: Mapped[str | None] = mapped_column(String(100))
    response_id: Mapped[str | None] = mapped_column(String(200))
    proposal: Mapped[dict | None] = mapped_column(JSONB(none_as_null=True))
    usage: Mapped[dict | None] = mapped_column(JSONB(none_as_null=True))
    events: Mapped[list] = mapped_column(JSONB)
    confirmed_task_id: Mapped[str | None] = mapped_column(ForeignKey('task_specs.id'))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    heartbeat_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class RevisionRecord(Base):
    __tablename__ = 'scenario_revisions'
    __table_args__ = (UniqueConstraint('project_id', 'version', name='revision_version_uq'),
        UniqueConstraint('project_id', 'request_key', name='revision_request_uq'))
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    project_id: Mapped[str] = mapped_column(ForeignKey('projects.id'), index=True)
    source_id: Mapped[str] = mapped_column(ForeignKey('source_versions.id'))
    task_id: Mapped[str] = mapped_column(ForeignKey('task_specs.id'))
    run_id: Mapped[str] = mapped_column(ForeignKey('runs.id'), index=True)
    base_scenario_id: Mapped[str] = mapped_column(String(100))
    parent_revision_id: Mapped[str | None] = mapped_column(ForeignKey('scenario_revisions.id'))
    version: Mapped[int] = mapped_column(Integer)
    source_hash: Mapped[str] = mapped_column(String(64))
    request_key: Mapped[str] = mapped_column(String(36))
    request_hash: Mapped[str] = mapped_column(String(64))
    scenario: Mapped[dict] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class RevisionValidationRecord(Base):
    __tablename__ = 'revision_validations'
    revision_id: Mapped[str] = mapped_column(ForeignKey('scenario_revisions.id'), primary_key=True)
    validator_version: Mapped[str] = mapped_column(String(80), primary_key=True)
    payload: Mapped[dict] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class ApprovalRecord(Base):
    __tablename__ = 'approvals'
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    project_id: Mapped[str] = mapped_column(ForeignKey('projects.id'), index=True)
    source_id: Mapped[str] = mapped_column(ForeignKey('source_versions.id'))
    task_id: Mapped[str] = mapped_column(ForeignKey('task_specs.id'))
    run_id: Mapped[str] = mapped_column(ForeignKey('runs.id'))
    scenario_id: Mapped[str] = mapped_column(String(100))
    revision_id: Mapped[str | None] = mapped_column(ForeignKey('scenario_revisions.id'))
    candidate_hash: Mapped[str] = mapped_column(String(64))
    snapshot: Mapped[dict] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class ApprovalRequestRecord(Base):
    __tablename__ = 'approval_requests'
    __table_args__ = (UniqueConstraint('project_id', 'request_key', name='approval_request_uq'),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    project_id: Mapped[str] = mapped_column(ForeignKey('projects.id'))
    request_key: Mapped[str] = mapped_column(String(36))
    request_hash: Mapped[str] = mapped_column(String(64))
    approval_id: Mapped[str] = mapped_column(ForeignKey('approvals.id'))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class ExportRecord(Base):
    __tablename__ = 'approved_exports'
    __table_args__ = (UniqueConstraint('approval_id', 'format', 'exporter_version', name='approved_export_uq'),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    project_id: Mapped[str] = mapped_column(ForeignKey('projects.id'), index=True)
    approval_id: Mapped[str] = mapped_column(ForeignKey('approvals.id'))
    format: Mapped[str] = mapped_column(String(8))
    exporter_version: Mapped[str] = mapped_column(String(80))
    sha256: Mapped[str] = mapped_column(String(64))
    size: Mapped[int] = mapped_column(Integer)
    filename: Mapped[str] = mapped_column(String(160))
    media_type: Mapped[str] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
