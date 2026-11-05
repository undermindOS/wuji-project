from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError

from app.main import create_app
from app.models import RunRecord
from app.runs import now
from app.worker import recover_stale, work_once
from test_data_api import imported


def start(client, pid, snapshot, key=None):
    return client.post('/api/v1/projects/' + pid + '/runs', json={
        'sourceVersionId': snapshot['source']['id'], 'taskSpecId': snapshot['task']['id'],
        'requestKey': key or str(uuid4()), 'maxTimeSeconds': 5})


def load(client, pid, rid):
    return client.get('/api/v1/projects/' + pid + '/runs/' + rid)


def test_queue_persists_separate_worker_computes_and_api_restart_preserves_results(client, settings, files):
    pid, _, snapshot = imported(client, files)
    created = start(client, pid, snapshot).json()
    assert created['status'] == 'queued' and created['result'] is None
    with TestClient(create_app(settings)) as restarted:
        assert load(restarted, pid, created['id']).json()['status'] == 'queued'
    assert work_once(settings, client.app.state.sessions)
    result = load(client, pid, created['id']).json()
    assert result['status'] == 'completed'
    assert result['result']['outcome'] == 'solutions'
    assert result['sourceHash'] == snapshot['source']['contentHash']
    assert result['engineVersion'].startswith('schedule-cpsat/3;ortools/')
    assert all(s['validation']['status'] == 'pass' for s in result['result']['scenarios'])
    assert not work_once(settings, client.app.state.sessions)
    with TestClient(create_app(settings)) as restarted:
        assert load(restarted, pid, created['id']).json() == result


def test_retries_idempotency_one_active_job_and_cross_project_access(client, files):
    pid, _, snapshot = imported(client, files)
    key = str(uuid4())
    a = start(client, pid, snapshot, key).json()
    assert start(client, pid, snapshot, key).json()['id'] == a['id']
    assert start(client, pid, snapshot).status_code == 409
    other = client.post('/api/v1/projects', json={'name': 'Other'}).json()['id']
    assert load(client, other, a['id']).status_code == 404
    assert client.post('/api/v1/projects/' + other + '/runs/' + a['id'] + '/cancel').status_code == 404


def test_queued_cancellation_is_idempotent_and_worker_cannot_publish(client, settings, files):
    pid, _, snapshot = imported(client, files)
    rid = start(client, pid, snapshot).json()['id']
    url = '/api/v1/projects/' + pid + '/runs/' + rid + '/cancel'
    cancelled = client.post(url).json()
    assert cancelled['status'] == 'cancelled'
    assert client.post(url).json() == cancelled
    assert not work_once(settings, client.app.state.sessions)
    assert load(client, pid, rid).json()['result'] is None


def test_completed_results_and_inputs_are_immutable_in_postgres(client, settings, files):
    pid, _, snapshot = imported(client, files)
    start(client, pid, snapshot)
    with client.app.state.sessions() as db:
        with pytest.raises(IntegrityError, match='inputs are immutable'):
            db.execute(text('UPDATE runs SET max_time_seconds = 20'))
        db.rollback()
    work_once(settings, client.app.state.sessions)
    with client.app.state.sessions() as db:
        for sql in ['UPDATE runs SET result = NULL', 'DELETE FROM runs']:
            with pytest.raises(IntegrityError, match='immutable|cannot be deleted'):
                db.execute(text(sql))
            db.rollback()


@pytest.mark.parametrize('recovery', ['api', 'worker'])
def test_stale_lease_is_failed_and_late_worker_cannot_replace_it(client, settings, files, recovery):
    pid, _, snapshot = imported(client, files)
    rid = start(client, pid, snapshot).json()['id']
    with client.app.state.sessions() as db:
        run = db.get(RunRecord, rid)
        run.status = 'running'
        run.started_at = run.heartbeat_at = now() - timedelta(seconds=40)
        run.worker_token = str(uuid4())
        db.commit()
    if recovery == 'worker':
        assert recover_stale(client.app.state.sessions) == 1
    value = load(client, pid, rid).json()
    assert value['status'] == 'failed' and value['events'][-1]['code'] == 'worker_lost'
    assert start(client, pid, snapshot).status_code == 201


