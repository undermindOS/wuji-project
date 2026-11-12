import type { ApiSchemas, ImportPreview, ProjectSummary, TaskSpec, WorkspaceSnapshot } from '../model/types.ts';

export class WorkspaceApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'WorkspaceApiError'; this.status = status; this.code = code;
  }
}

export interface ProjectClient {
  listProjects(signal?: AbortSignal): Promise<ProjectSummary[]>;
  createProject(name: string, signal?: AbortSignal): Promise<ProjectSummary>;
  getWorkspace(projectId: string, options?: { sourceId?: string; taskId?: string; signal?: AbortSignal }): Promise<WorkspaceSnapshot>;
  previewImport(projectId: string, form: FormData, signal?: AbortSignal): Promise<ImportPreview>;
  confirmImport(preview: ImportPreview, signal?: AbortSignal): Promise<ApiSchemas['ImportConfirmation']>;
  saveTask(projectId: string, body: ApiSchemas['SaveTask'], signal?: AbortSignal): Promise<TaskSpec>;
  listRuns(projectId: string, sourceId: string, taskId: string, signal?: AbortSignal): Promise<ApiSchemas['RunSummary'][]>;
  getRun(projectId: string, runId: string, signal?: AbortSignal): Promise<ApiSchemas['RunDetail']>;
  startRun(projectId: string, body: ApiSchemas['StartRun'], signal?: AbortSignal): Promise<ApiSchemas['RunDetail']>;
  cancelRun(projectId: string, runId: string, signal?: AbortSignal): Promise<ApiSchemas['RunDetail']>;
  fixAssignments(projectId: string, runId: string, body: ApiSchemas['FixAssignments'], signal?: AbortSignal): Promise<ApiSchemas['FixedRun']>;
  getAiConfiguration(signal?: AbortSignal): Promise<ApiSchemas['AiConfiguration']>;
  listIntents(projectId: string, sourceId: string, taskId: string, signal?: AbortSignal): Promise<ApiSchemas['IntentDraft'][]>;
  getIntent(projectId: string, id: string, signal?: AbortSignal): Promise<ApiSchemas['IntentDraft']>;
  startIntent(projectId: string, body: ApiSchemas['StartIntent'], signal?: AbortSignal): Promise<ApiSchemas['IntentDraft']>;
  cancelIntent(projectId: string, id: string, signal?: AbortSignal): Promise<ApiSchemas['IntentDraft']>;
  confirmIntent(projectId: string, id: string, body: ApiSchemas['ConfirmIntent'], signal?: AbortSignal): Promise<TaskSpec>;
  getScenarioReview(projectId: string, runId: string, signal?: AbortSignal): Promise<ApiSchemas['ScenarioReview']>;
  createRevision(projectId: string, runId: string, body: ApiSchemas['CreateRevision'], signal?: AbortSignal): Promise<ApiSchemas['ReviewCandidate']>;
  validateRevision(projectId: string, id: string, signal?: AbortSignal): Promise<ApiSchemas['ReviewCandidate']>;
  listApprovals(projectId: string, signal?: AbortSignal): Promise<ApiSchemas['ApprovalDetail'][]>;
  approveScenario(projectId: string, body: ApiSchemas['ApproveScenario'], signal?: AbortSignal): Promise<ApiSchemas['ApprovalDetail']>;
  prepareApprovedExport(projectId: string, id: string, body: ApiSchemas['PrepareApprovedExport'], signal?: AbortSignal): Promise<ApiSchemas['ExportReceipt']>;
  downloadApprovedExport(receipt: ApiSchemas['ExportReceipt'], signal?: AbortSignal): Promise<Blob>;
  downloadTemplate(format: 'csv' | 'xlsx', signal?: AbortSignal): Promise<Blob>;
}

