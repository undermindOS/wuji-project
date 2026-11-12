"""Offline browser QA only: isolated disposable database and explicit controlled model.

Run from repository root:
  uv run --project backend python backend/tests/serve_intent_preview.py
No real API key is read or used by the controlled provider. Ctrl+C removes only its test database.
"""
import asyncio
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import uvicorn
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.engine import make_url

from app.ai_provider import AiSettings, ProviderResult
from app.config import ROOT, Settings
from app.database import migrate, session_factory
from app.intent_worker import work_intent_once
from app.local_db import ensure_local_database, stop_local_database
from app.main import create_app
from app.schemas import QuotedIntent, QuotedOperation
from app.worker import work_once

REQUEST = 'Emily will be absent on Wednesday, November 4. Compare options.'


async def controlled(payload, price, settings, cancelled):
    assert settings.test_mode
    request = json.loads(payload['input'])['request_text']
    if request == 'Provider error':
        return ProviderResult(failure='provider_auth')
    if request == 'Slow test request':
        while not cancelled():
            await asyncio.sleep(.05)
        return ProviderResult(failure='cancelled')
    await asyncio.sleep(.15)
    variants = {
        REQUEST: ('Emily', 'Wednesday, November 4', 'Emily will be absent on Wednesday, November 4.', True),
        'Peter will be absent on Wednesday, November 4.': ('Peter', 'Wednesday, November 4', 'Peter will be absent on Wednesday, November 4.', False),
        'Emily will be absent tomorrow.': ('Emily', 'tomorrow', 'Emily will be absent tomorrow.', False),
    }
    if request not in variants:
        return ProviderResult(parsed=QuotedIntent(operations=[],questions=['The test provider only recognizes examples listed in the test scenario.'],unsupported=[]),model='fixture/quotations-v1')
    employee, scope, quote, compare = variants[request]
    operations = [QuotedOperation(kind='set_absence', quote=quote, employee_quote=employee, scope_quote=scope, objective=None)]
    if compare:
        operations.append(QuotedOperation(kind='set_objective',quote='Compare options.',employee_quote=None,scope_quote=None,objective='compare'))
    return ProviderResult(parsed=QuotedIntent(operations=operations,questions=[],unsupported=[]),model='fixture/quotations-v1',response_id='offline-preview')


def main():
    if os.environ.get('DATABASE_URL'):
        raise RuntimeError('Offline preview requires the isolated local cluster; unset DATABASE_URL.')
    local = Settings.from_env()
    started = ensure_local_database(local)
    name = 'wuji_test_intent_preview_' + uuid4().hex
    admin = create_engine(make_url(local.database_url).set(database='postgres'),isolation_level='AUTOCOMMIT')
    with admin.connect() as connection:
        connection.exec_driver_sql('CREATE DATABASE "' + name + '"')
    temporary = tempfile.TemporaryDirectory(prefix='wuji-intent-preview-')
    settings = Settings(make_url(local.database_url).set(database=name).render_as_string(hide_password=False),Path(temporary.name))
    ai = AiSettings(api_key='offline-preview-only',test_mode=True)
    engine, sessions = session_factory(settings.database_url)
    stop = threading.Event()
    try:
        migrate(settings.database_url)
        app = create_app(settings,ai)
        base = ROOT / 'docs/examples/absence'
        files = {kind:(filename,(base/filename).read_bytes(),'text/csv') for kind,filename in [
            ('schedule','team_week_02-08_nov.csv'),('employees','employees.csv'),('availability','availability.csv')]}
        with TestClient(app) as client:
            project = client.post('/api/v1/projects',json={'name':'Test example · North'}).json()['id']
            preview = client.post('/api/v1/projects/'+project+'/imports',data={'team_name':'Test team','timezone':'America/New_York','currency':'USD'},files=files).json()
            assert preview['canConfirm']
            assert client.post('/api/v1/projects/'+project+'/imports/'+preview['id']+'/confirm',json={'expectedSourceVersionId':None}).status_code==200
        def work():
            while not stop.is_set():
                solved = work_once(settings,sessions,stop)
                interpreted = work_intent_once(settings,sessions,ai,stop,analyze=controlled)
                if not solved and not interpreted:
                    stop.wait(.2)
        thread = threading.Thread(target=work,daemon=True)
        thread.start()
        print(json.dumps({'mode':'TEST - NO LIVE API','database':name,'data_dir':temporary.name,'project':project,'url':'http://127.0.0.1:5173/workspace?project='+project,'request':REQUEST},ensure_ascii=False),flush=True)
        uvicorn.run(app,host='127.0.0.1',port=8000,log_level='warning')
    finally:
        stop.set()
        if 'thread' in locals():
            thread.join(timeout=8)
        engine.dispose()
        with admin.connect() as connection:
            connection.exec_driver_sql('DROP DATABASE "'+name+'" WITH (FORCE)')
        admin.dispose()
        temporary.cleanup()
        if started:
            stop_local_database(local)


if __name__ == '__main__':
    main()
