"""Local decisions over immutable, independently checked schedule versions."""
import hashlib
import json
from datetime import timezone
from uuid import uuid4

from sqlalchemy import select

from .models import ApprovalRecord, ApprovalRequestRecord, ExportRecord, RevisionRecord, RevisionValidationRecord, TaskRecord
from .runs import now, run_or_404
from .schemas import ApprovalDetail, ExportReceipt, ReviewCandidate, Scenario, ScenarioReview, SolveResult, TaskSpec
from .service import ServiceError, project_or_404, source_or_404
from .validator import VALIDATOR_VERSION, evaluate


def digest(value):
    return hashlib.sha256(json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()


def current(project, source_id, task_id):
    return project.head_source_id==source_id and project.head_task_id==task_id


def require_current(project, source_id, task_id):
    if not current(project,source_id,task_id):
        raise ServiceError(409,'review_stale','Исходник или условия изменились. Откройте текущую версию и выполните новый расчёт.')


def originals(store, source):
    for file in source.original_files:
        store.read(file.sha256)


def run_inputs(db, project_id, run):
    source=source_or_404(db,project_id,run.source_id)
    record=db.get(TaskRecord,run.task_id)
    if not record or record.project_id!=project_id or record.source_id!=source.id or source.content_hash!=run.source_hash:
        raise ServiceError(409,'review_inputs','Входные версии не совпадают с сохранённым расчётом.')
    return source,TaskSpec.model_validate(record.payload)


def candidate_hash(run, scenario, revision_id):
    return digest({'runId':run.id,'sourceHash':run.source_hash,'sourceVersionId':run.source_id,
        'taskSpecId':run.task_id,'scenarioId':scenario.id,'revisionId':revision_id,'assignments':scenario.assignments})


def base_candidates(run):
    if run.status!='completed' or not run.result:
        return []
    result=SolveResult.model_validate(run.result)
    return [ReviewCandidate(id=item.scenario.id,run_id=run.id,base_scenario_id=item.scenario.id,
        revision_id=None,revision_version=None,parent_revision_id=None,origin='solver',scenario=item.scenario,
        candidate_hash=candidate_hash(run,item.scenario,None),validation=item.validation,metrics=item.metrics,evidence=item.evidence,
        search_status=item.search_status,created_at=run.created_at.astimezone(timezone.utc),
        validated_at=run.finished_at.astimezone(timezone.utc) if run.finished_at else None) for item in result.scenarios]


def revision_or_404(db, project_id, revision_id):
    revision=db.scalar(select(RevisionRecord).where(RevisionRecord.id==revision_id,RevisionRecord.project_id==project_id))
    if not revision:
        raise ServiceError(404,'revision_not_found','Ручная версия не найдена в этом проекте.')
    return revision


def revision_candidate(db, run, record):
    validation=db.get(RevisionValidationRecord,(record.id,VALIDATOR_VERSION))
    checked=validation.payload if validation else {}
    scenario=Scenario.model_validate(record.scenario)
    return ReviewCandidate(id=record.id,run_id=run.id,base_scenario_id=record.base_scenario_id,revision_id=record.id,
        revision_version=record.version,parent_revision_id=record.parent_revision_id,origin='manual',scenario=scenario,
        candidate_hash=candidate_hash(run,scenario,record.id),validation=checked.get('validation'),metrics=checked.get('metrics'),
        evidence=checked.get('evidence',[]),search_status=None,created_at=record.created_at.astimezone(timezone.utc),
        validated_at=validation.created_at.astimezone(timezone.utc) if validation else None)


def get_review(db, project_id, run_id):
    project=project_or_404(db,project_id)
    run=run_or_404(db,project_id,run_id)
    revisions=db.scalars(select(RevisionRecord).where(RevisionRecord.project_id==project_id,RevisionRecord.run_id==run_id)
        .order_by(RevisionRecord.version.desc()).limit(50)).all()
    approved=db.get(ApprovalRecord,project.head_approval_id) if project.head_approval_id else None
    if approved and approved.run_id==run.id and approved.revision_id and not any(r.id==approved.revision_id for r in revisions):
        revisions.append(revision_or_404(db,project_id,approved.revision_id))
    return ScenarioReview(project_id=project_id,source_version_id=run.source_id,task_spec_id=run.task_id,run_id=run.id,
        is_current=current(project,run.source_id,run.task_id),
        candidates=[*base_candidates(run),*[revision_candidate(db,run,r) for r in revisions]])


def selected_candidate(db, project_id, run, scenario_id, revision_id):
    if revision_id:
        record=revision_or_404(db,project_id,revision_id)
        if record.run_id!=run.id or record.id!=scenario_id:
            raise ServiceError(422,'revision_reference','Ручная версия не относится к выбранному варианту и запуску.')
        return revision_candidate(db,run,record)
    candidate=next((c for c in base_candidates(run) if c.id==scenario_id),None)
    if not candidate:
        raise ServiceError(422,'scenario_reference','Выберите конкретный завершённый вариант расчёта.')
    return candidate


def create_revision(db, store, project_id, run_id, body):
    project=project_or_404(db,project_id,lock=True)
    request_hash=digest({'runId':run_id,**body.model_dump(exclude={'request_key'})})
    previous=db.scalar(select(RevisionRecord).where(RevisionRecord.project_id==project_id,RevisionRecord.request_key==body.request_key))
    if previous:
        if previous.request_hash!=request_hash:
            raise ServiceError(409,'revision_key','Ключ относится к другой ручной правке.')
        return revision_candidate(db,run_or_404(db,project_id,run_id),previous)
    require_current(project,body.source_version_id,body.task_spec_id)
    run=run_or_404(db,project_id,run_id)
    if (run.source_id,run.task_id)!=(body.source_version_id,body.task_spec_id):
        raise ServiceError(409,'review_stale','Запуск относится к другим входным версиям.')
    base=selected_candidate(db,project_id,run,body.base_scenario_id,None)
    parent=base
    if body.parent_revision_id:
        parent=selected_candidate(db,project_id,run,body.parent_revision_id,body.parent_revision_id)
        if parent.base_scenario_id!=base.id:
            raise ServiceError(422,'revision_parent','Родительская версия относится к другому варианту.')
    source,_=run_inputs(db,project_id,run)
    originals(store,source)
    if set(body.assignments)!={s.id for s in source.shifts} or any(eid not in {e.id for e in source.employees} for eid in body.assignments.values()):
        raise ServiceError(422,'revision_assignments','Нужно ровно одно известное назначение для каждой исходной смены.')
    if body.assignments==parent.scenario.assignments:
        raise ServiceError(422,'revision_unchanged','Назначения не изменились.')
    project.revision_counter+=1
    created=now()
    scenario=Scenario(id=str(uuid4()),source_version_id=run.source_id,task_spec_id=run.task_id,
        label='Ручная версия R'+str(project.revision_counter),description='Ручная правка назначений; оптимизация не выполнялась.',
        assignments=body.assignments)
    record=RevisionRecord(id=scenario.id,project_id=project_id,source_id=run.source_id,task_id=run.task_id,run_id=run.id,
        base_scenario_id=base.id,parent_revision_id=body.parent_revision_id,version=project.revision_counter,
        source_hash=run.source_hash,request_key=body.request_key,request_hash=request_hash,
        scenario=scenario.model_dump(mode='json',by_alias=True),created_at=created)
    db.add(record)
    db.commit()
    return revision_candidate(db,run,record)


def validate_revision(db, store, project_id, revision_id):
    project=project_or_404(db,project_id,lock=True)
    record=revision_or_404(db,project_id,revision_id)
    run=run_or_404(db,project_id,record.run_id)
    if db.get(RevisionValidationRecord,(record.id,VALIDATOR_VERSION)):
        return revision_candidate(db,run,record)
    require_current(project,record.source_id,record.task_id)
    source,task=run_inputs(db,project_id,run)
    originals(store,source)
    report,metrics,evidence=evaluate(source,task,Scenario.model_validate(record.scenario))
    db.add(RevisionValidationRecord(revision_id=record.id,validator_version=VALIDATOR_VERSION,created_at=now(),payload={
        'validation':report.model_dump(mode='json',by_alias=True),'metrics':metrics.model_dump(mode='json',by_alias=True),
        'evidence':[item.model_dump(mode='json',by_alias=True) for item in evidence]}))
    db.commit()
    return revision_candidate(db,run,record)


def export_receipt(record):
    return ExportReceipt(id=record.id,project_id=record.project_id,approval_id=record.approval_id,format=record.format,
        exporter_version=record.exporter_version,sha256=record.sha256,size=record.size,filename=record.filename,
        created_at=record.created_at.astimezone(timezone.utc))


def approval_or_404(db, project_id, approval_id):
    record=db.scalar(select(ApprovalRecord).where(ApprovalRecord.id==approval_id,ApprovalRecord.project_id==project_id))
    if not record:
        raise ServiceError(404,'approval_not_found','Утверждение не найдено в этом проекте.')
    return record


def approval_detail(db, project, record):
    snapshot=record.snapshot
    candidate=ReviewCandidate.model_validate(snapshot['candidate'])
    exports=db.scalars(select(ExportRecord).where(ExportRecord.project_id==project.id,ExportRecord.approval_id==record.id)
        .order_by(ExportRecord.created_at)).all()
    return ApprovalDetail(id=record.id,project_id=project.id,source_version_id=record.source_id,task_spec_id=record.task_id,
        run_id=record.run_id,scenario_id=record.scenario_id,revision_id=record.revision_id,source_version=snapshot['source']['version'],
        task_version=snapshot['task']['version'],source_hash=snapshot['source']['contentHash'],candidate_hash=record.candidate_hash,
        scenario_label=candidate.scenario.label,origin=candidate.origin,actor='local_user',approved_at=record.created_at.astimezone(timezone.utc),
        validator_version=candidate.validation.validator_version,has_unknown_cost=candidate.metrics.cost_minor is None,
        is_current=current(project,record.source_id,record.task_id),is_selected=project.head_approval_id==record.id,
        exports=[export_receipt(e) for e in exports])


def list_approvals(db, project_id):
    project=project_or_404(db,project_id)
    records=db.scalars(select(ApprovalRecord).where(ApprovalRecord.project_id==project_id)
        .order_by(ApprovalRecord.created_at.desc()).limit(100)).all()
    return [approval_detail(db,project,r) for r in records]


def approve(db, store, project_id, body):
    project=project_or_404(db,project_id,lock=True)
    request_hash=digest(body.model_dump(exclude={'request_key'}))
    previous=db.scalar(select(ApprovalRequestRecord).where(ApprovalRequestRecord.project_id==project_id,
        ApprovalRequestRecord.request_key==body.request_key))
    if previous:
        if previous.request_hash!=request_hash:
            raise ServiceError(409,'approval_key','Ключ подтверждения относится к другому решению.')
        return approval_detail(db,project,approval_or_404(db,project_id,previous.approval_id))
    if not body.acknowledged:
        raise ServiceError(422,'approval_ack','Подтвердите проверку назначений и условий выбранной версии.')
    require_current(project,body.source_version_id,body.task_spec_id)
    run=run_or_404(db,project_id,body.run_id)
    if (run.source_id,run.task_id)!=(body.source_version_id,body.task_spec_id):
        raise ServiceError(409,'review_stale','Запуск относится к другим версиям.')
    candidate=selected_candidate(db,project_id,run,body.scenario_id,body.revision_id)
    if candidate.candidate_hash!=body.candidate_hash:
        raise ServiceError(409,'candidate_changed','Подтверждение относится к другой версии назначений.')
    if not candidate.validation or candidate.validation.status!='pass' or not candidate.metrics:
        raise ServiceError(422,'approval_unverified','Для утверждения нужна пройденная серверная проверка этой версии.')
    source,task=run_inputs(db,project_id,run)
    originals(store,source)
    validation,metrics,evidence=evaluate(source,task,candidate.scenario)
    if validation.status!='pass':
        raise ServiceError(422,'approval_validation','Повторная проверка выявила нарушение или неизвестные условия.')
    if validation!=candidate.validation or metrics!=candidate.metrics or evidence!=candidate.evidence:
        raise ServiceError(409,'validation_changed','Проверка или метрики изменились. Нужен новый расчёт или проверка новой ручной версии.')
    if metrics.cost_minor is None and not body.acknowledged_unknown_cost:
        raise ServiceError(422,'approval_unknown_cost','Подтвердите, что оплата неизвестна и не считается нулевой.')
    record=db.get(ApprovalRecord,project.head_approval_id) if project.head_approval_id else None
    created=now()
    if not record or record.candidate_hash!=candidate.candidate_hash:
        record=ApprovalRecord(id=str(uuid4()),project_id=project_id,source_id=source.id,task_id=task.id,run_id=run.id,
            scenario_id=candidate.id,revision_id=candidate.revision_id,candidate_hash=candidate.candidate_hash,created_at=created,
            snapshot={'source':source.model_dump(mode='json',by_alias=True),'task':task.model_dump(mode='json',by_alias=True),
                'candidate':candidate.model_dump(mode='json',by_alias=True),'engineVersion':run.engine_version,
                'actor':'local_user','acknowledgedUnknownCost':body.acknowledged_unknown_cost,'externallyApplied':False})
        db.add(record)
        db.flush()
        project.head_approval_id=record.id
        project.updated_at=created
    db.add(ApprovalRequestRecord(id=str(uuid4()),project_id=project_id,request_key=body.request_key,
        request_hash=request_hash,approval_id=record.id,created_at=created))
    db.commit()
    return approval_detail(db,project,record)
