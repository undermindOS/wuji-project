import hashlib
import json
from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import select

from .models import ImportDraft, Project, SourceRecord, TaskRecord
from .schemas import (
    ApiError, ImportConfirmation, ImportPreview, ProjectSummary, Rule, Scenario, SourceSummary,
    SourceVersion, TaskSpec, WorkspaceSnapshot,
)


class ServiceError(Exception):
    def __init__(self, status, code, message, issues=None):
        self.status = status
        self.error = ApiError(code=code, message=message, issues=issues or [])


def project_or_404(db, project_id, lock=False):
    query = select(Project).where(Project.id == project_id)
    if lock:
        query = query.with_for_update()
    project = db.scalar(query)
    if project is None:
        raise ServiceError(404, 'project_not_found', 'Проект не найден.')
    return project


def project_summary(project):
    return ProjectSummary(id=project.id, name=project.name, head_source_id=project.head_source_id,
        head_task_id=project.head_task_id, source_count=project.source_counter,
        created_at=project.created_at, updated_at=project.updated_at)


def source_or_404(db, project_id, source_id):
    record = db.scalar(select(SourceRecord).where(SourceRecord.project_id == project_id, SourceRecord.id == source_id))
    if not record:
        raise ServiceError(404, 'source_not_found', 'Версия исходника не найдена в этом проекте.')
    return SourceVersion.model_validate(record.payload)


def workspace_snapshot(db, project_id, source_id=None, task_id=None):
    project = project_or_404(db, project_id)
    source = source_or_404(db, project_id, source_id or project.head_source_id)
    tasks = db.scalars(select(TaskRecord).where(TaskRecord.project_id == project_id, TaskRecord.source_id == source.id).order_by(TaskRecord.version.desc())).all()
    task_records = [TaskSpec.model_validate(record.payload) for record in tasks]
    selected = next((task for task in task_records if task.id == task_id), None) if task_id else task_records[0] if task_records else None
    if selected is None:
        raise ServiceError(404, 'task_not_found', 'Версия условий не найдена для этого исходника.')
    records = db.scalars(select(SourceRecord).where(SourceRecord.project_id == project_id).order_by(SourceRecord.version.desc())).all()
    versions = []
    for record in records:
        data = SourceVersion.model_validate(record.payload)
        versions.append(SourceSummary(id=data.id, version=data.version, filename=data.filename,
            content_hash=record.content_hash, employee_count=len(data.employees), shift_count=len(data.shifts), created_at=record.created_at))
    baseline = Scenario(id=f'baseline-{source.id}-{selected.id}', source_version_id=source.id, task_spec_id=selected.id,
        label='Исходное расписание', description='Сохранённая версия исходника. Перестановки ещё не рассчитывались.',
        assignments={shift.id: shift.employee_id for shift in source.shifts})
    return WorkspaceSnapshot(project=project_summary(project), source=source, task=selected, tasks=task_records, versions=versions, baseline=baseline)


def default_rules():
    return [
        Rule(id='availability', label='Подтверждённая доступность', detail='Отсутствие и неизвестная доступность учитываются отдельно.'),
        Rule(id='pinned', label='Закреплённые назначения', detail='Закреплённые смены сохраняют назначенного сотрудника.'),
        Rule(id='hours', label='Личные лимиты часов', detail='Лимит каждого человека берётся из его строки в employees.'),
        Rule(id='coverage', label='Покрытие и квалификация', detail='Каждая смена требует подходящей роли, без пересечений.'),
    ]


