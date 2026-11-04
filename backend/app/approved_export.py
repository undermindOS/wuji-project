"""Build an artifact exclusively from an immutable approval snapshot."""
from datetime import datetime, timezone
import hashlib
import io
import json
import re
import zipfile
from uuid import uuid4

from openpyxl import Workbook
from openpyxl.cell.cell import ILLEGAL_CHARACTERS_RE
from openpyxl.styles import Font, PatternFill
from sqlalchemy import select

from .contracts import LIMITS, MAX_FILE_BYTES, csv_bytes
from .exporter import source_tables, stable_zip
from .models import ExportRecord
from .review import approval_or_404, export_receipt, originals, require_current
from .runs import now
from .schemas import ReviewCandidate, SourceVersion, TaskSpec
from .service import ServiceError, project_or_404
from .validator import evaluate

EXPORTER_VERSION='approved-schedule/1'


def json_bytes(value):
    return (json.dumps(value,ensure_ascii=False,sort_keys=True,indent=2)+'\n').encode()


def effective_source(source, task, candidate):
    """Persist absence and additional pins in the reimportable result tables."""
    shifts=[s.model_copy(update={'employee_id':candidate.scenario.assignments[s.id],
        'pinned':s.pinned or s.id in task.fixed_assignments}) for s in source.shifts]
    employees=[]
    intervals=[s for s in source.shifts if task.absence and s.id in task.absence.shift_ids]
    for employee in source.employees:
        availability=dict(employee.availability)
        if task.absence and employee.id==task.absence.employee_id:
            for shift in source.shifts:
                if any(datetime.fromisoformat(shift.starts_at)<datetime.fromisoformat(s.ends_at)
                    and datetime.fromisoformat(s.starts_at)<datetime.fromisoformat(shift.ends_at) for s in intervals):
                    availability[shift.id]='unavailable'
        employees.append(employee.model_copy(update={'availability':availability}))
    return source.model_copy(update={'shifts':shifts,'employees':employees})


