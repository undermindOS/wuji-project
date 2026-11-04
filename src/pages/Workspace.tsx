import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import BrandMark from '../components/BrandMark';
import ScanlineOverlay from '../components/ScanlineOverlay';
import { workspaceClient } from '../features/workspace/api/WorkspaceClient.ts';
import { useProjectRuns } from '../features/workspace/api/useProjectRuns';
import RunControls from '../features/workspace/components/RunControls';
import IntentControls from '../features/workspace/components/IntentControls';
import { useIntentDraft } from '../features/workspace/api/useIntentDraft';
import { useScenarioReview } from '../features/workspace/api/useScenarioReview';
import { ScenarioApprovalControls, ScenarioVersionControls } from '../features/workspace/components/ScenarioReviewControls';
import PaneDivider from '../features/workspace/components/PaneDivider';
import type { PanelWidths } from '../features/workspace/components/PaneDivider';
import ScenarioPane from '../features/workspace/components/ScenarioPane';
import SourcePane from '../features/workspace/components/SourcePane';
import SourceControls from '../features/workspace/components/SourceControls';
import TaskPane from '../features/workspace/components/TaskPane';
import { checkSchedule, getMetrics } from '../features/workspace/model/schedule.ts';
import type { Absence, ExampleId, PaneId, WorkspaceData, WorkspaceSnapshot } from '../features/workspace/model/types.ts';
import '../features/workspace/workspace.css';

const panes: { id: PaneId; number: string; label: string }[] = [
  { id: 'source', number: '01', label: 'Исходник' },
  { id: 'task', number: '02', label: 'Задача' },
  { id: 'scenario', number: '03', label: 'Результат' },
];

