import asyncio
import threading
from uuid import uuid4

from sqlalchemy import select

from . import ai_provider
from .intent_grounding import ground, policy_issues
from .intents import FAILURES, recover_stale_intents
from .models import IntentRecord, TaskRecord
from .runs import event, now
from .schemas import AnalysisPrice, QuotedIntent, TaskSpec
from .service import source_or_404
from .storage import FileStore, IntegrityError


def work_intent_once(settings, sessions, ai_settings=None, shutdown=None, analyze=None):
    shutdown = shutdown or threading.Event()
    if shutdown.is_set():
        return False
    ai_settings = ai_settings or ai_provider.AiSettings.from_env()
    injected_adapter = analyze is not None
    analyze = analyze or ai_provider.analyze
    with sessions() as db:
        recover_stale_intents(db)
    with sessions() as db:
        record = db.scalar(select(IntentRecord).where(IntentRecord.status == 'queued')
            .order_by(IntentRecord.created_at).with_for_update(skip_locked=True).limit(1))
        if not record:
            return False
        draft_id, token = record.id, str(uuid4())
        record.status, record.worker_token, record.heartbeat_at = 'running', token, now()
        record.events = [*record.events, event('started', 'Text interpretation started; saved constraints are unchanged for now.')]
        db.commit()
    done, cancelled = threading.Event(), threading.Event()

    def pulse():
        while not done.wait(.2):
            try:
                with sessions() as db:
                    current = db.scalar(select(IntentRecord).where(IntentRecord.id == draft_id).with_for_update())
                    if current.status != 'running' or current.worker_token != token:
                        cancelled.set()
                        return
                    if current.cancel_requested or shutdown.is_set():
                        cancelled.set()
                    current.heartbeat_at = now()
                    db.commit()
            except Exception:
                cancelled.set()

    monitor = threading.Thread(target=pulse, daemon=True)
    monitor.start()
    outcome, proposal = ai_provider.ProviderResult(), None
    try:
        with sessions() as db:
            record = db.get(IntentRecord, draft_id)
            source = source_or_404(db, record.project_id, record.source_id)
            task = TaskSpec.model_validate(db.get(TaskRecord, record.task_id).payload)
            request, payload, price = record.request, record.payload, AnalysisPrice.model_validate(record.price)
            test_record = record.provider_mode == 'test'
        for file in source.original_files:
            FileStore(settings.data_dir).read(file.sha256)
        if policy_issues(request):
            proposal = ground(source, task, request, QuotedIntent(operations=[], questions=[], unsupported=[]))
        else:
            with sessions() as db:
                current = db.scalar(select(IntentRecord).where(IntentRecord.id == draft_id).with_for_update())
                if current.cancel_requested or current.status != 'running' or current.worker_token != token:
                    cancelled.set()
                else:
                    message = ('Test adapter called. No live provider request was made.' if test_record else
                        'Sending the request text and week’s calendar to OpenAI. Files, roster, rates and availability are not sent separately.')
                    if not test_record or injected_adapter:
                        current.events = [*current.events, event('provider_request', message)]
                    db.commit()
            outcome = ai_provider.ProviderResult(failure='worker_error') if test_record and not injected_adapter else asyncio.run(
                analyze(payload, price, ai_settings, lambda: cancelled.is_set() or shutdown.is_set()))
            if outcome.parsed:
                proposal = ground(source, task, request, outcome.parsed)
    except IntegrityError:
        outcome.failure = 'original_integrity'
    except Exception:
        # Provider exception text can contain credentials or private request data.
        outcome.failure = 'worker_error'
    finally:
        done.set()
        monitor.join(timeout=6)
    with sessions() as db:
        current = db.scalar(select(IntentRecord).where(IntentRecord.id == draft_id).with_for_update())
        if current.status != 'running' or current.worker_token != token:
            return True
        current.response_id, current.response_model = outcome.response_id, outcome.model
        current.usage = outcome.usage.model_dump(mode='json', by_alias=True) if outcome.usage else None
        if current.cancel_requested or shutdown.is_set() or outcome.failure == 'cancelled':
            current.status = 'cancelled'
            current.events = [*current.events, event('cancelled', FAILURES['cancelled'])]
        elif outcome.failure or proposal is None:
            current.status = 'failed'
            code = outcome.failure or 'worker_error'
            current.events = [*current.events, event(code, FAILURES.get(code, FAILURES['worker_error']))]
        else:
            current.proposal = proposal.model_dump(mode='json', by_alias=True)
            current.status = 'needs_clarification' if proposal.issues else 'ready'
            current.events = [*current.events, event('grounded', 'Quotes, employees and intervals matched to the source. Questions: ' + str(len(proposal.issues)) + '.')]
        current.finished_at = current.heartbeat_at = now()
        db.commit()
    return True