def workbook_bytes(tables, documents, metadata):
    book=Workbook()
    book.remove(book.active)
    book.properties.created=book.properties.modified=datetime(2000,1,1)
    def sheet(name, rows):
        page=book.create_sheet(name)
        for values in rows:
            row=[]
            for value in values:
                if isinstance(value,str):
                    value=ILLEGAL_CHARACTERS_RE.sub(lambda m:'\\u'+format(ord(m.group()),'04x'),value)
                    if len(value)>30000:
                        raise ServiceError(422,'export_cell_size','Содержимое ячейки превышает безопасный размер XLSX. Данные не обрезались.')
                row.append(value)
            page.append(row)
        for row in page:
            for cell in row:
                if isinstance(cell.value,str):
                    cell.data_type='s'
        for cell in page[1]:
            cell.font=Font(name='Courier New',color='00FF41',bold=True)
            cell.fill=PatternFill('solid',fgColor='000000')
        page.freeze_panes='A2'
        page.auto_filter.ref=page.dimensions
        for column in page.columns:
            page.column_dimensions[column[0].column_letter].width=min(58,max(18,len(str(column[0].value or ''))+3))
        return page
    for title,kind in [('Schedule','schedule'),('Employees','employees'),('Availability','availability')]:
        sheet(title,tables[kind])
    # Importer deliberately accepts only these three Metadata keys.
    sheet('Metadata',[['key','value'],*[[key,metadata[key]] for key in ['timezone','currency','team_name']]])
    approval=documents['approval.json']
    sheet('Approval',[['field','value'],*[[key,json.dumps(value,ensure_ascii=False) if isinstance(value,(dict,list)) else value]
        for key,value in approval.items()]])
    metrics=documents['metrics.json']
    sheet('Metrics',[['metric','value','unit'],*[[key,value,'minor '+metadata['currency'] if 'cost' in key else 'minutes' if key=='totalMinutes' else '']
        for key,value in metrics.items() if not isinstance(value,(list,dict))]])
    report=documents['validation.json']
    sheet('Validation',[['id','label','status','detail','shift_ids'],*[[c['id'],c['label'],c['status'],c['detail'],'|'.join(c['shiftIds'])] for c in report['checks']]])
    changes=metrics['changes']
    sheet('Changes',[['shift_id','before_employee_id','after_employee_id','source_row'],
        *[[c['shiftId'],c['beforeEmployeeId'],c['afterEmployeeId'],c['sourceRow']] for c in changes]])
    conditions=documents['conditions.json']
    condition_rows=[['field','value'],['task_id',conditions['id']],['request',conditions['request']],['objective',conditions['objective']]]
    if conditions['absence']:
        condition_rows.append(['absence_employee',conditions['absence']['employeeId']])
        condition_rows.extend(['absence_shift',sid] for sid in conditions['absence']['shiftIds'])
    condition_rows.extend(['fixed:'+sid,eid] for sid,eid in sorted(conditions['fixedAssignments'].items()))
    condition_rows.extend(['rule:'+r['id'],r['detail']] for r in conditions['rules'])
    sheet('Conditions',condition_rows)
    # Complete JSON documents are retained in ordered chunks; no 32767-character truncation.
    audit=[['document','part','json_text']]
    for name,value in documents.items():
        encoded=json_bytes(value).decode()
        audit.extend([name,index//12000+1,encoded[index:index+12000]] for index in range(0,len(encoded),12000))
    sheet('Audit',audit)
    buffer=io.BytesIO()
    book.save(buffer)
    book.close()
    with zipfile.ZipFile(io.BytesIO(buffer.getvalue())) as archive:
        entries={name:archive.read(name) for name in archive.namelist()}
    # openpyxl overwrites modified at save time; normalize the generated core XML too.
    entries['docProps/core.xml']=re.sub(rb'(<dcterms:modified[^>]*>)[^<]*(</dcterms:modified>)',
        rb'\g<1>2000-01-01T00:00:00Z\g<2>',entries['docProps/core.xml'])
    return stable_zip(entries)


def build_export(approval, format):
    snapshot=approval.snapshot
    source=SourceVersion.model_validate(snapshot['source'])
    task=TaskSpec.model_validate(snapshot['task'])
    candidate=ReviewCandidate.model_validate(snapshot['candidate'])
    result=effective_source(source,task,candidate)
    tables=source_tables(result,sparse=True)
    data={kind:csv_bytes(rows) for kind,rows in tables.items()}
    if any(len(tables[kind])-1>LIMITS[kind] or len(raw)>MAX_FILE_BYTES for kind,raw in data.items()):
        raise ServiceError(422,'export_limit','Результат превышает пределы повторного импорта. Данные не обрезались.')
    metadata={'timezone':source.timezone,'currency':source.currency,'team_name':source.team_name}
    summary={'approvalId':approval.id,'approvedAt':approval.created_at.astimezone(timezone.utc).isoformat(),'actor':snapshot['actor'],
        'sourceVersionId':source.id,'sourceVersion':source.version,'sourceHash':source.content_hash,
        'taskSpecId':task.id,'taskVersion':task.version,'runId':approval.run_id,'scenarioId':candidate.id,
        'revisionId':candidate.revision_id,'candidateHash':candidate.candidate_hash,'origin':candidate.origin,
        'engineVersion':snapshot['engineVersion'],'validatorVersion':candidate.validation.validator_version,
        'searchStatus':candidate.search_status,'hasUnknownCost':candidate.metrics.cost_minor is None,
        'acknowledgedUnknownCost':snapshot['acknowledgedUnknownCost'],'externallyApplied':False,
        'intentMode':task.interpretation.provider_mode if task.interpretation else 'none','exporterVersion':EXPORTER_VERSION}
    documents={'approval.json':summary,'conditions.json':snapshot['task'],
        'input-source.json':snapshot['source'],'metrics.json':candidate.metrics.model_dump(mode='json',by_alias=True),
        'validation.json':candidate.validation.model_dump(mode='json',by_alias=True),
        'evidence.json':[e.model_dump(mode='json',by_alias=True) for e in candidate.evidence],
        'metadata.json':metadata}
    entries={kind+'.csv':raw for kind,raw in data.items()}
    entries['changes.csv']=csv_bytes([['shift_id','before_employee_id','after_employee_id','source_row'],*[
        [c.shift_id,c.before_employee_id,c.after_employee_id,c.source_row] for c in candidate.metrics.changes]])
    entries.update({name:json_bytes(value) for name,value in documents.items()})
    documents['manifest.json']={'exporterVersion':EXPORTER_VERSION,'approvalId':approval.id,
        'files':{name:hashlib.sha256(raw).hexdigest() for name,raw in entries.items()}}
    entries['manifest.json']=json_bytes(documents['manifest.json'])
    if sum(map(len,entries.values()))>40*1024*1024:
        raise ServiceError(422,'export_size','Раскрытый набор превышает 40 МБ. Данные не обрезались.')
    if format=='csv':
        content,media,extension=stable_zip(entries),'application/zip','zip'
    else:
        content,media,extension=workbook_bytes(tables,documents,metadata),'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','xlsx'
    if len(content)>(MAX_FILE_BYTES if format=='xlsx' else 40*1024*1024):
        raise ServiceError(422,'export_size','Файл превышает поддержанный размер. Данные не обрезались.')
    if format=='xlsx':
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            if sum(item.file_size for item in archive.infolist())>20*1024*1024:
                raise ServiceError(422,'export_size','Раскрытый XLSX превышает 20 МБ и не подходит для повторного импорта. Данные не обрезались.')
    return content,media,'wuji-approved-'+approval.id[:8]+'-s'+str(source.version)+'-t'+str(task.version)+'.'+extension


def prepare_export(db, store, project_id, approval_id, body):
    project=project_or_404(db,project_id,lock=True)
    approval=approval_or_404(db,project_id,approval_id)
    if approval.candidate_hash!=body.candidate_hash:
        raise ServiceError(409,'export_candidate','Экспорт запрошен для другого утверждения.')
    source=SourceVersion.model_validate(approval.snapshot['source'])
    originals(store,source)
    previous=db.scalar(select(ExportRecord).where(ExportRecord.approval_id==approval.id,
        ExportRecord.format==body.format,ExportRecord.exporter_version==EXPORTER_VERSION))
    if previous:
        store.read(previous.sha256)
        return export_receipt(previous)
    require_current(project,approval.source_id,approval.task_id)
    if project.head_approval_id!=approval.id:
        raise ServiceError(409,'approval_superseded','Выбран другой утверждённый вариант. Старые готовые файлы остаются в истории.')
    candidate=ReviewCandidate.model_validate(approval.snapshot['candidate'])
    validation,metrics,evidence=evaluate(source,TaskSpec.model_validate(approval.snapshot['task']),candidate.scenario)
    if validation!=candidate.validation or metrics!=candidate.metrics or evidence!=candidate.evidence or validation.status!='pass':
        raise ServiceError(409,'export_validation','Проверка утверждённого снимка изменилась. Нужны новая проверка и утверждение.')
    content,media,filename=build_export(approval,body.format)
    saved=store.save(filename,'approved_export',content)
    record=ExportRecord(id=str(uuid4()),project_id=project_id,approval_id=approval.id,format=body.format,
        exporter_version=EXPORTER_VERSION,sha256=saved.sha256,size=saved.size,filename=filename,media_type=media,created_at=now())
    db.add(record)
    db.commit()
    return export_receipt(record)


def download_export(db, store, project_id, export_id):
    project_or_404(db,project_id)
    record=db.scalar(select(ExportRecord).where(ExportRecord.id==export_id,ExportRecord.project_id==project_id))
    if not record:
        raise ServiceError(404,'export_not_found','Файл не найден в этом проекте.')
    approval=approval_or_404(db,project_id,record.approval_id)
    originals(store,SourceVersion.model_validate(approval.snapshot['source']))
    return record,store.read(record.sha256)
