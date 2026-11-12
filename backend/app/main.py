from contextlib import asynccontextmanager
from datetime import datetime, timezone as dt_timezone
import hashlib
from typing import Annotated, Literal
from urllib.parse import quote
from uuid import UUID, uuid4

from fastapi import FastAPI, File, Form, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
from sqlalchemy import select, text
from sqlalchemy.exc import OperationalError
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .config import ROOT, Settings
from .database import session_factory
from .exporter import export_source
from .importer import MAX_FILE_BYTES, parse_import
from .models import ImportDraft, Project
from .schemas import (
    ApiError, ConfirmImport, Health, ImportConfirmation, ImportPreview, ProjectCreate, ProjectSummary,
    SaveTask, TaskSpec, WorkspaceSnapshot, OriginalFile, SourceVersion,
)
from .service import ServiceError, confirm_import, project_or_404, project_summary, save_task, source_or_404, workspace_snapshot
from .storage import FileStore, IntegrityError
from .schemas import FixedRun, FixAssignments, RunDetail, RunSummary, StartRun
from .runs import cancel_run, fix_and_run, get_run, list_runs, start_run
from .ai_provider import AiSettings, configuration
from .schemas import AiConfiguration, ConfirmIntent, IntentDraft, StartIntent
from .intents import cancel_intent, confirm_intent, get_intent, list_intents, start_intent
from .schemas import ApprovalDetail, ApproveScenario, CreateRevision, ExportReceipt, PrepareApprovedExport, ReviewCandidate, ScenarioReview
from .review import approve, approval_detail, approval_or_404, create_revision, get_review, list_approvals, validate_revision
from .approved_export import download_export, prepare_export