export class HttpWorkspaceClient implements ProjectClient {
  private fetcher: typeof fetch;
  constructor(fetcher: typeof fetch = fetch) { this.fetcher = fetcher.bind(globalThis); }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    let response: Response;
    try { response = await this.fetcher(`/api/v1${path}`, { ...init, headers: { Accept: 'application/json', ...init.headers } }); }
    catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error;
      throw new WorkspaceApiError(0, 'unavailable', 'Storage service unavailable. Try reconnecting.');
    }
    if (!response.headers.get('Content-Type')?.includes('application/json')) {
      throw new WorkspaceApiError(response.status, 'unavailable', 'Storage service unavailable. The demo is available separately.');
    }
    let body;
    try { body = await response.json(); }
    catch { throw new WorkspaceApiError(response.status, 'invalid_response', 'The service returned an incomplete response. Try again.'); }
    if (!response.ok) throw new WorkspaceApiError(response.status, body.code ?? 'request', body.message ?? 'Could not complete the request.');
    return body as T;
  }

  listProjects(signal?: AbortSignal) { return this.request<ProjectSummary[]>('/projects', { signal }); }
  createProject(name: string, signal?: AbortSignal) {
    return this.request<ProjectSummary>('/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }), signal });
  }
  getWorkspace(projectId: string, options: { sourceId?: string; taskId?: string; signal?: AbortSignal } = {}) {
    const query = new URLSearchParams();
    if (options.sourceId) query.set('source_id', options.sourceId);
    if (options.taskId) query.set('task_id', options.taskId);
    return this.request<WorkspaceSnapshot>(`/projects/${encodeURIComponent(projectId)}/workspace?${query}`, { signal: options.signal });
  }
  previewImport(projectId: string, form: FormData, signal?: AbortSignal) {
    return this.request<ImportPreview>(`/projects/${encodeURIComponent(projectId)}/imports`, { method: 'POST', body: form, signal });
  }
  confirmImport(preview: ImportPreview, signal?: AbortSignal) {
    return this.request<ApiSchemas['ImportConfirmation']>(`/projects/${encodeURIComponent(preview.projectId)}/imports/${encodeURIComponent(preview.id)}/confirm`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedSourceVersionId: preview.expectedSourceVersionId }), signal });
  }
  saveTask(projectId: string, body: ApiSchemas['SaveTask'], signal?: AbortSignal) {
    return this.request<TaskSpec>(`/projects/${encodeURIComponent(projectId)}/tasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
  }
  listRuns(projectId: string, sourceId: string, taskId: string, signal?: AbortSignal) {
    const query = new URLSearchParams({ source_id: sourceId, task_id: taskId });
    return this.request<ApiSchemas['RunSummary'][]>('/projects/' + encodeURIComponent(projectId) + '/runs?' + query, { signal });
  }
  getRun(projectId: string, runId: string, signal?: AbortSignal) {
    return this.request<ApiSchemas['RunDetail']>('/projects/' + encodeURIComponent(projectId) + '/runs/' + encodeURIComponent(runId), { signal });
  }
  startRun(projectId: string, body: ApiSchemas['StartRun'], signal?: AbortSignal) {
    return this.request<ApiSchemas['RunDetail']>('/projects/' + encodeURIComponent(projectId) + '/runs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
  }
  cancelRun(projectId: string, runId: string, signal?: AbortSignal) {
    return this.request<ApiSchemas['RunDetail']>('/projects/' + encodeURIComponent(projectId) + '/runs/' + encodeURIComponent(runId) + '/cancel', { method: 'POST', signal });
  }
  fixAssignments(projectId: string, runId: string, body: ApiSchemas['FixAssignments'], signal?: AbortSignal) {
    return this.request<ApiSchemas['FixedRun']>('/projects/' + encodeURIComponent(projectId) + '/runs/' + encodeURIComponent(runId) + '/fix', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
  }
  getAiConfiguration(signal?: AbortSignal) { return this.request<ApiSchemas['AiConfiguration']>('/ai/configuration', { signal }); }
  listIntents(projectId: string, sourceId: string, taskId: string, signal?: AbortSignal) {
    return this.request<ApiSchemas['IntentDraft'][]>('/projects/' + encodeURIComponent(projectId) + '/intents?' + new URLSearchParams({ source_id: sourceId, task_id: taskId }), { signal });
  }
  getIntent(projectId: string, id: string, signal?: AbortSignal) {
    return this.request<ApiSchemas['IntentDraft']>('/projects/' + encodeURIComponent(projectId) + '/intents/' + encodeURIComponent(id), { signal });
  }
  startIntent(projectId: string, body: ApiSchemas['StartIntent'], signal?: AbortSignal) {
    return this.request<ApiSchemas['IntentDraft']>('/projects/' + encodeURIComponent(projectId) + '/intents', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
  }
  cancelIntent(projectId: string, id: string, signal?: AbortSignal) {
    return this.request<ApiSchemas['IntentDraft']>('/projects/' + encodeURIComponent(projectId) + '/intents/' + encodeURIComponent(id) + '/cancel', { method: 'POST', signal });
  }
  confirmIntent(projectId: string, id: string, body: ApiSchemas['ConfirmIntent'], signal?: AbortSignal) {
    return this.request<TaskSpec>('/projects/' + encodeURIComponent(projectId) + '/intents/' + encodeURIComponent(id) + '/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
  }
  getScenarioReview(projectId: string, runId: string, signal?: AbortSignal) {
    return this.request<ApiSchemas['ScenarioReview']>('/projects/'+encodeURIComponent(projectId)+'/runs/'+encodeURIComponent(runId)+'/review',{signal});
  }
  createRevision(projectId: string, runId: string, body: ApiSchemas['CreateRevision'], signal?: AbortSignal) {
    return this.request<ApiSchemas['ReviewCandidate']>('/projects/'+encodeURIComponent(projectId)+'/runs/'+encodeURIComponent(runId)+'/revisions',
      {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal});
  }
  validateRevision(projectId: string, id: string, signal?: AbortSignal) {
    return this.request<ApiSchemas['ReviewCandidate']>('/projects/'+encodeURIComponent(projectId)+'/revisions/'+encodeURIComponent(id)+'/validate',{method:'POST',signal});
  }
  listApprovals(projectId: string, signal?: AbortSignal) { return this.request<ApiSchemas['ApprovalDetail'][]>('/projects/'+encodeURIComponent(projectId)+'/approvals',{signal}); }
  approveScenario(projectId: string, body: ApiSchemas['ApproveScenario'], signal?: AbortSignal) {
    return this.request<ApiSchemas['ApprovalDetail']>('/projects/'+encodeURIComponent(projectId)+'/approvals',
      {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal});
  }
  prepareApprovedExport(projectId: string, id: string, body: ApiSchemas['PrepareApprovedExport'], signal?: AbortSignal) {
    return this.request<ApiSchemas['ExportReceipt']>('/projects/'+encodeURIComponent(projectId)+'/approvals/'+encodeURIComponent(id)+'/exports',
      {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal});
  }
  async downloadApprovedExport(receipt: ApiSchemas['ExportReceipt'], signal?: AbortSignal) {
    let response: Response;
    try { response=await this.fetcher('/api/v1/projects/'+encodeURIComponent(receipt.projectId)+'/exports/'+encodeURIComponent(receipt.id)+'/download',{signal}); }
    catch (error) {
      if (error instanceof Error && error.name==='AbortError') throw error;
      throw new WorkspaceApiError(0,'unavailable','Could not retrieve the file. Try downloading again.');
    }
    const type=response.headers.get('Content-Type')??'';
    if (!response.ok || type.includes('application/json')) {
      let detail: {code?:string;message?:string}={};
      if (type.includes('application/json')) { try { detail=await response.json(); } catch { /* use explicit fallback below */ } }
      throw new WorkspaceApiError(response.status,detail.code??'export_download',detail.message??'File unavailable. Refresh the export history.');
    }
    const expected=receipt.format==='csv'?'application/zip':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    if (!type.includes(expected)) throw new WorkspaceApiError(response.status,'export_type','The server returned an unexpected file type.');
    const bytes=await response.arrayBuffer();
    const sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),value=>value.toString(16).padStart(2,'0')).join('');
    if (bytes.byteLength!==receipt.size || sha!==receipt.sha256) throw new WorkspaceApiError(409,'export_integrity','The file size or SHA-256 does not match the receipt.');
    return new Blob([bytes],{type:expected});
  }
  async downloadTemplate(format: 'csv' | 'xlsx', signal?: AbortSignal) {
    let response: Response;
    try { response=await this.fetcher(`/api/v1/templates?format=${format}`,{signal}); }
    catch (error) {
      if (error instanceof Error && error.name==='AbortError') throw error;
      throw new WorkspaceApiError(0,'unavailable','Storage service unavailable. Try reconnecting.');
    }
    const type=response.headers.get('Content-Type')??'';
    if (type.includes('application/json')) {
      let detail: {code?:string;message?:string}={};
      try { detail=await response.json(); } catch { /* use explicit fallback below */ }
      throw new WorkspaceApiError(response.status,detail.code??'template',detail.message??'Could not retrieve the template. Try downloading again.');
    }
    const expected=format==='csv'?'application/zip':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    // Without the server a static host answers this path with index.html; that page must not be saved as a template.
    if (!response.ok || !type.includes(expected)) throw new WorkspaceApiError(response.status,'unavailable','Storage service unavailable. The demo is available separately.');
    return new Blob([await response.arrayBuffer()],{type:expected});
  }
}

export const httpWorkspaceClient = new HttpWorkspaceClient();
export const exportSourceUrl = (projectId: string, sourceId: string, format: 'csv' | 'xlsx') => `/api/v1/projects/${encodeURIComponent(projectId)}/sources/${encodeURIComponent(sourceId)}/export?format=${format}`;
export const originalFileUrl = (projectId: string, sourceId: string, fileId: string) => `/api/v1/projects/${encodeURIComponent(projectId)}/sources/${encodeURIComponent(sourceId)}/originals/${encodeURIComponent(fileId)}`;
