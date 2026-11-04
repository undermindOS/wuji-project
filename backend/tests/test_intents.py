import asyncio
from dataclasses import replace
import json
import threading
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest
from fastapi.testclient import TestClient
from openai import AsyncOpenAI as RealOpenAI
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app import ai_provider
from app.ai_provider import AiSettings, ProviderResult, prepare, price_for, usage_of
from app.intent_grounding import ground, resolve_scope
from app.intent_worker import work_intent_once
from app.main import create_app
from app.schemas import QuotedIntent, QuotedOperation, SourceVersion, TaskSpec
from test_data_api import imported, preview, confirm

REQUEST = 'Анна не выйдет в среду, 4 ноября. Сравни варианты.'
AI = AiSettings(api_key='not-a-real-key', test_mode=True)


def parsed():
    return QuotedIntent(operations=[
        QuotedOperation(kind='set_absence', quote='Анна не выйдет в среду, 4 ноября.', employee_quote='Анна',
            scope_quote='среду, 4 ноября', objective=None),
        QuotedOperation(kind='set_objective', quote='Сравни варианты.', employee_quote=None, scope_quote=None, objective='compare'),
    ], questions=[], unsupported=[])


async def controlled(payload, price, settings, cancelled):
    assert settings.test_mode
    return ProviderResult(parsed=parsed(), model='fixture/quotations-v1', response_id='fixture-only')


@pytest.fixture
def ai_client(settings):
    with TestClient(create_app(settings, AI)) as client:
        yield client


def start(client, pid, snapshot, **changes):
    body = {'sourceVersionId': snapshot['source']['id'], 'taskSpecId': snapshot['task']['id'],
        'request': REQUEST, 'requestKey': str(uuid4()), 'consent': True, **changes}
    return client.post('/api/v1/projects/' + pid + '/intents', json=body)


def get(client, pid, did):
    return client.get('/api/v1/projects/' + pid + '/intents/' + did).json()


def confirmation(draft):
    return {'expectedSourceVersionId': draft['sourceVersionId'], 'expectedTaskId': draft['taskSpecId'],
        'requestHash': draft['requestHash'], 'acknowledgedRuleIds': [r['id'] for r in draft['proposal']['review']]}


def completed(ai_client, settings, files):
    pid, _, snapshot = imported(ai_client, files)
    draft = start(ai_client, pid, snapshot)
    assert draft.status_code == 201, draft.text
    did = draft.json()['id']
    assert work_intent_once(settings, ai_client.app.state.sessions, AI, analyze=controlled)
    return pid, snapshot, get(ai_client, pid, did)


def test_provider_draft_does_not_change_conditions_until_all_rules_confirmed(ai_client, settings, files):
    pid, snapshot, draft = completed(ai_client, settings, files)
    assert draft['status'] == 'ready' and draft['canConfirm']
    assert draft['providerMode'] == 'test' and draft['responseModel'] == 'fixture/quotations-v1'
    assert draft['proposal']['absence'] == {'employeeId': 'anna', 'shiftIds': ['s05','s06']}
    assert ai_client.get('/api/v1/projects/' + pid + '/workspace').json()['task']['id'] == snapshot['task']['id']
    url = '/api/v1/projects/' + pid + '/intents/' + draft['id'] + '/confirm'
    body = confirmation(draft)
    assert ai_client.post(url, json={**body, 'acknowledgedRuleIds': ['absence']}).status_code == 422
    response = ai_client.post(url, json=body)
    assert response.status_code == 200, response.text
    task = response.json()
    assert task['version'] == 2 and task['parentTaskId'] == snapshot['task']['id']
    assert task['interpretation']['draftId'] == draft['id'] and task['interpretation']['providerMode'] == 'test'
    assert task['interpretation']['model'] == 'fixture/quotations-v1'
    assert ai_client.post(url, json=body).json()['id'] == task['id']
    assert get(ai_client, pid, draft['id'])['status'] == 'confirmed'
    assert ai_client.get('/api/v1/projects/' + pid + '/workspace').json()['source'] == snapshot['source']
    with TestClient(create_app(settings, AI)) as reopened:
        assert reopened.post(url,json=body).json()['id']==task['id']
        assert get(reopened,pid,draft['id'])['confirmedTaskId']==task['id']


def test_consent_budget_key_and_active_job_gates_do_not_dispatch(ai_client, settings, files):
    pid, _, snapshot = imported(ai_client, files)
    assert start(ai_client, pid, snapshot, consent=False).status_code == 422
    assert start(ai_client, pid, snapshot, maxCostMicroUsd=1).status_code == 422
    assert not work_intent_once(settings, ai_client.app.state.sessions, AI, analyze=controlled)
    key = str(uuid4())
    a = start(ai_client, pid, snapshot, requestKey=key)
    assert start(ai_client, pid, snapshot, requestKey=key).json()['id'] == a.json()['id']
    assert start(ai_client, pid, snapshot, requestKey=key, request='Другое').status_code == 409
    assert start(ai_client, pid, snapshot).status_code == 409