def create_app(settings: Settings | None = None, ai_settings: AiSettings | None = None):
    settings = settings or Settings.from_env()
    ai_settings = ai_settings or AiSettings.from_env()
    engine, sessions = session_factory(settings.database_url)
    store = FileStore(settings.data_dir)

    @asynccontextmanager
    async def lifespan(app):
        yield
        engine.dispose()

    app = FastAPI(title='WUJI Local Workspace API', version='0.5.0', lifespan=lifespan,
        responses={400: {'model': ApiError}, 404: {'model': ApiError}, 409: {'model': ApiError}, 422: {'model': ApiError}})
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=['127.0.0.1', 'localhost', 'testserver'])
    app.state.engine = engine
    app.state.sessions = sessions
    app.state.store = store
    app.state.ai_settings = ai_settings

    @app.get('/api/v1/ai/configuration', response_model=AiConfiguration)
    def ai_configuration():
        return configuration(ai_settings)

    @app.middleware('http')
    async def local_request_boundary(request: Request, call_next):
        length = request.headers.get('content-length')
        if length and (not length.isdigit() or int(length) > 16 * 1024 * 1024):
            return JSONResponse(status_code=413, content=ApiError(code='request_size', message='The total request size is limited to 16 MB.').model_dump(by_alias=True))
        if request.method in {'POST', 'PUT', 'PATCH', 'DELETE'}:
            origin = request.headers.get('origin')
            from urllib.parse import urlsplit
            if origin and (urlsplit(origin).hostname not in {'127.0.0.1', 'localhost'} or urlsplit(origin).scheme != 'http'):
                return JSONResponse(status_code=403, content=ApiError(code='origin', message='The local API accepts changes only from the local interface.').model_dump(by_alias=True))
        response = await call_next(request)
        response.headers['X-Content-Type-Options'] = 'nosniff'
        return response

    @app.exception_handler(ServiceError)
    async def handle_service(request, error):
        return JSONResponse(status_code=error.status, content=error.error.model_dump(mode='json', by_alias=True))

    @app.exception_handler(IntegrityError)
    async def handle_integrity(request, error):
        return JSONResponse(status_code=409, content=ApiError(code='original_integrity', message='The original file is missing or its hash has changed. Upload it again.').model_dump(by_alias=True))

    @app.exception_handler(RequestValidationError)
    async def handle_validation(request, error):
        # Only the field path is echoed; Pydantic's msg and input carry the submitted values.
        fields = sorted({'.'.join(str(part) for part in item['loc'][1:]) for item in error.errors() if len(item['loc']) > 1})
        message = f'Check the request fields: {", ".join(fields)}.' if fields else 'Check the required request fields and types.'
        return JSONResponse(status_code=422, content=ApiError(code='request_schema', message=message).model_dump(by_alias=True))

    @app.exception_handler(OperationalError)
    async def handle_database(request, error):
        return JSONResponse(status_code=503, content=ApiError(code='database_unavailable', message='Database unavailable. Check that the backend is running and migrations are applied.').model_dump(by_alias=True))

    @app.get('/api/v1/health', response_model=Health)
    def health():
        with sessions() as db:
            db.execute(text('SELECT 1'))
        return Health(status='ok', storage='postgresql')

    @app.get('/api/v1/projects', response_model=list[ProjectSummary])
    def projects():
        with sessions() as db:
            return [project_summary(p) for p in db.scalars(select(Project).order_by(Project.updated_at.desc())).all()]

    @app.get('/api/v1/templates')
    def template(format: Literal['csv', 'xlsx'] = 'csv'):
        directory = ROOT / 'docs' / 'examples' / 'absence'
        files = []
        for kind, name in [('schedule', 'team_week_02-08_nov.csv'), ('employees', 'employees.csv'), ('availability', 'availability.csv')]:
            raw = (directory / name).read_bytes()
            files.append((OriginalFile(id=str(uuid4()), filename=name, kind=kind, sha256=hashlib.sha256(raw).hexdigest(), size=len(raw)), raw))
        parsed = parse_import(files, 'North Studio', 'America/New_York', 'USD')
        source = SourceVersion(**parsed.source.model_dump(), id='template', version=0)
        content, media, _ = export_source(source, format)
        return Response(content, media_type=media, headers={'Content-Disposition': f'attachment; filename="wuji-template.{"zip" if format == "csv" else "xlsx"}"'})

    @app.post('/api/v1/projects', response_model=ProjectSummary, status_code=201)
    def create_project(payload: ProjectCreate):
        with sessions() as db:
            project = Project(id=str(uuid4()), name=payload.name, source_counter=0, task_counter=0,
                created_at=datetime.now(dt_timezone.utc), updated_at=datetime.now(dt_timezone.utc))
            db.add(project)
            db.commit()
            return project_summary(project)

    @app.get('/api/v1/projects/{project_id}/workspace', response_model=WorkspaceSnapshot)
    def workspace(project_id: UUID, source_id: UUID | None = None, task_id: UUID | None = None):
        with sessions() as db:
            return workspace_snapshot(db, str(project_id), str(source_id) if source_id else None, str(task_id) if task_id else None)

    @app.post('/api/v1/projects/{project_id}/imports', response_model=ImportPreview, status_code=201)
    def preview_import(project_id: UUID, timezone: Annotated[str, Form()], currency: Annotated[str, Form()],
        team_name: Annotated[str, Form()], expected_source_version_id: Annotated[str | None, Form()] = None,
        schedule: Annotated[UploadFile | None, File()] = None, employees: Annotated[UploadFile | None, File()] = None,
        availability: Annotated[UploadFile | None, File()] = None, workbook: Annotated[UploadFile | None, File()] = None):
        with sessions() as db:
            project = project_or_404(db, str(project_id))
            if project.head_source_id != expected_source_version_id:
                raise ServiceError(409, 'source_conflict', 'The project’s current source has changed. Refresh the project before importing.')
            # Length and spelling become import issues; a control character cannot, because JSONB
            # rejects \u0000 and the preview row would fail to store before the issue is reported.
            if any(ord(character) < 32 for character in team_name):
                raise ServiceError(422, 'team_name', 'The team name must not contain control characters.')
            files = []
            for kind, upload in [('schedule', schedule), ('employees', employees), ('availability', availability), ('workbook', workbook)]:
                if upload:
                    basename = (upload.filename or '').replace('\\', '/').split('/')[-1]
                    if not basename or len(basename) > 255 or any(ord(c) < 32 for c in basename):
                        raise ServiceError(422, 'filename', 'The filename must contain up to 255 characters without control characters.')
                    raw = upload.file.read(MAX_FILE_BYTES + 1)
                    if len(raw) > MAX_FILE_BYTES:
                        raise ServiceError(413, 'file_size', 'Each file is limited to 5 MB.')
                    original = store.save(upload.filename or f'{kind}.csv', kind, raw)
                    files.append((original, raw))
            parsed = parse_import(files, team_name, timezone, currency)
            draft_id = str(uuid4())
            preview = ImportPreview(id=draft_id, project_id=project.id, expected_source_version_id=expected_source_version_id,
                can_confirm=parsed.source is not None, issues=parsed.issues, row_counts=parsed.row_counts,
                preview_rows=parsed.preview_rows, preview=parsed.source, files=[file for file, _ in files])
            db.add(ImportDraft(id=draft_id, project_id=project.id, expected_source_id=expected_source_version_id,
                preview=preview.model_dump(mode='json', by_alias=True)))
            db.commit()
            return preview

    @app.post('/api/v1/projects/{project_id}/imports/{draft_id}/confirm', response_model=ImportConfirmation)
    def confirm(project_id: UUID, draft_id: UUID, payload: ConfirmImport):
        with sessions() as db:
            return confirm_import(db, store, str(project_id), str(draft_id), payload.expected_source_version_id)

    @app.post('/api/v1/projects/{project_id}/tasks', response_model=TaskSpec, status_code=201)
    def task(project_id: UUID, payload: SaveTask):
        with sessions() as db:
            return save_task(db, str(project_id), payload)

    @app.post('/api/v1/projects/{project_id}/runs', response_model=RunDetail, status_code=201)
    def create_run(project_id: UUID, payload: StartRun):
        with sessions() as db:
            return start_run(db, store, str(project_id), payload)

    @app.get('/api/v1/projects/{project_id}/runs', response_model=list[RunSummary])
    def runs(project_id: UUID, source_id: UUID | None = None, task_id: UUID | None = None):
        with sessions() as db:
            return list_runs(db, str(project_id), str(source_id) if source_id else None, str(task_id) if task_id else None)

    @app.get('/api/v1/projects/{project_id}/runs/{run_id}', response_model=RunDetail)
    def run(project_id: UUID, run_id: UUID):
        with sessions() as db:
            return get_run(db, str(project_id), str(run_id))

    @app.post('/api/v1/projects/{project_id}/runs/{run_id}/cancel', response_model=RunDetail)
    def cancel(project_id: UUID, run_id: UUID):
        with sessions() as db:
            return cancel_run(db, str(project_id), str(run_id))

    @app.post('/api/v1/projects/{project_id}/runs/{run_id}/fix', response_model=FixedRun, status_code=201)
    def fix(project_id: UUID, run_id: UUID, payload: FixAssignments):
        with sessions() as db:
            return fix_and_run(db, store, str(project_id), str(run_id), payload)

    @app.post('/api/v1/projects/{project_id}/intents', response_model=IntentDraft, status_code=201)
    def create_intent(project_id: UUID, payload: StartIntent):
        with sessions() as db:
            return start_intent(db, store, ai_settings, str(project_id), payload)

    @app.get('/api/v1/projects/{project_id}/intents', response_model=list[IntentDraft])
    def intents(project_id: UUID, source_id: UUID, task_id: UUID):
        with sessions() as db:
            return list_intents(db, str(project_id), str(source_id), str(task_id))

    @app.get('/api/v1/projects/{project_id}/intents/{draft_id}', response_model=IntentDraft)
    def intent(project_id: UUID, draft_id: UUID):
        with sessions() as db:
            return get_intent(db, str(project_id), str(draft_id))

    @app.post('/api/v1/projects/{project_id}/intents/{draft_id}/cancel', response_model=IntentDraft)
    def intent_cancel(project_id: UUID, draft_id: UUID):
        with sessions() as db:
            return cancel_intent(db, str(project_id), str(draft_id))

    @app.post('/api/v1/projects/{project_id}/intents/{draft_id}/confirm', response_model=TaskSpec)
    def intent_confirm(project_id: UUID, draft_id: UUID, payload: ConfirmIntent):
        with sessions() as db:
            return confirm_intent(db, store, str(project_id), str(draft_id), payload)

    @app.get('/api/v1/projects/{project_id}/sources/{source_id}/originals/{file_id}')
    def original(project_id: UUID, source_id: UUID, file_id: UUID):
        with sessions() as db:
            source = source_or_404(db, str(project_id), str(source_id))
            file = next((file for file in source.original_files if file.id == str(file_id)), None)
            if not file:
                raise ServiceError(404, 'file_not_found', 'The file does not belong to this source version.')
            content = store.read(file.sha256)
            return Response(content, media_type='application/octet-stream', headers={
                'Content-Disposition': f"attachment; filename*=UTF-8''{quote(file.filename, safe='')}", 'ETag': f'"{file.sha256}"'})

    @app.get('/api/v1/projects/{project_id}/runs/{run_id}/review',response_model=ScenarioReview)
    def review(project_id: UUID,run_id: UUID):
        with sessions() as db:
            return get_review(db,str(project_id),str(run_id))

    @app.post('/api/v1/projects/{project_id}/runs/{run_id}/revisions',response_model=ReviewCandidate,status_code=201)
    def revision(project_id: UUID,run_id: UUID,payload: CreateRevision):
        with sessions() as db:
            return create_revision(db,store,str(project_id),str(run_id),payload)

    @app.post('/api/v1/projects/{project_id}/revisions/{revision_id}/validate',response_model=ReviewCandidate)
    def revision_validate(project_id: UUID,revision_id: UUID):
        with sessions() as db:
            return validate_revision(db,store,str(project_id),str(revision_id))

    @app.get('/api/v1/projects/{project_id}/approvals',response_model=list[ApprovalDetail])
    def approvals(project_id: UUID):
        with sessions() as db:
            return list_approvals(db,str(project_id))

    @app.get('/api/v1/projects/{project_id}/approvals/{approval_id}',response_model=ApprovalDetail)
    def approval(project_id: UUID,approval_id: UUID):
        with sessions() as db:
            project=project_or_404(db,str(project_id))
            return approval_detail(db,project,approval_or_404(db,str(project_id),str(approval_id)))

    @app.post('/api/v1/projects/{project_id}/approvals',response_model=ApprovalDetail,status_code=201)
    def approval_create(project_id: UUID,payload: ApproveScenario):
        with sessions() as db:
            return approve(db,store,str(project_id),payload)

    @app.post('/api/v1/projects/{project_id}/approvals/{approval_id}/exports',response_model=ExportReceipt,status_code=201)
    def approved_export(project_id: UUID,approval_id: UUID,payload: PrepareApprovedExport):
        with sessions() as db:
            return prepare_export(db,store,str(project_id),str(approval_id),payload)

    @app.get('/api/v1/projects/{project_id}/exports/{export_id}/download',response_class=Response,responses={
        200:{'description':'Immutable approved schedule artifact','content':{
            'application/zip':{'schema':{'type':'string','format':'binary'}},
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':{'schema':{'type':'string','format':'binary'}}}}})
    def approved_download(project_id: UUID,export_id: UUID):
        with sessions() as db:
            record,content=download_export(db,store,str(project_id),str(export_id))
            return Response(content,media_type=record.media_type,headers={
                'Content-Disposition':f'attachment; filename="{record.filename}"','ETag':f'"{record.sha256}"',
                'X-WUJI-Approval':record.approval_id,'Cache-Control':'private, no-store'})

    @app.get('/api/v1/projects/{project_id}/sources/{source_id}/export')
    def export(project_id: UUID, source_id: UUID, format: Literal['csv', 'xlsx'] = 'csv'):
        with sessions() as db:
            source = source_or_404(db, str(project_id), str(source_id))
            content, media, filename = export_source(source, format)
            return Response(content, media_type=media, headers={'Content-Disposition': f'attachment; filename="{filename}"',
                'ETag': f'"{hashlib.sha256(content).hexdigest()}"', 'X-WUJI-Source-Version': source.id})

    return app


app = create_app()
