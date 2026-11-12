from concurrent.futures import ThreadPoolExecutor
import csv
import hashlib
import io
import json
import zipfile
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from openpyxl import load_workbook
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.approved_export import build_export
from app.main import create_app
from app.models import ApprovalRecord
from app.worker import work_once
from test_data_api import confirm, imported, preview, project
from test_runs import start


def prepared(client,settings,files):
    pid,_,snapshot=imported(client,files)
    saved=client.post('/api/v1/projects/'+pid+'/tasks',json={'expectedSourceVersionId':snapshot['source']['id'],
        'expectedTaskId':snapshot['task']['id'],'request':'Анна отсутствует в среду с 09:00 до 17:00.',
        'absence':{'employeeId':'emily','shiftIds':['s05']},'fixedAssignments':{'s04':'sarah'}})
    assert saved.status_code==201,saved.text
    snapshot=client.get('/api/v1/projects/'+pid+'/workspace').json()
    run=start(client,pid,snapshot).json()
    assert work_once(settings,client.app.state.sessions)
    run=client.get('/api/v1/projects/'+pid+'/runs/'+run['id']).json()
    assert run['status']=='completed'
    review=client.get('/api/v1/projects/'+pid+'/runs/'+run['id']+'/review').json()
    assert review['candidates']
    return pid,snapshot,run,review['candidates'][0]


def approval_body(snapshot,run,candidate,**changes):
    return {'sourceVersionId':snapshot['source']['id'],'taskSpecId':snapshot['task']['id'],'runId':run['id'],
        'scenarioId':candidate['id'],'revisionId':candidate['revisionId'],'candidateHash':candidate['candidateHash'],
        'acknowledged':True,'requestKey':str(uuid4()),**changes}


def approve(client,pid,snapshot,run,candidate,**changes):
    return client.post('/api/v1/projects/'+pid+'/approvals',json=approval_body(snapshot,run,candidate,**changes))


def export(client,pid,approval,format='csv'):
    return client.post('/api/v1/projects/'+pid+'/approvals/'+approval['id']+'/exports',
        json={'format':format,'candidateHash':approval['candidateHash']})


def revision(client,pid,snapshot,run,candidate,assignments,**changes):
    return client.post('/api/v1/projects/'+pid+'/runs/'+run['id']+'/revisions',json={
        'sourceVersionId':snapshot['source']['id'],'taskSpecId':snapshot['task']['id'],
        'baseScenarioId':candidate['baseScenarioId'],'parentRevisionId':candidate['revisionId'],
        'assignments':assignments,'requestKey':str(uuid4()),**changes})


def validate(client,pid,candidate):
    return client.post('/api/v1/projects/'+pid+'/revisions/'+candidate['id']+'/validate')


def test_approval_requires_exact_checked_candidate_and_repeat_does_not_move_selection_back(client,settings,files):
    pid,snapshot,run,candidate=prepared(client,settings,files)
    assert approve(client,pid,snapshot,run,candidate,acknowledged=False).status_code==422
    assert approve(client,pid,snapshot,run,candidate,candidateHash='0'*64).status_code==409
    body=approval_body(snapshot,run,candidate)
    url='/api/v1/projects/'+pid+'/approvals'
    first=client.post(url,json=body)
    assert first.status_code==201,first.text
    first=first.json()
    assert first['isCurrent'] and first['isSelected'] and first['actor']=='local_user'
    assert first['sourceHash']==snapshot['source']['contentHash'] and not first['exports']
    assert approve(client,pid,snapshot,run,candidate).json()['id']==first['id']
    second_candidate=client.get('/api/v1/projects/'+pid+'/runs/'+run['id']+'/review').json()['candidates'][1]
    second=approve(client,pid,snapshot,run,second_candidate).json()
    assert second['id']!=first['id'] and second['isSelected']
    assert not client.post(url,json=body).json()['isSelected']
    assert client.post(url,json={**body,'candidateHash':'f'*64}).status_code==409
    history=client.get(url).json()
    assert len(history)==2 and sum(a['isSelected'] for a in history)==1
    after=client.get('/api/v1/projects/'+pid+'/workspace').json()
    assert after['source']==snapshot['source'] and after['task']==snapshot['task']
    with TestClient(create_app(settings)) as reopened:
        assert reopened.post(url,json=body).json()['id']==first['id']
        assert reopened.get(url).json()==history


