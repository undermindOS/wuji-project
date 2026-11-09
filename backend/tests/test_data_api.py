from concurrent.futures import ThreadPoolExecutor
import hashlib
import io
import json
import zipfile

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.main import create_app


def project(client, name='Студия «Север»'):
    response = client.post('/api/v1/projects', json={'name': name})
    assert response.status_code == 201, response.text
    return response.json()['id']


def preview(client, project_id, files, expected=None):
    data = {'team_name': 'Студия «Север»', 'timezone': 'Europe/Moscow', 'currency': 'RUB'}
    if expected:
        data['expected_source_version_id'] = expected
    response = client.post(f'/api/v1/projects/{project_id}/imports', data=data, files=files)
    assert response.status_code == 201, response.text
    return response.json()


def confirm(client, pid, draft, expected=None):
    return client.post(f'/api/v1/projects/{pid}/imports/{draft["id"]}/confirm', json={'expectedSourceVersionId': expected})


def imported(client, files):
    pid = project(client)
    draft = preview(client, pid, files)
    result = confirm(client, pid, draft)
    assert result.status_code == 200, result.text
    snapshot = client.get(f'/api/v1/projects/{pid}/workspace').json()
    return pid, draft, snapshot


def semantics(source):
    return {
        'timezone': source['timezone'], 'currency': source['currency'], 'teamName': source['teamName'],
        'employees': [{k: v for k, v in e.items() if k != 'sourceRefs'} for e in source['employees']],
        'shifts': [{k: v for k, v in s.items() if k not in {'sourceRefs', 'sourceRow'}} for s in source['shifts']],
    }


def test_preview_does_not_commit_and_confirm_preserves_original_and_provenance(client, files):
    pid = project(client)
    draft = preview(client, pid, files)
    assert draft['canConfirm']
    assert draft['rowCounts'] == {'schedule': 14, 'employees': 10, 'availability': 140}
    assert client.get('/api/v1/projects').json()[0]['headSourceId'] is None
    assert confirm(client, pid, draft).status_code == 200
    snapshot = client.get(f'/api/v1/projects/{pid}/workspace').json()
    source = snapshot['source']
    assert source['version'] == 1 and len(source['contentHash']) == 64
    assert source['shifts'][4]['sourceRefs']['employee_id']['row'] == 6
    rate_ref = source['employees'][9]['sourceRefs']['ratePerHourMinor']
    assert rate_ref['filename'] == 'employees.csv' and rate_ref['column'] == 'rate_per_hour_minor'
    original = source['originalFiles'][0]
    raw = client.get(f'/api/v1/projects/{pid}/sources/{source["id"]}/originals/{original["id"]}')
    assert raw.content == files['schedule'][1]
    assert hashlib.sha256(raw.content).hexdigest() == original['sha256']


def test_bad_import_cannot_advance_source_and_rows_are_not_dropped(client, files):
    pid = project(client)
    files['schedule'] = ('bad.csv', files['schedule'][1] + files['schedule'][1].splitlines()[5] + b'\n', 'text/csv')
    draft = preview(client, pid, files)
    assert not draft['canConfirm']
    assert any(issue['code'] == 'duplicate_shift' and issue['row'] == 16 for issue in draft['issues'])
    assert draft['rowCounts']['schedule'] == 15
    assert confirm(client, pid, draft).status_code == 422
    assert client.get('/api/v1/projects').json()[0]['sourceCount'] == 0


def test_versions_survive_app_restart_and_prior_sources_are_unchanged(client, settings, files):
    pid, _, before = imported(client, files)
    draft = preview(client, pid, files, before['source']['id'])
    assert confirm(client, pid, draft, before['source']['id']).status_code == 200
    with TestClient(create_app(settings)) as restarted:
        current = restarted.get(f'/api/v1/projects/{pid}/workspace').json()
        old = restarted.get(f'/api/v1/projects/{pid}/workspace', params={'source_id': before['source']['id']}).json()
    assert current['source']['version'] == 2 and len(current['versions']) == 2
    assert current['source']['contentHash'] == before['source']['contentHash']
    assert old['source'] == before['source']


def test_confirm_is_idempotent_and_stale_preview_does_not_overwrite_head(client, files):
    pid, first, snapshot = imported(client, files)
    sid = snapshot['source']['id']
    first_repeat = confirm(client, pid, first)
    assert first_repeat.json()['sourceId'] == sid
    a, b = preview(client, pid, files, sid), preview(client, pid, files, sid)
    assert confirm(client, pid, a, sid).status_code == 200
    assert confirm(client, pid, b, sid).status_code == 409
    assert confirm(client, pid, first).json()['sourceId'] == sid
    current = client.get(f'/api/v1/projects/{pid}/workspace').json()
    assert current['source']['version'] == 2 and current['source']['id'] != sid


