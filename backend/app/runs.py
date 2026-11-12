from datetime import datetime, timedelta, timezone
from uuid import uuid4
import hashlib
import json

from sqlalchemy import select

from .engine_info import ENGINE_VERSION
from .models import RunRecord, TaskRecord
from .schemas import FixedRun, RunDetail, RunEvent, RunSummary, SaveTask, StartRun, SolveResult, TaskSpec
from .service import ServiceError, project_or_404, source_or_404, save_task

ACTIVE = {'queued', 'running'}
LEASE_SECONDS = 30


def now():
    return datetime.now(timezone.utc)


def event(code, message):
    return RunEvent(at=now(), code=code, message=message).model_dump(mode='json', by_alias=True)


def recover_stale_runs(db, project_id=None):
    query = select(RunRecord).where(RunRecord.status == 'running',
        RunRecord.heartbeat_at < now() - timedelta(seconds=LEASE_SECONDS))
    if project_id:
        query = query.where(RunRecord.project_id == project_id)
    stale = db.scalars(query.with_for_update(skip_locked=True)).all()
    for run in stale:
        run.status, run.finished_at = ('cancelled' if run.cancel_requested else 'failed'), now()
        run.events = [*run.events, event('worker_lost', 'The worker did not report activity within 30 seconds. The run was stopped; you can calculate again.')]
    if stale:
        db.commit()
    return len(stale)


def summary(run, project):
    times = {key: value.astimezone(timezone.utc) if value else None for key, value in {
        'created_at': run.created_at, 'started_at': run.started_at, 'finished_at': run.finished_at, 'heartbeat_at': run.heartbeat_at}.items()}
    return RunSummary(id=run.id, project_id=run.project_id, source_version_id=run.source_id,
        task_spec_id=run.task_id, source_hash=run.source_hash, engine_version=run.engine_version,
        status=run.status, is_current=project.head_source_id == run.source_id and project.head_task_id == run.task_id,
        max_time_seconds=run.max_time_seconds, cancel_requested=run.cancel_requested, **times)


def detail(run, project):
    return RunDetail(**summary(run, project).model_dump(), events=run.events, result=run.result)


def run_or_404(db, project_id, run_id, lock=False):
    query = select(RunRecord).where(RunRecord.id == run_id, RunRecord.project_id == project_id)
    run = db.scalar(query.with_for_update() if lock else query)
    if not run:
        raise ServiceError(404, 'run_not_found', 'Run not found in this project.')
    return run


def start_run(db, store, project_id, payload: StartRun, request_context='direct'):
    project = project_or_404(db, project_id, lock=True)
    previous = db.scalar(select(RunRecord).where(RunRecord.project_id == project_id, RunRecord.request_key == payload.request_key))
    if previous:
        if ((previous.source_id, previous.task_id, previous.max_time_seconds) != (payload.source_version_id, payload.task_spec_id, payload.max_time_seconds)
            or previous.request_context != request_context):
            raise ServiceError(409, 'request_key_conflict', 'The reused key belongs to different inputs.')
        return detail(previous, project)
    if project.head_source_id != payload.source_version_id or project.head_task_id != payload.task_spec_id:
        raise ServiceError(409, 'run_inputs_stale', 'The source or constraints have changed. Open the current version before calculating again.')
    if db.scalar(select(RunRecord.id).where(RunRecord.project_id == project_id, RunRecord.source_id == payload.source_version_id,
        RunRecord.task_id == payload.task_spec_id, RunRecord.status.in_(ACTIVE))):
        raise ServiceError(409, 'run_active', 'An active calculation already exists for these versions. Refresh the run list.')
    source = source_or_404(db, project_id, payload.source_version_id)
    task = db.get(TaskRecord, payload.task_spec_id)
    if not task or task.project_id != project_id or task.source_id != source.id:
        raise ServiceError(404, 'task_not_found', 'The constraints do not belong to this source version.')
    for file in source.original_files:
        store.read(file.sha256)
    run = RunRecord(id=str(uuid4()), project_id=project_id, source_id=source.id, task_id=task.id,
        source_hash=source.content_hash, engine_version=ENGINE_VERSION, request_key=payload.request_key, request_context=request_context,
        max_time_seconds=payload.max_time_seconds, status='queued', cancel_requested=False,
        events=[event('queued', 'Run queued. Source V' + str(source.version) + '; constraints V' + str(task.version) + '.')],
        created_at=now())
    db.add(run)
    db.commit()
    return detail(run, project)


