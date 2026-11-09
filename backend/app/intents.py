import hashlib
from datetime import timedelta, timezone
from uuid import uuid4

from sqlalchemy import select

from .ai_provider import PROMPT_VERSION, prepare
from .models import IntentRecord, TaskRecord
from .runs import event, now
from .schemas import ConfirmIntent, IntentDraft, IntentOrigin, IntentProposal, SaveTask, TaskSpec
from .service import ServiceError, project_or_404, save_task, source_or_404

FAILURES = {
    'provider_timeout': 'Провайдер не ответил за отведённое время.',
    'provider_unavailable': 'Не удалось подключиться к провайдеру.',
    'provider_auth': 'Провайдер отклонил серверный ключ или доступ к модели.',
    'provider_rate_limit': 'Провайдер ограничил запросы или баланс.',
    'provider_error': 'Провайдер вернул ошибку.',
    'provider_incomplete': 'Ответ не завершён. Частичные условия не используются.',
    'provider_refusal': 'Модель не выдала черновик условий.',
    'provider_schema': 'Ответ не соответствует разрешённой схеме.',
    'provider_model_mismatch': 'Модель ответа не совпала с настроенной моделью.',
    'original_integrity': 'Оригинальный файл отсутствует или изменён.',
    'worker_error': 'Разбор прерван. Сохранённые условия не менялись.',
    'worker_lost': 'Процесс разбора не подтвердил работу за 60 секунд. Можно повторить запрос.',
    'cancelled': 'Разбор отменён. Условия не изменены.',
}


def recover_stale_intents(db, project_id=None):
    query = select(IntentRecord).where(IntentRecord.status == 'running', IntentRecord.heartbeat_at < now() - timedelta(seconds=60))
    if project_id:
        query = query.where(IntentRecord.project_id == project_id)
    records = db.scalars(query.with_for_update(skip_locked=True)).all()
    for record in records:
        record.status, record.finished_at = ('cancelled' if record.cancel_requested else 'failed'), now()
        record.events = [*record.events, event('worker_lost', FAILURES['worker_lost'])]
    if records:
        db.commit()


def intent_or_404(db, project_id, draft_id, lock=False):
    query = select(IntentRecord).where(IntentRecord.project_id == project_id, IntentRecord.id == draft_id)
    record = db.scalar(query.with_for_update() if lock else query)
    if not record:
        raise ServiceError(404, 'intent_not_found', 'Черновик не найден в этом проекте.')
    return record


def detail(record, project):
    current = project.head_source_id == record.source_id and project.head_task_id in {record.task_id, record.confirmed_task_id}
    return IntentDraft(id=record.id, project_id=record.project_id, source_version_id=record.source_id,
        task_spec_id=record.task_id, source_hash=record.source_hash, request=record.request, request_hash=record.request_hash,
        provider='openai', provider_mode=record.provider_mode, model=record.model, response_model=record.response_model, response_id=record.response_id,
        prompt_version=record.prompt_version, status=record.status, is_current=current,
        can_confirm=record.status == 'ready' and project.head_source_id == record.source_id and project.head_task_id == record.task_id,
        max_cost_micro_usd=record.max_cost_micro_usd, estimated_max_cost_micro_usd=record.estimated_max_cost_micro_usd,
        proposal=record.proposal, usage=record.usage, cancel_requested=record.cancel_requested, confirmed_task_id=record.confirmed_task_id,
        events=record.events, created_at=record.created_at.astimezone(timezone.utc),
        finished_at=record.finished_at.astimezone(timezone.utc) if record.finished_at else None)