def test_changed_conditions_mark_old_result_historical_and_block_stale_start(client, settings, files):
    pid, _, snapshot = imported(client, files)
    rid = start(client, pid, snapshot).json()['id']
    saved = client.post('/api/v1/projects/' + pid + '/tasks', json={'expectedSourceVersionId': snapshot['source']['id'],
        'expectedTaskId': snapshot['task']['id'], 'request': 'Anna absent',
        'absence': {'employeeId': 'anna', 'shiftIds': ['s05']}})
    assert saved.status_code == 201
    current = client.get('/api/v1/projects/' + pid + '/workspace').json()
    new_id = start(client, pid, current).json()['id']
    work_once(settings, client.app.state.sessions)
    assert not load(client, pid, rid).json()['isCurrent']
    assert start(client, pid, snapshot).status_code == 409
    assert client.get('/api/v1/projects/' + pid + '/workspace').json()['task']['id'] == saved.json()['id']
    work_once(settings, client.app.state.sessions)
    assert load(client, pid, new_id).json()['isCurrent']
    assert load(client, pid, new_id).json()['status'] == 'completed'


def test_named_conflict_survives_storage_and_reaches_the_client(client, settings, files):
    pid, _, snapshot = imported(client, files)
    saved = client.post('/api/v1/projects/' + pid + '/tasks', json={'expectedSourceVersionId': snapshot['source']['id'],
        'expectedTaskId': snapshot['task']['id'], 'request': 'Закрепить смену за Анной и отметить её отсутствие',
        'absence': {'employeeId': 'anna', 'shiftIds': ['s05']}, 'fixedAssignments': {'s05': 'anna'}})
    assert saved.status_code == 201, saved.text
    rid = start(client, pid, client.get('/api/v1/projects/' + pid + '/workspace').json()).json()['id']
    work_once(settings, client.app.state.sessions)
    run = load(client, pid, rid).json()
    assert run['status'] == 'completed' and run['result']['outcome'] == 'infeasible'
    assert any(e['code'] == 'diagnosis' for e in run['events']) and len(run['result']['attempts']) == 1
    issue, = run['result']['issues']
    assert issue['code'] == 'fixed_absence' and issue['shiftIds'] == ['s05'] and issue['employeeIds'] == ['anna']
    assert 'Анна Волкова' in issue['message'] and issue['sourceRefs'] == []
    assert issue['conditions'] == [
        {'kind': 'fixed_assignment', 'shiftId': 's05', 'employeeId': 'anna', 'role': None, 'removalCheck': 'solution'},
        {'kind': 'absence', 'shiftId': 's05', 'employeeId': 'anna', 'role': None, 'removalCheck': 'solution'}]


def test_partial_acceptance_creates_new_conditions_and_new_queued_calculation_atomically(client, settings, files):
    pid, _, snapshot = imported(client, files)
    rid = start(client, pid, snapshot).json()['id']
    work_once(settings, client.app.state.sessions)
    calculated = load(client, pid, rid).json()['result']['scenarios'][-1]
    sid = calculated['metrics']['changes'][0]['shiftId']
    body = {'sourceVersionId': snapshot['source']['id'], 'taskSpecId': snapshot['task']['id'],
        'requestKey': str(uuid4()), 'maxTimeSeconds': 5, 'scenarioId': calculated['scenario']['id'], 'shiftIds': [sid]}
    url = '/api/v1/projects/' + pid + '/runs/' + rid + '/fix'
    response = client.post(url, json=body)
    assert response.status_code == 201, response.text
    fixed = response.json()
    assert fixed['task']['version'] == 2 and fixed['run']['status'] == 'queued'
    assert client.post(url, json=body).json()['run']['id'] == fixed['run']['id']
    assert fixed['task']['fixedAssignments'] == {sid: calculated['scenario']['assignments'][sid]}
    work_once(settings, client.app.state.sessions)
    result = load(client, pid, fixed['run']['id']).json()
    assert result['status'] == 'completed'
    assert all(s['scenario']['assignments'][sid] == calculated['scenario']['assignments'][sid] for s in result['result']['scenarios'])
    assert all(s['metrics']['minutesByEmployee']['denis'] == 480 for s in result['result']['scenarios'])


def test_cancel_racing_with_a_finished_solve_discards_unpublished_results(client, settings, files, monkeypatch):
    import app.worker as worker
    pid, _, snapshot = imported(client, files)
    rid = start(client, pid, snapshot).json()['id']
    real_solve = worker.solve
    def cancel_before_publication(*args, **kwargs):
        result = real_solve(*args, **kwargs)
        assert result.scenarios
        assert client.post('/api/v1/projects/' + pid + '/runs/' + rid + '/cancel').status_code == 200
        return result
    monkeypatch.setattr(worker, 'solve', cancel_before_publication)
    work_once(settings, client.app.state.sessions)
    result = load(client, pid, rid).json()
    assert result['status'] == 'cancelled' and result['result'] is None


def test_concurrent_starts_allow_only_one_active_run(client, files):
    pid, _, snapshot = imported(client, files)
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(lambda _: start(client, pid, snapshot), range(2)))
    assert sorted(r.status_code for r in responses) == [201, 409]