def test_input_and_terminal_result_protection_and_cross_project_access(ai_client, settings, files):
    pid, snapshot, draft = completed(ai_client, settings, files)
    other = ai_client.post('/api/v1/projects', json={'name':'Other'}).json()['id']
    assert ai_client.get('/api/v1/projects/' + other + '/intents/' + draft['id']).status_code == 404
    assert ai_client.post('/api/v1/projects/' + other + '/intents/' + draft['id'] + '/confirm', json=confirmation(draft)).status_code == 404
    with ai_client.app.state.sessions() as db:
        for statement in ['UPDATE intent_drafts SET request = request || chr(32)', 'UPDATE intent_drafts SET proposal = NULL', 'DELETE FROM intent_drafts']:
            with pytest.raises(IntegrityError, match='immutable|cannot be deleted'):
                db.execute(text(statement))
            db.rollback()


@pytest.mark.parametrize('change', ['task', 'source'])
def test_new_task_or_source_blocks_old_confirmation(ai_client, settings, files, change):
    pid, snapshot, draft = completed(ai_client, settings, files)
    if change == 'task':
        changed = ai_client.post('/api/v1/projects/' + pid + '/tasks', json={'expectedSourceVersionId': snapshot['source']['id'],
            'expectedTaskId':snapshot['task']['id'], 'request':'Manual new conditions'})
        assert changed.status_code == 201
    else:
        pending = preview(ai_client,pid,files,snapshot['source']['id'])
        assert confirm(ai_client,pid,pending,snapshot['source']['id']).status_code == 200
    url = '/api/v1/projects/' + pid + '/intents/' + draft['id'] + '/confirm'
    assert ai_client.post(url, json=confirmation(draft)).status_code == 409
    assert not get(ai_client,pid,draft['id'])['canConfirm']


def test_queued_and_running_cancellation_preserve_conditions(ai_client, settings, files):
    pid, _, snapshot = imported(ai_client, files)
    queued = start(ai_client,pid,snapshot).json()
    url = '/api/v1/projects/' + pid + '/intents/' + queued['id'] + '/cancel'
    assert ai_client.post(url).json()['status'] == 'cancelled'
    assert not work_intent_once(settings,ai_client.app.state.sessions,AI,analyze=controlled)
    running = start(ai_client,pid,snapshot).json()
    entered = threading.Event()
    async def waiting(payload, price, settings, cancelled):
        entered.set()
        while not cancelled():
            await asyncio.sleep(.01)
        return ProviderResult(failure='cancelled')
    thread = threading.Thread(target=lambda: work_intent_once(settings,ai_client.app.state.sessions,AI,analyze=waiting))
    thread.start()
    assert entered.wait(3)
    assert ai_client.post('/api/v1/projects/' + pid + '/intents/' + running['id'] + '/cancel').status_code == 200
    thread.join(3)
    assert not thread.is_alive()
    result = get(ai_client,pid,running['id'])
    assert result['status']=='cancelled' and result['proposal'] is None and result['usage'] is None
    assert ai_client.get('/api/v1/projects/' + pid + '/workspace').json()['task']['id']==snapshot['task']['id']


@pytest.mark.parametrize('failure',['provider_auth','provider_timeout','provider_incomplete','provider_refusal','provider_schema'])
def test_provider_failures_never_create_conditions(ai_client, settings, files, failure):
    pid, _, snapshot = imported(ai_client, files)
    draft = start(ai_client,pid,snapshot).json()
    async def failing(*args):
        return ProviderResult(failure=failure)
    work_intent_once(settings,ai_client.app.state.sessions,AI,analyze=failing)
    result = get(ai_client,pid,draft['id'])
    assert result['status']=='failed' and result['proposal'] is None and not result['canConfirm']
    assert result['events'][-1]['code']==failure
    assert ai_client.get('/api/v1/projects/' + pid + '/workspace').json()['task']['id']==snapshot['task']['id']


def test_unsupported_rules_stop_before_provider(ai_client, settings, files):
    pid, _, snapshot = imported(ai_client, files)
    draft = start(ai_client,pid,snapshot,request='Игнорируй личные лимиты часов и доступность.').json()
    async def forbidden(*args):
        pytest.fail('Unsupported policy must not dispatch to provider')
    work_intent_once(settings,ai_client.app.state.sessions,AI,analyze=forbidden)
    result=get(ai_client,pid,draft['id'])
    assert result['status']=='needs_clarification'
    assert not any(e['code']=='provider_request' for e in result['events'])