def start_intent(db, store, settings, project_id, body):
    project = project_or_404(db, project_id, lock=True)
    previous = db.scalar(select(IntentRecord).where(IntentRecord.project_id == project_id, IntentRecord.request_key == body.request_key))
    if previous:
        if (previous.source_id, previous.task_id, previous.request, previous.max_cost_micro_usd) != (
            body.source_version_id, body.task_spec_id, body.request, body.max_cost_micro_usd):
            raise ServiceError(409, 'intent_key_conflict', 'Этот ключ относится к другому запросу.')
        if not body.consent:
            raise ServiceError(422, 'intent_consent', 'Нужно подтвердить передачу контекста провайдеру.')
        return detail(previous, project)
    if not body.consent:
        raise ServiceError(422, 'intent_consent', 'Подтвердите передачу текста и минимального контекста провайдеру.')
    if project.head_source_id != body.source_version_id or project.head_task_id != body.task_spec_id:
        raise ServiceError(409, 'intent_stale', 'Исходник или условия изменились. Откройте текущую версию.')
    if not body.request.strip():
        raise ServiceError(422, 'intent_empty', 'Введите запрос.')
    if db.scalar(select(IntentRecord.id).where(IntentRecord.project_id == project_id, IntentRecord.source_id == body.source_version_id,
        IntentRecord.task_id == body.task_spec_id, IntentRecord.status.in_(['queued','running']))):
        raise ServiceError(409, 'intent_active', 'Для этих входов уже выполняется разбор. Дождитесь результата или отмените его.')
    source = source_or_404(db, project_id, body.source_version_id)
    task_record = db.get(TaskRecord, body.task_spec_id)
    if not task_record or task_record.project_id != project_id or task_record.source_id != source.id:
        raise ServiceError(404, 'task_not_found', 'Условия не принадлежат исходнику.')
    task = TaskSpec.model_validate(task_record.payload)
    for file in source.original_files:
        store.read(file.sha256)
    payload, price, upper = prepare(source, task, body.request, settings, body.max_cost_micro_usd)
    record = IntentRecord(id=str(uuid4()), project_id=project_id, source_id=source.id, task_id=task.id,
        source_hash=source.content_hash, request=body.request, request_hash=hashlib.sha256(body.request.encode()).hexdigest(),
        request_key=body.request_key, model=settings.model, provider_mode='test' if settings.test_mode else 'live', prompt_version=PROMPT_VERSION, payload=payload,
        price=price.model_dump(mode='json', by_alias=True), max_cost_micro_usd=body.max_cost_micro_usd,
        estimated_max_cost_micro_usd=upper, status='queued', cancel_requested=False,
        events=[event('queued', 'Разбор сохранён в очереди. Передача минимального контекста подтверждена пользователем.')], created_at=now())
    db.add(record)
    db.commit()
    return detail(record, project)


def get_intent(db, project_id, draft_id):
    project = project_or_404(db, project_id)
    recover_stale_intents(db, project_id)
    return detail(intent_or_404(db, project_id, draft_id), project)


def list_intents(db, project_id, source_id, task_id):
    project = project_or_404(db, project_id)
    recover_stale_intents(db, project_id)
    query = select(IntentRecord).where(IntentRecord.project_id == project_id, IntentRecord.source_id == source_id,
        IntentRecord.task_id == task_id).order_by(IntentRecord.created_at.desc()).limit(20)
    return [detail(record, project) for record in db.scalars(query)]


def cancel_intent(db, project_id, draft_id):
    record = intent_or_404(db, project_id, draft_id, lock=True)
    if record.status in {'queued','running'} and not record.cancel_requested:
        record.cancel_requested = True
        record.events = [*record.events, event('cancel_requested', 'Запрошена отмена разбора.')]
        if record.status == 'queued':
            record.status, record.finished_at = 'cancelled', now()
        db.commit()
    return detail(record, project_or_404(db, project_id))


def confirm_intent(db, store, project_id, draft_id, body: ConfirmIntent):
    project = project_or_404(db, project_id, lock=True)
    record = intent_or_404(db, project_id, draft_id, lock=True)
    if (record.source_id, record.task_id, record.request_hash) != (
        body.expected_source_version_id, body.expected_task_id, body.request_hash):
        raise ServiceError(409, 'intent_confirmation', 'Подтверждение относится к другим входам.')
    if record.confirmed_task_id:
        return TaskSpec.model_validate(db.get(TaskRecord, record.confirmed_task_id).payload)
    if project.head_source_id != record.source_id or project.head_task_id != record.task_id:
        raise ServiceError(409, 'intent_stale', 'Исходник или условия изменились после разбора. Требуется новый черновик.')
    if record.status != 'ready' or record.proposal is None:
        raise ServiceError(422, 'intent_not_ready', 'Подтверждение доступно только для готового черновика без вопросов.')
    proposal = IntentProposal.model_validate(record.proposal)
    if proposal.issues or set(body.acknowledged_rule_ids) != {r.id for r in proposal.review} or len(set(body.acknowledged_rule_ids)) != len(body.acknowledged_rule_ids):
        raise ServiceError(422, 'intent_review', 'Проверьте и подтвердите все существенные условия.')
    source = source_or_404(db, project_id, record.source_id)
    for file in source.original_files:
        store.read(file.sha256)
    origin = IntentOrigin(draft_id=record.id, provider='openai', model=record.response_model or record.model,
        prompt_version=record.prompt_version, confirmed_at=now(), provider_mode=record.provider_mode)
    task = save_task(db, project_id, SaveTask(expected_source_version_id=source.id, expected_task_id=record.task_id,
        request=record.request, absence=proposal.absence, fixed_assignments=proposal.fixed_assignments,
        objective=proposal.objective), commit=False, interpretation=origin)
    record.status, record.confirmed_task_id = 'confirmed', task.id
    db.commit()
    return task