export default function Workspace() {
  const [searchParams, setSearchParams] = useSearchParams();
  const projectId = searchParams.get('project');
  const sourceParam = searchParams.get('source');
  const taskParam = searchParams.get('task');
  const [exampleId, setExampleId] = useState<ExampleId>('absence');
  const [reload, setReload] = useState(0);
  const [example, setExample] = useState<WorkspaceData | null>(null);
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scenarioId, setScenarioId] = useState('');
  const [selectedShiftId, setSelectedShiftId] = useState<string | null>(null);
  const [selectionSequence, setSelectionSequence] = useState(0);
  const [draft, setDraft] = useState('');
  const [absenceDraft, setAbsenceDraft] = useState<Absence | null>(null);
  const [fixedDraft, setFixedDraft] = useState<Record<string, string>>({});
  const [objectiveDraft, setObjectiveDraft] = useState<'compare' | 'min_changes' | 'min_cost'>('compare');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const saveController = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const [activePane, setActivePane] = useState<PaneId>('source');
  const [widths, setWidths] = useState<PanelWidths>([35, 30, 35]);
  const resultHeading = useRef<HTMLElement>(null);
  const contextSnapshot = snapshot && snapshot.project.id === projectId && (!sourceParam || sourceParam === snapshot.source.id)
    && (!taskParam || taskParam === snapshot.task.id) ? snapshot : null;
  const projectRuns = useProjectRuns(contextSnapshot);
  const intent = useIntentDraft(contextSnapshot, draft);

  useEffect(() => {
    const previousTitle = document.title;
    const previousLanguage = document.documentElement.lang;
    document.title = 'WUJI — Decision Workspace';
    document.documentElement.lang = 'ru';
    window.scrollTo(0, 0);
    return () => { document.title = previousTitle; document.documentElement.lang = previousLanguage; };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    generation.current += 1; saveController.current?.abort();
    setExample(null); setSnapshot(null); setError(null); setSaveError(null); setSaving(false);
    const load = async () => {
      let saved: WorkspaceSnapshot | null = null;
      let data: WorkspaceData;
      if (projectId) {
        saved = await workspaceClient.getWorkspace(projectId, { sourceId: sourceParam ?? undefined, taskId: taskParam ?? undefined, signal: controller.signal });
        data = { id: saved.source.id, label: saved.project.name, source: saved.source, task: saved.task, scenarios: [saved.baseline], conflict: null };
      } else data = await workspaceClient.loadExample(exampleId, controller.signal);
      if (controller.signal.aborted) return;
      setSnapshot(saved); setExample(data);
      setScenarioId(data.scenarios[0]?.id ?? '');
      setSelectedShiftId(data.task.absence?.shiftIds[0] ?? data.source.shifts[0]?.id ?? null);
      setSelectionSequence(0); setDraft(data.task.request);
      setAbsenceDraft(data.task.absence ? { ...data.task.absence, shiftIds: [...data.task.absence.shiftIds] } : null);
      setFixedDraft(data.task.fixedAssignments ?? {});
      setObjectiveDraft(data.task.objective ?? 'compare');
    };
    void load().catch(value => { if (!controller.signal.aborted) setError(value instanceof Error ? value.message : 'Не удалось открыть данные.'); });
    return () => { controller.abort(); saveController.current?.abort(); generation.current += 1; };
  }, [exampleId, reload, projectId, sourceParam, taskParam]);

  const calculatedScenarios = projectRuns.run?.result?.scenarios ?? [];
  const displayExample = example && calculatedScenarios.length ? { ...example, scenarios: calculatedScenarios.map(item => item.scenario) } : example;
  const baseScenario = displayExample?.scenarios.find(item => item.id === scenarioId) ?? displayExample?.scenarios[0] ?? null;
  const baseCalculated = calculatedScenarios.find(item => item.scenario.id === baseScenario?.id) ?? null;
  const review = useScenarioReview(contextSnapshot,projectRuns.run,baseCalculated?.scenario.id??null);
  const candidate=review.candidate;
  const scenario = candidate?.scenario ?? baseScenario;
  const manualVersion=candidate?.origin==='manual'?candidate:null;
  const unverified=!!manualVersion&&!manualVersion.validation;
  useEffect(()=>{
    if(calculatedScenarios.some(item=>item.scenario.id===scenarioId))return;
    const approved=review.approvals.find(item=>item.isCurrent&&item.isSelected&&item.runId===projectRuns.run?.id);
    const restored=review.review?.candidates.find(item=>item.id===approved?.scenarioId);
    if(restored)setScenarioId(restored.baseScenarioId);
  },[review.review,review.approvals,scenarioId,projectRuns.run?.id]);
  const calculated=candidate?.validation&&candidate.metrics ? {scenario:candidate.scenario,validation:candidate.validation,
    metrics:candidate.metrics,evidence:candidate.evidence,searchStatus:candidate.searchStatus??undefined} : manualVersion?null:baseCalculated;
  const metrics = calculated?.metrics ?? (example && scenario ? getMetrics(example.source, scenario) : null);
  const checks = unverified?[]:calculated?.validation.checks ?? (example && scenario ? checkSchedule(example.source, example.task, scenario) : []);
  const manualEdited = !!example && (JSON.stringify(absenceDraft) !== JSON.stringify(example.task.absence)
    || JSON.stringify(Object.entries(fixedDraft).sort()) !== JSON.stringify(Object.entries(example.task.fixedAssignments ?? {}).sort())
    || objectiveDraft !== (example.task.objective ?? 'compare'));
  const dirty = !!example && (draft !== example.task.request || manualEdited);
  const openProject = (id: string, sourceId?: string, taskId?: string) => {
    const next = new URLSearchParams({ project: id });
    if (sourceId) next.set('source', sourceId);
    if (taskId) next.set('task', taskId);
    setSearchParams(next); setReload(value => value + 1); setActivePane('source');
  };
  const saveConditions = async () => {
    if (!snapshot) return;
    saveController.current?.abort();
    const controller = new AbortController(); saveController.current = controller;
    const current = ++generation.current;
    setSaving(true); setSaveError(null);
    try {
      const task = await workspaceClient.saveTask(snapshot.project.id, { expectedSourceVersionId: snapshot.source.id, expectedTaskId: snapshot.task.id, request: draft, absence: absenceDraft, fixedAssignments: fixedDraft, objective: objectiveDraft }, controller.signal);
      if (!controller.signal.aborted && generation.current === current) { openProject(snapshot.project.id, snapshot.source.id, task.id); setActivePane('task'); }
    } catch (value) { if (!controller.signal.aborted && generation.current === current) setSaveError(value instanceof Error ? value.message : 'Не удалось сохранить условия.'); }
    finally { if (generation.current === current) setSaving(false); }
  };
  const selectShift = (id: string) => {
    setSelectedShiftId(id); setSelectionSequence(value => value + 1); setActivePane('task');
  };
  const selectScenario = (id: string) => {
    const next = displayExample?.scenarios.find(item => item.id === id);
    if (!example || !next) return;
    setScenarioId(id);
    review.select(id);
    setSelectedShiftId(getMetrics(example.source, next).changes[0]?.shiftId ?? example.source.shifts[0]?.id ?? null);
    setSelectionSequence(value => value + 1);
  };
  const reset = () => {
    setSearchParams({}); setExampleId('absence'); setReload(value => value + 1); setActivePane('source'); setWidths([35, 30, 35]);
  };
  const showResults = () => {
    setActivePane('scenario');
    requestAnimationFrame(() => resultHeading.current?.focus({ preventScroll: true }));
  };
  const period = example ? (() => {
    const dates = example.source.shifts.map(shift => new Date(shift.startsAt)).sort((a, b) => a.getTime() - b.getTime());
    const formatter = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short', timeZone: example.source.timezone });
    const year = new Intl.DateTimeFormat('ru-RU', { year: 'numeric', timeZone: example.source.timezone });
    return dates.length ? `${formatter.format(dates[0])}${year.format(dates[0]) !== year.format(dates[dates.length - 1]) ? ` ${year.format(dates[0])}` : ''} — ${formatter.format(dates[dates.length - 1])} ${year.format(dates[dates.length - 1])}` : '—';
  })() : '—';

  return (
    <div className="workspace">
      <ScanlineOverlay />
      <a className="ws-skip" href="#workspace-task" onClick={() => setActivePane('task')}>К задаче</a>
      <header className="ws-header">
        <Link to="/" aria-label="WUJI — на главную" className="ws-brand"><BrandMark /></Link>
        <span className="ws-header-label">DECISION_WORKSPACE <span aria-hidden="true">/</span> 001</span>
        <div className="ws-header-actions"><span className="ws-demo-badge">{projectId ? 'ПРОЕКТ' : 'ДЕМО'}</span><Link to="/" className="ws-home-link">НА ГЛАВНУЮ ↗</Link></div>
      </header>
      <div className="ws-project-heading">
        <div><p className="ws-kicker"><span className="ws-green">WU</span><span className="ws-red">JI</span> // {example?.source.teamName ?? 'РАБОЧЕЕ ПРОСТРАНСТВО'}</p><h1 className="font-display">REWRITE THE WEEK<span className="ws-orange">_</span></h1><p className="ws-project-subtitle">Исходник. Условия. Последствия. Всё перед глазами.</p></div>
        <div className="ws-project-meta"><div><span>НЕДЕЛЯ</span><strong>{period}</strong></div><div className="ws-timezone-meta"><span>ЧАСОВОЙ ПОЯС</span><strong>{example?.source.timezone ?? '—'}</strong></div><button type="button" className="ws-reset" onClick={reset}>{projectId ? 'ДЕМО ↺' : 'ЗАНОВО ↺'}</button></div>
      </div>
      <nav className="ws-mobile-tabs" aria-label="Области рабочего пространства">{panes.map(pane => <button type="button" key={pane.id} onClick={() => setActivePane(pane.id)} aria-pressed={activePane === pane.id} aria-controls={`workspace-${pane.id}`}><span>{pane.number}</span> {pane.label}</button>)}</nav>
      {error ? <main className="ws-loading" role="alert"><h2>Не удалось открыть {projectId ? 'проект' : 'пример'}</h2><p className="ws-note">{error}</p><button type="button" className="ws-outline" onClick={() => setReload(value => value + 1)}>Повторить</button><button type="button" className="ws-text-button" onClick={reset}>Открыть демо</button></main> : !example ? <main className="ws-loading" role="status">Открываем {projectId ? 'сохранённые данные' : 'пример'}…</main> : (
        <main className="ws-panels" style={{ gridTemplateColumns: `${widths[0]}fr 9px ${widths[1]}fr 9px ${widths[2]}fr` }} aria-label="Рабочее пространство сценария">
          <section id="workspace-source" className="ws-pane ws-source-pane" aria-labelledby="source-heading" data-active={activePane === 'source'}>
            <SourcePane key={example.id} source={example.source} task={example.task} selectedShiftId={selectedShiftId} selectionSequence={selectionSequence} onSelect={selectShift}><SourceControls source={example.source} snapshot={snapshot} onOpenProject={openProject} /></SourcePane>
          </section>
          <PaneDivider index={0} widths={widths} setWidths={setWidths} />
          <section id="workspace-task" className="ws-pane ws-task-pane" aria-labelledby="task-heading" data-active={activePane === 'task'} tabIndex={-1}>
            <TaskPane key={example.task.id} example={displayExample!} scenario={scenario} checks={checks} selectedShiftId={selectedShiftId} selectionSequence={selectionSequence} draft={draft} onDraftChange={setDraft} onExampleChange={setExampleId} onShowResults={showResults} onOpenSource={() => { setActivePane('source'); setSelectionSequence(value => value + 1); }} snapshot={snapshot} absenceDraft={absenceDraft} onAbsenceChange={setAbsenceDraft} fixedDraft={fixedDraft} onFixedChange={setFixedDraft} objectiveDraft={objectiveDraft} onObjectiveChange={setObjectiveDraft} inputDisabled={intent.busy === 'confirm'||review.busy==='approve'} intentControls={contextSnapshot && <IntentControls state={intent} snapshot={contextSnapshot} request={draft} manualEdited={manualEdited} onRequestChange={setDraft} onConfirmed={task => { openProject(contextSnapshot.project.id, contextSnapshot.source.id, task.id); setActivePane('task'); }} />} onSaveTask={() => void saveConditions()} onTaskVersionSelect={id => { if (snapshot) { openProject(snapshot.project.id, snapshot.source.id, id); setActivePane('task'); } }} saving={saving} saveError={saveError} run={projectRuns.run} evaluation={calculated} runControls={snapshot && <RunControls state={projectRuns} disabled={dirty || saving || !!review.busy || intent.busy === 'confirm' || snapshot.source.id !== snapshot.project.headSourceId || snapshot.task.id !== snapshot.project.headTaskId} onShowResults={showResults} />} />
          </section>
          <PaneDivider index={1} widths={widths} setWidths={setWidths} />
          <section id="workspace-scenario" className="ws-pane ws-scenario-pane" aria-labelledby="scenario-heading" data-active={activePane === 'scenario'} tabIndex={-1} ref={resultHeading}>
            <ScenarioPane example={displayExample!} scenario={scenario} metrics={metrics} checks={checks} selectedShiftId={selectedShiftId} requestEdited={dirty||review.editorDirty} onScenarioSelect={selectScenario} onShiftSelect={selectShift} onReviewConflict={() => selectShift(example.conflict!.shiftId)} snapshot={snapshot} run={projectRuns.run} calculated={calculated} manualVersion={manualVersion} baseScenarioId={baseScenario?.id} reviewBusy={!!review.busy} versionControls={contextSnapshot&&<ScenarioVersionControls state={review} snapshot={contextSnapshot} requestEdited={dirty}/>} approvalControls={contextSnapshot&&<ScenarioApprovalControls state={review} snapshot={contextSnapshot} requestEdited={dirty}/>} fixing={projectRuns.busy} actionError={projectRuns.error} onFixAssignments={ids => { if (snapshot && baseCalculated&&!manualVersion) void projectRuns.fix(baseCalculated.scenario.id, ids, result => { openProject(snapshot.project.id, snapshot.source.id, result.task.id); setActivePane('scenario'); }); }} />
          </section>
        </main>
      )}
      <footer className="ws-statusbar"><span><span className="ws-status-dot" aria-hidden="true" /> {projectId ? 'ИСХОДНИК В ПРОЕКТЕ' : 'СИНТЕТИЧЕСКИЕ ДАННЫЕ'} <span className="ws-footer-divider">/</span> <span className="ws-ai-status">{!projectId ? 'ГОТОВЫЕ ПРИМЕРЫ' : intent.configuration?.providerMode === 'test' || example?.task.interpretation?.providerMode === 'test' ? 'ИИ: КОНТРОЛЬНЫЙ ОТВЕТ' : intent.job?.status === 'failed' ? 'OPENAI / ОШИБКА РАЗБОРА' : example?.task.interpretation ? 'УСЛОВИЯ ИИ ПОДТВЕРЖДЕНЫ' : intent.configuration?.configured ? 'OPENAI / НАСТРОЕН' : 'ИИ НЕ НАСТРОЕН'}</span></span><span>НИЧЕГО НЕ ОПУБЛИКОВАНО <span aria-hidden="true">↗</span></span></footer>
    </div>
  );
}