def test_manual_revision_loses_validation_and_fixed_correction_requires_a_new_version(client,settings,files):
    pid,snapshot,run,base=prepared(client,settings,files)
    assignments={**base['scenario']['assignments'],'s05':'daniel'}
    key=str(uuid4())
    result=revision(client,pid,snapshot,run,base,assignments,requestKey=key)
    assert result.status_code==201,result.text
    bad=result.json()
    assert bad['validation'] is None and bad['metrics'] is None and bad['searchStatus'] is None
    assert revision(client,pid,snapshot,run,base,assignments,requestKey=key).json()['id']==bad['id']
    assert approve(client,pid,snapshot,run,bad).status_code==422
    checked=validate(client,pid,bad).json()
    assert checked['validation']['status']=='fail' and any(c['id']=='hours' and c['status']=='fail' for c in checked['validation']['checks'])
    assert validate(client,pid,bad).json()==checked
    assert approve(client,pid,snapshot,run,checked).status_code==422
    good=revision(client,pid,snapshot,run,checked,{**assignments,'s08':'christopher'}).json()
    assert good['revisionVersion']==bad['revisionVersion']+1 and good['parentRevisionId']==bad['id']
    assert good['validation'] is None
    good=validate(client,pid,good).json()
    assert good['validation']['status']=='pass' and good['searchStatus'] is None
    assert good['metrics']['costMinor']==307200 and good['metrics']['totalMinutes']==6720
    accepted=approve(client,pid,snapshot,run,good)
    assert accepted.status_code==201,accepted.text
    assert accepted.json()['origin']=='manual'
    review=client.get('/api/v1/projects/'+pid+'/runs/'+run['id']+'/review').json()
    assert next(c for c in review['candidates'] if c['id']==bad['id'])['validation']['status']=='fail'


@pytest.mark.parametrize('change',['missing','extra','employee','unchanged'])
def test_manual_revision_does_not_accept_broken_ids_or_an_empty_change(client,settings,files,change):
    pid,snapshot,run,base=prepared(client,settings,files)
    values=dict(base['scenario']['assignments'])
    if change=='missing': values.pop('s01')
    elif change=='extra': values['other']='emily'
    elif change=='employee': values['s05']='nobody'
    assert revision(client,pid,snapshot,run,base,values).status_code==422


@pytest.mark.parametrize('change',['task','source'])
def test_new_inputs_block_approval_revision_and_new_export_but_retain_prepared_artifacts(client,settings,files,change):
    pid,snapshot,run,candidate=prepared(client,settings,files)
    body=approval_body(snapshot,run,candidate)
    approval=client.post('/api/v1/projects/'+pid+'/approvals',json=body).json()
    receipt=export(client,pid,approval).json()
    if change=='task':
        assert client.post('/api/v1/projects/'+pid+'/tasks',json={'expectedSourceVersionId':snapshot['source']['id'],
            'expectedTaskId':snapshot['task']['id'],'request':'Новая версия'}).status_code==201
    else:
        draft=preview(client,pid,files,snapshot['source']['id'])
        assert confirm(client,pid,draft,snapshot['source']['id']).status_code==200
    assert approve(client,pid,snapshot,run,candidate).status_code==409
    assert revision(client,pid,snapshot,run,candidate,{**candidate['scenario']['assignments'],'s05':'daniel'}).status_code==409
    assert export(client,pid,approval,'xlsx').status_code==409
    assert export(client,pid,approval).json()['id']==receipt['id']
    assert not client.post('/api/v1/projects/'+pid+'/approvals',json=body).json()['isCurrent']
    downloaded=client.get('/api/v1/projects/'+pid+'/exports/'+receipt['id']+'/download')
    assert hashlib.sha256(downloaded.content).hexdigest()==receipt['sha256']