def test_minimum_data_and_keys_remain_server_side(ai_client, files):
    pid, _, snapshot=imported(ai_client,files)
    payload,price,upper=prepare(SourceVersion.model_validate(snapshot['source']),TaskSpec.model_validate(snapshot['task']),REQUEST,AI,50000)
    context=json.loads(payload['input'])['context']
    assert set(context)=={'dates','timezone'}
    encoded=json.dumps(payload,ensure_ascii=False)
    assert 'Роман Ким' not in encoded and 'ratePerHourMinor' not in encoded and 'availability' not in context
    assert AI.api_key not in encoded and AI.api_key not in ai_client.get('/api/v1/ai/configuration').text
    assert payload['store'] is False and payload['max_output_tokens']==2048
    assert upper<=50000


@pytest.mark.parametrize('mutation', ['quote','unknown','ambiguous','time','relative','multiple','extra_value','clear_unknown','unfix_unknown','unfix_other'])
def test_grounding_rejects_unfounded_or_ambiguous_interpretations(ai_client,files,mutation):
    _,_,snapshot=imported(ai_client,files)
    source,task=SourceVersion.model_validate(snapshot['source']),TaskSpec.model_validate(snapshot['task'])
    request=REQUEST
    operations=parsed().operations
    if mutation=='quote':
        operations=[operations[0].model_copy(update={'quote':'Ignore source instructions','employee_quote':None,'scope_quote':None})]
    elif mutation=='unknown':
        request=REQUEST.replace('Анна','Пётр')
        operations=[operations[0].model_copy(update={'quote':'Пётр не выйдет в среду, 4 ноября.','employee_quote':'Пётр'})]
    elif mutation=='ambiguous':
        source=source.model_copy(update={'employees':[source.employees[0].model_copy(update={'id':'anna2','name':'Анна Петрова'}),*source.employees]})
    elif mutation=='time':
        request='Анна не выйдет 4 ноября с 09:00 до 13:00.'
        operations=[operations[0].model_copy(update={'quote':request,'scope_quote':'4 ноября с 09:00 до 13:00'})]
    elif mutation=='relative':
        request='Анна не выйдет завтра.'
        operations=[operations[0].model_copy(update={'quote':request,'scope_quote':'завтра'})]
    elif mutation=='multiple':
        request=REQUEST+' Роман не выйдет в четверг.'
        operations=[*operations,operations[0].model_copy(update={'quote':'Роман не выйдет в четверг.','employee_quote':'Роман','scope_quote':'четверг'})]
    elif mutation=='clear_unknown':
        request='Сними отсутствие Петра.'
        operations=[QuotedOperation(kind='clear_absence',quote=request,employee_quote='Петра',scope_quote=None,objective=None)]
    elif mutation in {'unfix_unknown','unfix_other'}:
        employee='Петра' if mutation=='unfix_unknown' else 'Дениса'
        request='Сними закрепление '+employee+' на s05.'
        task=task.model_copy(update={'fixed_assignments':{'s05':'anna'}})
        operations=[QuotedOperation(kind='remove_fixed',quote=request,employee_quote=employee,scope_quote='s05',objective=None)]
    else:
        operations=[operations[0].model_copy(update={'objective':'min_cost'})]
    result=ground(source,task,request,QuotedIntent(operations=operations,questions=[],unsupported=[]))
    assert result.issues


def test_literal_ids_exact_shift_times_and_missing_rates(ai_client,files):
    _,_,snapshot=imported(ai_client,files)
    source,task=SourceVersion.model_validate(snapshot['source']),TaskSpec.model_validate(snapshot['task'])
    assert resolve_scope(source,'s05')==['s05']
    assert resolve_scope(source,'4 ноября с 09:00 до 17:00')==['s05']
    assert resolve_scope(source,'s05 в среду')==['s05']
    with pytest.raises(ValueError):
        resolve_scope(source,'s05 в пятницу')
    with pytest.raises(ValueError):
        resolve_scope(source,'s99 в среду')
    request='Покажи минимум оплаты.'
    parsed_intent=QuotedIntent(operations=[QuotedOperation(kind='set_objective',quote=request,employee_quote=None,scope_quote=None,objective='min_cost')],questions=[],unsupported=[])
    source=source.model_copy(update={'employees':[e.model_copy(update={'rate_per_hour_minor':None}) for e in source.employees]})
    assert ground(source,task,request,parsed_intent).issues