def test_two_concurrent_confirmations_cannot_create_competing_heads(client, files):
    pid, _, snapshot = imported(client, files)
    sid = snapshot['source']['id']
    drafts = [preview(client, pid, files, sid), preview(client, pid, files, sid)]
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(lambda draft: confirm(client, pid, draft, sid), drafts))
    assert sorted(response.status_code for response in responses) == [200, 409]
    assert client.get(f'/api/v1/projects/{pid}/workspace').json()['source']['version'] == 2


def test_source_and_task_rows_are_immutable_in_postgresql(client, files):
    imported(client, files)
    with client.app.state.sessions() as db:
        for statement in ['UPDATE source_versions SET version = version + 1', 'DELETE FROM source_versions', 'UPDATE task_specs SET version = version + 1', 'DELETE FROM task_specs']:
            with pytest.raises(IntegrityError, match='immutable'):
                db.execute(text(statement))
            db.rollback()


def test_task_versions_are_saved_without_interpreting_text_and_stale_save_conflicts(client, files):
    pid, _, snapshot = imported(client, files)
    source, task = snapshot['source'], snapshot['task']
    payload = {'expectedSourceVersionId': source['id'], 'expectedTaskId': task['id'],
        'request': 'Анна отсутствует. Это текст задачи, а не команда серверу.', 'absence': {'employeeId': 'anna', 'shiftIds': ['s05']}}
    response = client.post(f'/api/v1/projects/{pid}/tasks', json=payload)
    assert response.status_code == 201, response.text
    assert response.json()['version'] == 2
    assert client.post(f'/api/v1/projects/{pid}/tasks', json=payload).status_code == 409
    current = client.get(f'/api/v1/projects/{pid}/workspace').json()
    assert current['task']['request'] == payload['request'] and len(current['tasks']) == 2
    assert current['source'] == source
    old = client.get(f'/api/v1/projects/{pid}/workspace', params={'task_id': task['id']}).json()
    assert old['task']['id'] == task['id']


@pytest.mark.parametrize('format', ['csv', 'xlsx'])
def test_export_reimport_preserves_values_types_ids_and_unknown_rates(client, files, format):
    files['employees'] = ('employees.csv', files['employees'][1].replace(b'32000,960', b',960'), 'text/csv')
    pid, _, snapshot = imported(client, files)
    url = f'/api/v1/projects/{pid}/sources/{snapshot["source"]["id"]}/export'
    exported = client.get(url, params={'format': format})
    assert exported.status_code == 200
    if format == 'csv':
        with zipfile.ZipFile(io.BytesIO(exported.content)) as archive:
            loaded_files = {kind: (f'{kind}.csv', archive.read(f'{kind}.csv'), 'text/csv') for kind in ['schedule', 'employees', 'availability']}
            assert json.loads(archive.read('metadata.json'))['source_id'] == snapshot['source']['id']
        assert client.get(url, params={'format': format}).content == exported.content
    else:
        loaded_files = {'workbook': ('reimport.xlsx', exported.content, exported.headers['content-type'])}
    another = project(client)
    draft = preview(client, another, loaded_files)
    assert draft['canConfirm'], draft['issues']
    assert confirm(client, another, draft).status_code == 200
    restored = client.get(f'/api/v1/projects/{another}/workspace').json()['source']
    assert semantics(restored) == semantics(snapshot['source'])


def test_original_hash_is_verified_before_confirmation(client, files):
    pid = project(client)
    draft = preview(client, pid, files)
    path = client.app.state.store.path(draft['files'][0]['sha256'])
    path.chmod(0o600)
    path.write_bytes(b'tampered')
    response = confirm(client, pid, draft)
    assert response.status_code == 409 and response.json()['code'] == 'original_integrity'
    assert client.get('/api/v1/projects').json()[0]['sourceCount'] == 0


def test_cross_project_source_and_original_references_are_rejected(client, files):
    pid, _, snapshot = imported(client, files)
    other = project(client, 'Другой проект')
    source = snapshot['source']
    assert client.get(f'/api/v1/projects/{other}/workspace', params={'source_id': source['id']}).status_code == 404
    assert client.get(f'/api/v1/projects/{other}/sources/{source["id"]}/export').status_code == 404
    assert client.get(f'/api/v1/projects/{pid}/sources/{source["id"]}/originals/{other}').status_code == 404


def test_local_api_boundary_and_body_limit(client):
    assert client.get('/api/v1/health').json() == {'status': 'ok', 'storage': 'postgresql'}
    assert client.post('/api/v1/projects', json={'name': 'test'}, headers={'Origin': 'https://example.org'}).status_code == 403
    assert client.post('/api/v1/projects', content=b'', headers={'Content-Length': str(17 * 1024 * 1024)}).status_code == 413


@pytest.mark.parametrize('format', ['csv', 'xlsx'])
def test_templates_are_downloadable_without_creating_a_project(client, format):
    result = client.get('/api/v1/templates', params={'format': format})
    assert result.status_code == 200
    with zipfile.ZipFile(io.BytesIO(result.content)) as archive:
        assert ('schedule.csv' if format == 'csv' else 'xl/workbook.xml') in archive.namelist()
    assert client.get('/api/v1/projects').json() == []
