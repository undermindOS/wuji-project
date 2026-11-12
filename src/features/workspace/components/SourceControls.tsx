import { useEffect, useRef, useState } from 'react';
import { workspaceClient } from '../api/WorkspaceClient.ts';
import { WorkspaceApiError, originalFileUrl } from '../api/HttpWorkspaceClient.ts';
import { durationMinutes } from '../model/schedule.ts';
import type { ImportPreview, ProjectSummary, SourceVersion, WorkspaceSnapshot } from '../model/types.ts';

interface SourceControlsProps {
  source: SourceVersion;
  snapshot: WorkspaceSnapshot | null;
  onOpenProject: (id: string, sourceId?: string) => void;
}

export default function SourceControls({ source, snapshot, onOpenProject }: SourceControlsProps) {
  const [panel, setPanel] = useState<'import' | 'projects' | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [target, setTarget] = useState<ProjectSummary | null>(snapshot?.project ?? null);
  const [projectName, setProjectName] = useState('My project');
  const [teamName, setTeamName] = useState(source.teamName);
  const [timezone, setTimezone] = useState(source.timezone);
  const [currency, setCurrency] = useState(source.currency);
  const [format, setFormat] = useState<'csv' | 'xlsx'>('csv');
  const [files, setFiles] = useState<Record<string, File>>({});
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [templateBusy, setTemplateBusy] = useState(false);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const templateController = useRef<AbortController | null>(null);
  const operation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  useEffect(() => () => { controller.current?.abort(); operation.current += 1; }, []);
  useEffect(() => () => templateController.current?.abort(), []);
  useEffect(() => { if (preview) previewRef.current?.scrollIntoView({ block: 'nearest' }); }, [preview?.id]);

  const invalidate = () => {
    operation.current += 1; controller.current?.abort(); setPreview(null); setBusy(false); setError(null); setConflict(false);
  };
  const run = async (work: (signal: AbortSignal, active: () => boolean) => Promise<void>) => {
    controller.current?.abort();
    const current = ++operation.current;
    const abort = new AbortController(); controller.current = abort;
    const active = () => current === operation.current && !abort.signal.aborted;
    setBusy(true); setError(null); setConflict(false);
    try { await work(abort.signal, active); }
    catch (value) { if (active()) { setError(value instanceof Error ? value.message : 'Could not complete the request.'); setConflict(value instanceof WorkspaceApiError && value.status === 409); } }
    finally { if (active()) setBusy(false); }
  };
  const openProjects = () => {
    invalidate(); setPanel(panel === 'projects' ? null : 'projects');
    if (panel !== 'projects') void run(async (signal, active) => { const result = await workspaceClient.listProjects(signal); if (active()) setProjects(result); });
  };
  const upload = () => void run(async (signal, active) => {
    let project = target;
    if (!project) {
      project = await workspaceClient.createProject(projectName, signal);
      if (!active()) return;
      setTarget(project);
    }
    const form = new FormData();
    form.set('team_name', teamName); form.set('timezone', timezone); form.set('currency', currency);
    if (project.headSourceId) form.set('expected_source_version_id', project.headSourceId);
    for (const [kind, file] of Object.entries(files)) form.set(kind, file);
    const result = await workspaceClient.previewImport(project.id, form, signal);
    if (active()) setPreview(result);
  });
  const confirm = () => {
    if (!preview?.canConfirm) return;
    void run(async (signal, active) => {
      const result = await workspaceClient.confirmImport(preview, signal);
      if (active()) onOpenProject(result.projectId, result.sourceId);
    });
  };
  // The template is not an import step: it keeps its own status so the import's status line and errors stay as they are.
  const downloadTemplate = async () => {
    const abort = new AbortController(); templateController.current = abort;
    const requested = format;
    setTemplateBusy(true); setTemplateError(null);
    try {
      const blob = await workspaceClient.downloadTemplate(requested, abort.signal);
      if (abort.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a'); link.href = url; link.download = `wuji-template.${requested === 'csv' ? 'zip' : 'xlsx'}`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (value) {
      if (!abort.signal.aborted) setTemplateError(value instanceof Error ? value.message : 'Could not retrieve the template.');
    } finally {
      if (!abort.signal.aborted) setTemplateBusy(false);
    }
  };
  const ready = format === 'xlsx' ? !!files.workbook : !!files.schedule && !!files.employees;

  return (
    <div className="ws-source-controls">
      <div className="ws-source-actions"><button type="button" aria-expanded={panel === 'import'} onClick={() => { invalidate(); setPanel(panel === 'import' ? null : 'import'); }}>[+ IMPORT]</button><button type="button" aria-expanded={panel === 'projects'} onClick={openProjects}>[PROJECTS]</button></div>
      {snapshot && <div className="ws-version-controls">
        <label htmlFor="source-version">Source version</label>
        <select id="source-version" value={source.id} onChange={event => onOpenProject(snapshot.project.id, event.target.value)}>{snapshot.versions.map(version => <option key={version.id} value={version.id}>V{version.version} · {version.shiftCount} shifts{version.id === snapshot.project.headSourceId ? ' · current' : ' · history'}</option>)}</select>
        <small title={source.contentHash ?? ''}>SHA-256 · {source.contentHash?.slice(0, 16)}…</small>
        {source.id !== snapshot.project.headSourceId && <button type="button" className="ws-text-button" onClick={() => onOpenProject(snapshot.project.id)}>Open current version ↗</button>}
        <details className="ws-originals"><summary>Original files · {source.originalFiles?.length}</summary>{source.originalFiles?.map(file => <a key={file.id} href={originalFileUrl(snapshot.project.id, source.id, file.id)} download><span>{file.filename} ↓</span><small>{file.size.toLocaleString('en-US')} bytes · {file.sha256.slice(0, 12)}…</small></a>)}</details>
      </div>}
      {panel === 'projects' && <div className="ws-import-panel"><h3>Saved projects</h3>{!busy && !error && projects.length === 0 && <p className="ws-note">No projects yet. Start by importing files.</p>}{projects.map(project => <button type="button" className="ws-saved-project" key={project.id} onClick={() => { if (project.headSourceId) onOpenProject(project.id); else { invalidate(); setTarget(project); setPanel('import'); } }}><strong>{project.name} ↗</strong><small>{project.sourceCount ? `${project.sourceCount} source versions` : 'Import first source'}</small></button>)}</div>}
      {panel === 'import' && <form className="ws-import-panel" onSubmit={event => { event.preventDefault(); upload(); }}>
        <h3>{target ? 'New source version' : 'Create project from files'}</h3>
        {target && <p className="ws-note">Project: {target.name}. The current source is preserved until the import is confirmed.</p>}
        {!target && <><label className="ws-field-label" htmlFor="import-project-name">Project name</label><input id="import-project-name" required maxLength={120} value={projectName} onChange={event => { invalidate(); setProjectName(event.target.value); }} /></>}
        <label className="ws-field-label" htmlFor="import-team">Team name</label><input id="import-team" required maxLength={120} value={teamName} onChange={event => { invalidate(); setTeamName(event.target.value); }} />
        <div className="ws-import-metadata"><div><label className="ws-field-label" htmlFor="import-timezone">IANA time zone</label><input id="import-timezone" required value={timezone} onChange={event => { invalidate(); setTimezone(event.target.value); }} /></div><div><label className="ws-field-label" htmlFor="import-currency">Currency</label><select id="import-currency" value={currency} onChange={event => { invalidate(); setCurrency(event.target.value); }}>{['USD', 'RUB', 'EUR', 'UYU', 'ARS', 'BRL', 'GBP'].map(value => <option key={value}>{value}</option>)}</select></div></div>
        <div className="ws-segmented ws-import-format" aria-label="Import format"><button type="button" aria-pressed={format === 'csv'} onClick={() => { invalidate(); setFormat('csv'); setFiles({}); }}>CSV</button><button type="button" aria-pressed={format === 'xlsx'} onClick={() => { invalidate(); setFormat('xlsx'); setFiles({}); }}>XLSX</button></div>
        {(format === 'xlsx' ? [['workbook', 'XLSX workbook', true]] as const : [['schedule', 'Schedule CSV', true], ['employees', 'Employees CSV', true], ['availability', 'Availability CSV', false]] as const).map(([kind, label, required]) => <div key={`${format}-${kind}`}><label className="ws-field-label" htmlFor={`file-${kind}`}>{label}{!required && ' · optional'}</label><input id={`file-${kind}`} type="file" required={required} accept={format === 'xlsx' ? '.xlsx' : '.csv,text/csv'} onChange={event => { invalidate(); const file = event.target.files?.[0]; setFiles(current => { const next = { ...current }; if (file) next[kind] = file; else delete next[kind]; return next; }); }} /></div>)}
        <p className="ws-note">Up to 5 MB per file. Rates use minor currency units (such as cents); limits use minutes. Without an availability file, availability remains unknown.</p>
        <button type="button" className="ws-text-button" disabled={templateBusy} onClick={() => void downloadTemplate()}>{templateBusy ? 'Retrieving template…' : `Download ${format.toUpperCase()} template ↓`}</button>
        {templateError && <div className="ws-notice" role="alert"><p>{templateError}</p></div>}
        <button type="submit" className="ws-outline" disabled={!ready || busy}>Check files <span aria-hidden="true">→</span></button>
        {preview && <div className="ws-import-preview" ref={previewRef} aria-label="Import preview" aria-live="polite">
          <h4>{preview.canConfirm ? 'Data ready for confirmation' : 'Fix errors in the files'}</h4>
          <p className="ws-note">Rows read: {Object.entries(preview.rowCounts).map(([name, count]) => `${name}: ${count}`).join(' · ')}. The source version has not changed yet.</p>
          {target?.headSourceId && <p className="ws-note">The new source will have a separate constraint version. The previous task and constraints remain in the earlier source’s history.</p>}
          {preview.preview && <p>{preview.preview.employees.length} employees · {preview.preview.shifts.length} shifts · {preview.preview.shifts.reduce((minutes, shift) => minutes + durationMinutes(shift), 0) / 60} h</p>}
          {preview.issues.length > 0 && <ul className="ws-import-issues">{preview.issues.map((issue, index) => <li key={index} data-severity={issue.severity}><strong>{issue.severity === 'error' ? 'Error' : 'Unknown / warning'}{issue.filename ? ` · ${issue.filename}` : ''}{issue.sheet ? ` / ${issue.sheet}` : ''}{issue.row ? ` · row ${issue.row}` : ''}{issue.column ? ` · ${issue.column}` : ''}</strong><span>{issue.message}</span></li>)}</ul>}
          <details><summary>Parsed rows</summary>{preview.previewRows.filter(row => 'shift_id' in row.values && 'starts_at' in row.values).map(row => <div className="ws-preview-row" key={`${row.filename}-${row.row}`}><small>Row {row.row}</small><span>{row.values.shift_id} · {row.values.starts_at}</span><span>{row.values.employee_id} · {row.values.role}</span></div>)}</details>
          <button type="button" className="ws-primary" disabled={!preview.canConfirm || busy} onClick={confirm}>Confirm and create version <span aria-hidden="true">→</span></button>
        </div>}
      </form>}
      {busy && <p className="ws-transfer-status" role="status">{preview ? 'Saving version…' : 'Processing request…'}</p>}
      {error && <div className="ws-notice" role="alert"><p>{error}</p>{conflict && target && <button type="button" className="ws-text-button" onClick={() => onOpenProject(target.id)}>Refresh project ↗</button>}{panel === 'projects' && <button type="button" className="ws-text-button" onClick={() => void run(async (signal, active) => { const result = await workspaceClient.listProjects(signal); if (active()) setProjects(result); })}>Reconnect ↺</button>}</div>}
    </div>
  );
}