def list_runs(db, project_id, source_id=None, task_id=None):
    project = project_or_404(db, project_id)
    recover_stale_runs(db, project_id)
    query = select(RunRecord).where(RunRecord.project_id == project_id)
    if source_id:
        query = query.where(RunRecord.source_id == source_id)
    if task_id:
        query = query.where(RunRecord.task_id == task_id)
    return [summary(run, project) for run in db.scalars(query.order_by(RunRecord.created_at.desc()).limit(100))]


def get_run(db, project_id, run_id):
    project_or_404(db, project_id)
    recover_stale_runs(db, project_id)
    return detail(run_or_404(db, project_id, run_id), project_or_404(db, project_id))


def cancel_run(db, project_id, run_id):
    run = run_or_404(db, project_id, run_id, lock=True)
    if run.status in ACTIVE and not run.cancel_requested:
        run.cancel_requested = True
        run.events = [*run.events, event('cancel_requested', 'The user requested calculation cancellation.')]
        if run.status == 'queued':
            run.status, run.finished_at = 'cancelled', now()
            run.events = [*run.events, event('cancelled', 'Job cancelled before the search started.')]
        db.commit()
    return detail(run, project_or_404(db, project_id))


def fix_and_run(db, store, project_id, run_id, payload):
    project = project_or_404(db, project_id, lock=True)
    context = hashlib.sha256(json.dumps({'run': run_id, **payload.model_dump(exclude={'request_key'}),
        'shift_ids': sorted(payload.shift_ids)}, sort_keys=True).encode()).hexdigest()
    previous = db.scalar(select(RunRecord).where(RunRecord.project_id == project_id, RunRecord.request_key == payload.request_key))
    if previous:
        if previous.request_context != context:
            raise ServiceError(409, 'request_key_conflict', 'The key belongs to a different pinned assignment.')
        return FixedRun(task=TaskSpec.model_validate(db.get(TaskRecord, previous.task_id).payload), run=detail(previous, project))
    original = run_or_404(db, project_id, run_id)
    if (original.source_id != payload.source_version_id or original.task_id != payload.task_spec_id
        or project.head_source_id != original.source_id or project.head_task_id != original.task_id):
        raise ServiceError(409, 'run_inputs_stale', 'To pin assignments, open a calculation for the current source and constraints.')
    result = SolveResult.model_validate(original.result) if original.result else None
    selected = next((s for s in result.scenarios if s.scenario.id == payload.scenario_id), None) if result else None
    if not selected or selected.validation.status != 'pass':
        raise ServiceError(422, 'scenario_unverified', 'Only assignments from a validated option can be pinned.')
    if len(set(payload.shift_ids)) != len(payload.shift_ids) or any(sid not in selected.scenario.assignments for sid in payload.shift_ids):
        raise ServiceError(422, 'fixed_reference', 'Select unique shifts from a validated option.')
    old = TaskSpec.model_validate(db.get(TaskRecord, original.task_id).payload)
    task = save_task(db, project_id, SaveTask(expected_source_version_id=original.source_id, expected_task_id=old.id,
        request=old.request, absence=old.absence, objective=old.objective, fixed_assignments={**old.fixed_assignments,
            **{sid: selected.scenario.assignments[sid] for sid in payload.shift_ids}}), commit=False)
    new_run = start_run(db, store, project_id, StartRun(source_version_id=original.source_id, task_spec_id=task.id,
        request_key=payload.request_key, max_time_seconds=payload.max_time_seconds), request_context=context)
    return FixedRun(task=task, run=new_run)
