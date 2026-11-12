"""A separate process consumes the PostgreSQL queue; no HTTP request runs CP-SAT."""
import logging
import signal
import threading
from uuid import uuid4

from sqlalchemy import select

from .config import Settings
from .database import session_factory
from .models import RunRecord, TaskRecord
from .runs import event, now, recover_stale_runs
from .schemas import TaskSpec
from .service import source_or_404
from .solver import CalculationCancelled, solve
from .storage import FileStore, IntegrityError
from .intent_worker import work_intent_once

def recover_stale(sessions):
    with sessions() as db:
        return recover_stale_runs(db)


def work_once(settings, sessions, shutdown=None):
    shutdown = shutdown or threading.Event()
    recover_stale(sessions)
    with sessions() as db:
        run = db.scalar(select(RunRecord).where(RunRecord.status == 'queued')
            .order_by(RunRecord.created_at).with_for_update(skip_locked=True).limit(1))
        if not run:
            return False
        token, run_id = str(uuid4()), run.id
        run.worker_token, run.status = token, 'running'
        run.started_at = run.heartbeat_at = now()
        run.events = [*run.events, event('started', 'CP-SAT started in a separate worker process.')]
        db.commit()
    cancelled, done = threading.Event(), threading.Event()
    solver_lock, active_solver = threading.Lock(), [None]

    def set_solver(solver):
        with solver_lock:
            active_solver[0] = solver

    def pulse():
        while not done.wait(.2):
            try:
                with sessions() as db:
                    current = db.scalar(select(RunRecord).where(RunRecord.id == run_id).with_for_update())
                    lost = current.status != 'running' or current.worker_token != token
                    if lost or current.cancel_requested or shutdown.is_set():
                        cancelled.set()
                    if not lost:
                        current.heartbeat_at = now()
                        db.commit()
                if cancelled.is_set():
                    with solver_lock:
                        if active_solver[0] is not None:
                            active_solver[0].stop_search()
            except Exception:
                # A lost DB connection cannot turn an unconfirmed calculation into a completed one.
                cancelled.set()
                with solver_lock:
                    if active_solver[0] is not None:
                        active_solver[0].stop_search()

    def observe(code, message):
        with sessions() as db:
            current = db.scalar(select(RunRecord).where(RunRecord.id == run_id).with_for_update())
            if current.status != 'running' or current.worker_token != token:
                cancelled.set()
                return
            current.events = [*current.events, event(code, message)]
            db.commit()

    monitor = threading.Thread(target=pulse, daemon=True)
    monitor.start()
    result, failure = None, None
    try:
        with sessions() as db:
            current = db.get(RunRecord, run_id)
            source = source_or_404(db, current.project_id, current.source_id)
            task = TaskSpec.model_validate(db.get(TaskRecord, current.task_id).payload)
            budget = current.max_time_seconds
        for file in source.original_files:
            FileStore(settings.data_dir).read(file.sha256)
        result = solve(source, task, budget, lambda: cancelled.is_set() or shutdown.is_set(), set_solver, observe)
    except CalculationCancelled:
        failure = 'cancelled'
    except IntegrityError:
        failure = 'original_integrity'
    except Exception:
        logging.exception('Calculation failed for run %s', run_id)
        failure = 'calculation_error'
    finally:
        done.set()
        monitor.join(timeout=6)
    with sessions() as db:
        current = db.scalar(select(RunRecord).where(RunRecord.id == run_id).with_for_update())
        if current.status != 'running' or current.worker_token != token:
            return True
        if current.cancel_requested:
            current.status = 'cancelled'
            current.events = [*current.events, event('cancelled', 'Calculation cancelled. No results returned.')]
        elif failure:
            current.status = 'failed'
            message = 'The original file is missing or has changed.' if failure == 'original_integrity' else 'Work interrupted. You can start a new calculation.'
            current.events = [*current.events, event(failure, message)]
        else:
            current.result = result.model_dump(mode='json', by_alias=True)
            current.status = 'needs_clarification' if result.outcome == 'needs_clarification' else 'failed' if result.outcome == 'invalid' else 'completed'
            current.events = [*current.events, event('finished', 'Search complete. Distinct feasible options: ' + str(len(result.scenarios)) + '.')]
        current.finished_at = current.heartbeat_at = now()
        db.commit()
    return True


def main():
    settings = Settings.from_env()
    engine, sessions = session_factory(settings.database_url)
    shutdown = threading.Event()
    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, lambda *_: shutdown.set())
    print('WUJI calculation worker ready.', flush=True)
    try:
        while not shutdown.is_set():
            solved = work_once(settings, sessions, shutdown)
            interpreted = work_intent_once(settings, sessions, shutdown=shutdown)
            if not solved and not interpreted:
                shutdown.wait(.5)
    finally:
        engine.dispose()


if __name__ == '__main__':
    main()