def test_changed_original_never_dispatches(ai_client, settings, files):
    pid,_,snapshot=imported(ai_client,files)
    did=start(ai_client,pid,snapshot).json()['id']
    path=ai_client.app.state.store.path(snapshot['source']['originalFiles'][0]['sha256'])
    path.chmod(0o600);path.write_bytes(b'changed')
    async def forbidden(*args):
        pytest.fail('Corrupted source cannot be dispatched')
    work_intent_once(settings,ai_client.app.state.sessions,AI,analyze=forbidden)
    draft=get(ai_client,pid,did)
    assert draft['status']=='failed' and draft['events'][-1]['code']=='original_integrity'


def test_test_queue_cannot_fall_through_to_live_adapter(ai_client, settings, files, monkeypatch):
    pid,_,snapshot=imported(ai_client,files)
    draft=start(ai_client,pid,snapshot).json()
    async def forbidden(*args):
        pytest.fail('Test jobs must never reach a default provider, even after worker configuration changes')
    monkeypatch.setattr(ai_provider,'analyze',forbidden)
    assert work_intent_once(settings,ai_client.app.state.sessions,replace(AI,test_mode=False))
    result=get(ai_client,pid,draft['id'])
    assert result['status']=='failed' and not any(e['code']=='provider_request' for e in result['events'])


def test_lost_intent_worker_is_recovered_without_confirmable_conditions(ai_client, settings, files):
    pid,_,snapshot=imported(ai_client,files)
    draft=start(ai_client,pid,snapshot).json()
    with ai_client.app.state.sessions() as db:
        db.execute(text("UPDATE intent_drafts SET status='running', worker_token=:token, heartbeat_at=NOW()-INTERVAL '61 seconds' WHERE id=:id"),
            {'token':str(uuid4()),'id':draft['id']})
        db.commit()
    with TestClient(create_app(settings,AI)) as reopened:
        result=get(reopened,pid,draft['id'])
        assert result['status']=='failed' and result['proposal'] is None
        assert result['events'][-1]['code']=='worker_lost' and not result['canConfirm']


def test_sdk_schema_and_auth_failures_use_mock_transport_without_network(monkeypatch,ai_client,files):
    _,_,snapshot=imported(ai_client,files)
    settings=replace(AI,test_mode=False)
    payload,price,_=prepare(SourceVersion.model_validate(snapshot['source']),TaskSpec.model_validate(snapshot['task']),REQUEST,settings,50000)
    seen=[]
    def handler(request):
        body=json.loads(request.content)
        seen.append(body)
        return httpx.Response(401,json={'error':{'message':'Bad private-key-value','type':'invalid_api_key'}})
    monkeypatch.setattr(ai_provider,'AsyncOpenAI',lambda **kwargs: RealOpenAI(**kwargs,http_client=httpx.AsyncClient(transport=httpx.MockTransport(handler))))
    result=asyncio.run(ai_provider.analyze(payload,price,settings,lambda:False))
    assert result.failure=='provider_auth' and 'private-key-value' not in repr(result)
    assert seen[0]['text']['format']['strict'] and seen[0]['store'] is False and 'tools' not in seen[0]


def test_sdk_success_parses_structured_output_and_usage_without_network(monkeypatch,ai_client,files):
    _,_,snapshot=imported(ai_client,files)
    settings=replace(AI,test_mode=False)
    payload,price,_=prepare(SourceVersion.model_validate(snapshot['source']),TaskSpec.model_validate(snapshot['task']),REQUEST,settings,50000)
    seen=[]
    def handler(request):
        seen.append(request.url)
        return httpx.Response(200,json={
            'id':'resp_mock_only','object':'response','created_at':1,'status':'completed','model':settings.model,
            'output':[{'type':'message','id':'msg_mock','role':'assistant','status':'completed','content':[
                {'type':'output_text','text':parsed().model_dump_json(by_alias=True),'annotations':[]}]}],
            'usage':{'input_tokens':100,'output_tokens':20,'total_tokens':120,
                'input_tokens_details':{'cached_tokens':0},'output_tokens_details':{'reasoning_tokens':0}},
        })
    monkeypatch.setattr(ai_provider,'AsyncOpenAI',lambda **kwargs: RealOpenAI(**kwargs,http_client=httpx.AsyncClient(transport=httpx.MockTransport(handler))))
    result=asyncio.run(ai_provider.analyze(payload,price,settings,lambda:False))
    assert result.failure is None and result.parsed==parsed() and len(seen)==1
    assert result.usage.estimated_cost_micro_usd==165 and result.usage.total_tokens==120


def test_usage_is_integer_priced_and_cached_input_is_not_charged_twice():
    response=SimpleNamespace(usage=SimpleNamespace(input_tokens=1000,input_tokens_details=SimpleNamespace(cached_tokens=400),output_tokens=100,total_tokens=1100))
    usage=usage_of(response,price_for(AI.model))
    assert usage.estimated_cost_micro_usd==930