@pytest.mark.parametrize('format',['csv','xlsx'])
def test_approved_export_reimports_exact_assignments_absence_and_additional_pins(client,settings,files,format):
    pid,snapshot,run,candidate=prepared(client,settings,files)
    approval=approve(client,pid,snapshot,run,candidate).json()
    response=export(client,pid,approval,format)
    assert response.status_code==201,response.text
    receipt=response.json()
    assert export(client,pid,approval,format).json()==receipt
    url='/api/v1/projects/'+pid+'/exports/'+receipt['id']+'/download'
    downloaded=client.get(url)
    assert downloaded.status_code==200 and downloaded.headers['etag']=='"'+receipt['sha256']+'"'
    assert len(downloaded.content)==receipt['size'] and hashlib.sha256(downloaded.content).hexdigest()==receipt['sha256']
    with client.app.state.sessions() as db:
        record=db.get(ApprovalRecord,approval['id'])
        assert build_export(record,format)[0]==downloaded.content
    if format=='csv':
        with zipfile.ZipFile(io.BytesIO(downloaded.content)) as archive:
            manifest=json.loads(archive.read('manifest.json'))
            assert all(hashlib.sha256(archive.read(name)).hexdigest()==sha for name,sha in manifest['files'].items())
            assert json.loads(archive.read('approval.json'))['externallyApplied'] is False
            assert json.loads(archive.read('conditions.json'))==snapshot['task']
            bundle={kind:(kind+'.csv',archive.read(kind+'.csv'),'text/csv') for kind in ['schedule','employees','availability']}
    else:
        with zipfile.ZipFile(io.BytesIO(downloaded.content)) as archive:
            assert b'2000-01-01T00:00:00Z' in archive.read('docProps/core.xml')
        book=load_workbook(io.BytesIO(downloaded.content),data_only=False)
        assert len(list(book['Metadata'].values))==4
        assert not any(c.data_type=='f' for sheet in book for row in sheet for c in row)
        chunks={}
        for name,part,content in list(book['Audit'].values)[1:]:
            chunks.setdefault(name,[]).append((part,content))
        documents={name:json.loads(''.join(text for _,text in sorted(parts))) for name,parts in chunks.items()}
        assert documents['conditions.json']==snapshot['task']
        assert documents['input-source.json']==snapshot['source']
        book.close()
        bundle={'workbook':('approved.xlsx',downloaded.content,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')}
    new_project=project(client,'Обратное чтение')
    imported_result=preview(client,new_project,bundle)
    assert imported_result['canConfirm'],imported_result['issues']
    source=imported_result['preview']
    assert {s['id']:s['employeeId'] for s in source['shifts']}==candidate['scenario']['assignments']
    assert next(s for s in source['shifts'] if s['id']=='s04')['pinned']
    emily=next(e for e in source['employees'] if e['id']=='emily')
    assert emily['availability']['s05']==emily['availability']['s06']=='unavailable'
    with TestClient(create_app(settings)) as reopened:
        assert reopened.get(url).content==downloaded.content


def test_unknown_cost_needs_separate_ack_and_is_not_exported_as_zero(client,settings,files):
    rows=list(csv.reader(io.StringIO(files['employees'][1].decode())))
    for row in rows[1:]:
        if row[0]=='sophia': row[3]=''
    stream=io.StringIO();csv.writer(stream).writerows(rows)
    files['employees']=('employees.csv',stream.getvalue().encode(),'text/csv')
    pid,snapshot,run,candidate=prepared(client,settings,files)
    assert candidate['metrics']['costMinor'] is None
    assert approve(client,pid,snapshot,run,candidate).status_code==422
    approval=approve(client,pid,snapshot,run,candidate,acknowledgedUnknownCost=True).json()
    assert approval['hasUnknownCost']
    receipt=export(client,pid,approval).json()
    raw=client.get('/api/v1/projects/'+pid+'/exports/'+receipt['id']+'/download').content
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        assert json.loads(archive.read('metrics.json'))['costMinor'] is None


def test_cross_project_references_and_immutable_approval_history(client,settings,files):
    pid,snapshot,run,candidate=prepared(client,settings,files)
    manual=revision(client,pid,snapshot,run,candidate,{**candidate['scenario']['assignments'],'s05':'daniel'}).json()
    validate(client,pid,manual)
    approval=approve(client,pid,snapshot,run,candidate).json()
    receipt=export(client,pid,approval).json()
    other=project(client,'Другой проект')
    prefix='/api/v1/projects/'+other
    assert client.get(prefix+'/runs/'+run['id']+'/review').status_code==404
    assert client.post(prefix+'/revisions/'+manual['id']+'/validate').status_code==404
    assert client.get(prefix+'/approvals/'+approval['id']).status_code==404
    assert client.post(prefix+'/approvals/'+approval['id']+'/exports',json={'format':'csv','candidateHash':approval['candidateHash']}).status_code==404
    assert client.get(prefix+'/exports/'+receipt['id']+'/download').status_code==404
    with client.app.state.sessions() as db:
        for table in ['scenario_revisions','revision_validations','approvals','approval_requests','approved_exports']:
            for command in ['DELETE FROM '+table,'UPDATE '+table+' SET created_at=NOW()']:
                with pytest.raises(IntegrityError,match='immutable'):
                    db.execute(text(command))
                db.rollback()


@pytest.mark.parametrize('stage',['approval','export','download'])
def test_changed_original_or_artifact_blocks_issue(client,settings,files,stage):
    pid,snapshot,run,candidate=prepared(client,settings,files)
    approval=approve(client,pid,snapshot,run,candidate).json() if stage!='approval' else None
    receipt=export(client,pid,approval).json() if stage=='download' else None
    sha=receipt['sha256'] if receipt else snapshot['source']['originalFiles'][0]['sha256']
    path=client.app.state.store.path(sha);path.chmod(0o600);path.write_bytes(b'changed')
    if stage=='approval': response=approve(client,pid,snapshot,run,candidate)
    elif stage=='export': response=export(client,pid,approval)
    else: response=client.get('/api/v1/projects/'+pid+'/exports/'+receipt['id']+'/download')
    assert response.status_code==409


def test_concurrent_approval_and_export_retries_share_one_decision_and_file(client,settings,files):
    pid,snapshot,run,candidate=prepared(client,settings,files)
    body=approval_body(snapshot,run,candidate)
    def accept(_):
        return client.post('/api/v1/projects/'+pid+'/approvals',json=body).json()
    with ThreadPoolExecutor(max_workers=3) as pool:
        decisions=list(pool.map(accept,range(3)))
    assert len({d['id'] for d in decisions})==1
    with ThreadPoolExecutor(max_workers=3) as pool:
        receipts=list(pool.map(lambda _:export(client,pid,decisions[0]).json(),range(3)))
    assert len({r['id'] for r in receipts})==1 and len({r['sha256'] for r in receipts})==1


def test_edited_result_workbook_imports_as_new_data_without_inheriting_approval(client,settings,files):
    pid,snapshot,run,candidate=prepared(client,settings,files)
    approval=approve(client,pid,snapshot,run,candidate).json()
    receipt=export(client,pid,approval,'xlsx').json()
    raw=client.get('/api/v1/projects/'+pid+'/exports/'+receipt['id']+'/download').content
    book=load_workbook(io.BytesIO(raw))
    book['Employees'].cell(2,4,3100)
    output=io.BytesIO();book.save(output);book.close()
    other=project(client,'Изменённый файл')
    draft=preview(client,other,{'workbook':('changed.xlsx',output.getvalue(),'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')})
    assert draft['canConfirm'],draft['issues']
    assert any(issue['code']=='approved_result_changed' and issue['severity']=='warning' for issue in draft['issues'])
    assert confirm(client,other,draft).status_code==200
    assert client.get('/api/v1/projects/'+other+'/approvals').json()==[]
    loaded=client.get('/api/v1/projects/'+other+'/workspace').json()
    assert next(e for e in loaded['source']['employees'] if e['id']=='emily')['ratePerHourMinor']==3100


@pytest.mark.parametrize('change',['task','source'])
def test_unchecked_revision_cannot_validate_after_inputs_changed(client,settings,files,change):
    pid,snapshot,run,candidate=prepared(client,settings,files)
    manual=revision(client,pid,snapshot,run,candidate,{**candidate['scenario']['assignments'],'s05':'daniel'}).json()
    if change=='task':
        assert client.post('/api/v1/projects/'+pid+'/tasks',json={'expectedSourceVersionId':snapshot['source']['id'],
            'expectedTaskId':snapshot['task']['id'],'request':'Другие условия'}).status_code==201
    else:
        draft=preview(client,pid,files,snapshot['source']['id'])
        assert confirm(client,pid,draft,snapshot['source']['id']).status_code==200
    assert validate(client,pid,manual).status_code==409


@pytest.mark.parametrize('rule',['absence','pinned','roles','unknown'])
def test_manual_assignment_never_bypasses_hard_or_unknown_conditions(client,settings,files,rule):
    if rule=='unknown':
        rows=list(csv.reader(io.StringIO(files['availability'][1].decode())))
        for row in rows[1:]:
            if row[:2]==['sophia','s05']:row[2]='unknown'
        stream=io.StringIO();csv.writer(stream).writerows(rows)
        files['availability']=('availability.csv',stream.getvalue().encode(),'text/csv')
    pid,snapshot,run,candidate=prepared(client,settings,files)
    sid,eid={'absence':('s05','emily'),'pinned':('s02','sarah'),'roles':('s06','sophia'),'unknown':('s05','sophia')}[rule]
    manual=revision(client,pid,snapshot,run,candidate,{**candidate['scenario']['assignments'],sid:eid}).json()
    checked=validate(client,pid,manual).json()
    check_id={'absence':'availability','pinned':'pinned','roles':'roles','unknown':'availability'}[rule]
    assert next(c for c in checked['validation']['checks'] if c['id']==check_id)['status']==('unknown' if rule=='unknown' else 'fail')
    assert approve(client,pid,snapshot,run,checked).status_code==422