def confirm_import(db, store, project_id, draft_id, expected_source_id):
    project = project_or_404(db, project_id, lock=True)
    draft = db.scalar(select(ImportDraft).where(ImportDraft.id == draft_id, ImportDraft.project_id == project_id).with_for_update())
    if draft is None:
        raise ServiceError(404, 'draft_not_found', 'Предпросмотр импорта не найден.')
    if draft.confirmed_source_id:
        source = source_or_404(db, project_id, draft.confirmed_source_id)
        return ImportConfirmation(project_id=project_id, source_id=source.id, version=source.version)
    if draft.expected_source_id != expected_source_id or project.head_source_id != expected_source_id:
        raise ServiceError(409, 'source_conflict', 'Исходник изменился после предпросмотра. Откройте текущую версию и проверьте импорт заново.')
    preview = ImportPreview.model_validate(draft.preview)
    if not preview.can_confirm or preview.preview is None:
        raise ServiceError(422, 'invalid_import', 'Исправьте ошибки импорта до подтверждения.', preview.issues)
    for file in preview.files:
        store.read(file.sha256)
    source_id, task_id = str(uuid4()), str(uuid4())
    created = datetime.now(timezone.utc)
    project.source_counter += 1
    project.task_counter += 1
    normalized = preview.preview.model_dump(mode='json', by_alias=True)

    def without_refs(value):
        if isinstance(value, dict):
            return {key: without_refs(item) for key, item in value.items() if key != 'sourceRefs'}
        return [without_refs(item) for item in value] if isinstance(value, list) else value

    digest = hashlib.sha256(json.dumps({'source': without_refs(normalized),
        'originals': sorted((file.kind, file.filename, file.sha256) for file in preview.files)},
        sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()
    source = SourceVersion(**preview.preview.model_dump(), id=source_id, version=project.source_counter,
        project_id=project_id, content_hash=digest, created_at=created, original_files=preview.files)
    task = TaskSpec(id=task_id, source_version_id=source_id, version=project.task_counter,
        request='Исходное расписание загружено. Опишите необходимое изменение.', absence=None, rules=default_rules(), created_at=created)
    db.add(SourceRecord(id=source_id, project_id=project_id, version=source.version, content_hash=digest, payload=source.model_dump(mode='json', by_alias=True), created_at=created))
    db.flush()
    db.add(TaskRecord(id=task_id, project_id=project_id, source_id=source_id, version=task.version, payload=task.model_dump(mode='json', by_alias=True), created_at=created))
    db.flush()
    project.head_source_id = source_id
    project.head_task_id = task_id
    project.updated_at = created
    draft.confirmed_source_id = source_id
    db.commit()
    return ImportConfirmation(project_id=project_id, source_id=source_id, version=source.version)


def save_task(db, project_id, payload, commit=True, interpretation=None):
    project = project_or_404(db, project_id, lock=True)
    if project.head_source_id != payload.expected_source_version_id or project.head_task_id != payload.expected_task_id:
        raise ServiceError(409, 'task_conflict', 'Исходник или условия уже обновлены. Загрузите актуальную версию перед сохранением.')
    source = source_or_404(db, project_id, project.head_source_id)
    employee_ids = {employee.id for employee in source.employees}
    shift_ids = {shift.id for shift in source.shifts}
    if payload.absence:
        employee_ids = {employee.id for employee in source.employees}
        shift_ids = {shift.id for shift in source.shifts}
        absence = payload.absence
        if absence.employee_id not in employee_ids or not absence.shift_ids or len(set(absence.shift_ids)) != len(absence.shift_ids) or any(sid not in shift_ids for sid in absence.shift_ids):
            raise ServiceError(422, 'absence_reference', 'Проверьте сотрудника и уникальные ID смен в условии об отсутствии.')
    project.task_counter += 1
    if any(sid not in shift_ids or eid not in employee_ids for sid, eid in payload.fixed_assignments.items()):
        raise ServiceError(422, 'fixed_reference', 'Закрепления должны ссылаться на смены и сотрудников исходника.')
    rules = default_rules()
    if payload.fixed_assignments:
        rules.append(Rule(id='fixed', label='Выбранные назначения закреплены', detail='Закрепления из условий сохраняются при каждом новом расчёте.'))
    task = TaskSpec(id=str(uuid4()), source_version_id=source.id, version=project.task_counter, request=payload.request,
        absence=payload.absence, fixed_assignments=payload.fixed_assignments, objective=payload.objective,
        parent_task_id=payload.expected_task_id, interpretation=interpretation, rules=rules, created_at=datetime.now(timezone.utc))
    db.add(TaskRecord(id=task.id, project_id=project_id, source_id=source.id, version=task.version, payload=task.model_dump(mode='json', by_alias=True), created_at=task.created_at))
    db.flush()
    project.head_task_id = task.id
    project.updated_at = task.created_at
    if commit:
        db.commit()
    return task
