import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import BrandMark from '../components/BrandMark';
import ScanlineOverlay from '../components/ScanlineOverlay';
import PaneDivider from '../features/workspace/components/PaneDivider';
import type { PanelWidths } from '../features/workspace/components/PaneDivider';
import SchedulePane from '../features/csr/components/SchedulePane';
import TeamPane from '../features/csr/components/TeamPane';
import WeekPane from '../features/csr/components/WeekPane';
import { addOperator, applyBuild, openWeek, removeOperator, setRequest, setTarget, updateOperator } from '../features/csr/model/actions.ts';
import type { BuildResult } from '../features/csr/model/build.ts';
import { checkWeek, dayCounts, workloads } from '../features/csr/model/check.ts';
import { defaultState, weekInput } from '../features/csr/model/defaults.ts';
import { toCsv, toHtml, toTsv } from '../features/csr/model/export.ts';
import { STORAGE_KEY, parseState, serializeState } from '../features/csr/model/storage.ts';
import { dateLabel, weekDates } from '../features/csr/model/time.ts';
import type { CellRef, CsrState, WeekInput } from '../features/csr/model/types.ts';
import { useBuild } from '../features/csr/solver/useBuild.ts';
import '../features/workspace/workspace.css';
import '../features/csr/csr.css';

type PaneId = 'team' | 'week' | 'schedule';
type Notice = { tone: 'ok' | 'error'; text: string } | null;
const panes: { id: PaneId; number: string; label: string }[] = [
  { id: 'team', number: '01', label: 'Team' },
  { id: 'week', number: '02', label: 'Week' },
  { id: 'schedule', number: '03', label: 'Schedule' },
];
const WIDTHS: PanelWidths = [26, 24, 50];

// Saved data that cannot be read is set aside under a second key, never overwritten or dropped.
function loadState(): { state: CsrState; notice: Notice } {
  try {
    const text = window.localStorage.getItem(STORAGE_KEY);
    if (text === null) return { state: defaultState(), notice: null };
    const parsed = parseState(text);
    if ('state' in parsed) return { state: parsed.state, notice: null };
    window.localStorage.setItem(`${STORAGE_KEY}.unreadable`, text);
    return { state: defaultState(), notice: { tone: 'error', text: `The data saved in this browser could not be read (${parsed.error}) It was set aside, and the team’s sample week was opened instead.` } };
  } catch {
    return { state: defaultState(), notice: { tone: 'error', text: 'This browser does not allow saving here. Changes will be lost when the page closes; use “Save to file”.' } };
  }
}

function download(filename: string, type: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url; link.download = filename;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function CsrWorkspace() {
  const [initial] = useState(loadState);
  const [state, setState] = useState<CsrState>(initial.state);
  const [notice, setNotice] = useState<Notice>(initial.notice);
  const [saved, setSaved] = useState(true);
  const [selected, setSelected] = useState<CellRef | null>(null);
  const [focusCheckId, setFocusCheckId] = useState<string | null>(null);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [activePane, setActivePane] = useState<PaneId>('schedule');
  const [widths, setWidths] = useState<PanelWidths>(WIDTHS);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'WUJI — Operators Division schedule';
    window.scrollTo(0, 0);
    return () => { document.title = previousTitle; };
  }, []);
  useEffect(() => {
    try { window.localStorage.setItem(STORAGE_KEY, serializeState(state)); setSaved(true); } catch { setSaved(false); }
  }, [state]);

  const week = state.weeks[state.weekStart];
  const input = useMemo(() => weekInput(state), [state]);
  const checks = useMemo(() => week.plan ? checkWeek(input, week.plan) : [], [input, week.plan]);
  const loads = useMemo(() => workloads(input, week.plan ?? {}), [input, week.plan]);
  const counts = useMemo(() => dayCounts(week.plan ?? {}, state.operators), [week.plan, state.operators]);
  const dates = weekDates(state.weekStart);
  const change = (next: (current: CsrState) => CsrState) => { setState(next); setExportNotice(null); };
  const onResult = useCallback((builtFrom: WeekInput, result: BuildResult) => {
    setState(current => applyBuild(current, builtFrom.weekStart, result, builtFrom));
    setFocusCheckId(null); setActivePane('schedule');
  }, []);
  const build = useBuild(onResult);

  const exportFile = () => {
    download(`wuji-operators-${state.weekStart}.json`, 'application/json', serializeState(state));
    setNotice({ tone: 'ok', text: 'Saved the team and every week to a file. A colleague opens it with “Load from file”.' });
  };
  const importFile = async (file: File) => {
    if (file.size > 5_000_000) return setNotice({ tone: 'error', text: 'That file is larger than 5 MB and was not opened.' });
    const parsed = parseState(await file.text());
    if ('error' in parsed) return setNotice({ tone: 'error', text: `${parsed.error} Nothing was changed.` });
    build.cancel(); setState(parsed.state); setSelected(null); setFocusCheckId(null);
    setNotice({ tone: 'ok', text: `Loaded ${parsed.state.operators.length} operators and ${Object.keys(parsed.state.weeks).length} week(s) from ${file.name}.` });
  };
  const copy = async () => {
    if (!week.plan) return;
    const html = toHtml(state.weekStart, state.operators, week.plan), text = toTsv(state.weekStart, state.operators, week.plan);
    const done = () => setExportNotice('Copied. Select the top-left cell in the sheet and paste.');
    try {
      if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) throw new Error('no async clipboard');
      await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })]);
      done();
    } catch {
      // Where the async clipboard is not allowed, copy a rendered copy of the table the old way.
      const holder = document.createElement('div');
      holder.innerHTML = html;
      holder.style.cssText = 'position:fixed;left:-9999px;top:0;color:#000;background:#fff';
      document.body.appendChild(holder);
      const selection = window.getSelection(), range = document.createRange();
      range.selectNodeContents(holder); selection?.removeAllRanges(); selection?.addRange(range);
      let copied = false;
      try { copied = document.execCommand('copy'); } catch { copied = false; }
      selection?.removeAllRanges(); holder.remove();
      if (copied) done(); else setExportNotice('The browser refused to copy. Use the CSV file instead.');
    }
  };
  const reset = () => {
    build.cancel(); setState(defaultState()); setSelected(null); setFocusCheckId(null); setConfirmReset(false); setWidths(WIDTHS);
    setNotice({ tone: 'ok', text: 'Back to the team’s sample week and default settings.' });
  };

  return (
    <div className="workspace csr">
      <ScanlineOverlay />
      <a className="ws-skip" href="#workspace-schedule" onClick={() => setActivePane('schedule')}>Skip to schedule</a>
      <header className="ws-header">
        <Link to="/" aria-label="WUJI — home" className="ws-brand"><BrandMark /></Link>
        <span className="ws-header-label">SCHEDULE_BUILDER <span aria-hidden="true">/</span> CSR</span>
        <div className="ws-header-actions"><span className="ws-demo-badge">OPERATORS</span><Link to="/" className="ws-home-link">HOME ↗</Link></div>
      </header>
      <div className="ws-project-heading">
        <div><p className="ws-kicker"><span className="ws-green">WU</span><span className="ws-red">JI</span> // OPERATORS DIVISION</p><h1 className="font-display">BUILD THE WEEK<span className="ws-orange">_</span></h1><p className="ws-project-subtitle">Team. Rules. A week that holds.</p></div>
        <div className="ws-project-meta">
          <div><span>WEEK</span><strong>{dateLabel(dates[0])} — {dateLabel(dates[6])}, {state.weekStart.slice(0, 4)}</strong></div>
          <div className="ws-timezone-meta"><span>DEPARTMENT TIME</span><strong>Pacific · 6 AM–8 PM</strong></div>
          {confirmReset
            ? <span className="csr-reset-confirm"><button type="button" className="ws-reset" onClick={reset}>ERASE AND RESET</button><button type="button" className="ws-reset" onClick={() => setConfirmReset(false)}>KEEP</button></span>
            : <button type="button" className="ws-reset" onClick={() => setConfirmReset(true)}>RESET ↺</button>}
        </div>
      </div>
      <nav className="ws-mobile-tabs" aria-label="Schedule builder panels">{panes.map(pane => <button type="button" key={pane.id} onClick={() => setActivePane(pane.id)} aria-pressed={activePane === pane.id} aria-controls={`workspace-${pane.id}`}><span>{pane.number}</span> {pane.label}</button>)}</nav>
      <main className="ws-panels" style={{ gridTemplateColumns: `${widths[0]}fr 9px ${widths[1]}fr 9px ${widths[2]}fr` }} aria-label="Schedule builder">
        <section id="workspace-team" className="ws-pane ws-source-pane" aria-labelledby="team-heading" data-active={activePane === 'team'}>
          <TeamPane operators={state.operators} weekStart={state.weekStart} notice={notice}
            onUpdate={(id, patch) => change(current => updateOperator(current, id, patch))} onAdd={() => change(addOperator)}
            onRemove={id => { if (selected?.operatorId === id) setSelected(null); change(current => removeOperator(current, id)); }}
            onExport={exportFile} onImport={file => void importFile(file)} />
        </section>
        <PaneDivider index={0} widths={widths} setWidths={setWidths} />
        <section id="workspace-week" className="ws-pane ws-task-pane" aria-labelledby="week-heading" data-active={activePane === 'week'} tabIndex={-1}>
          <WeekPane weekStart={state.weekStart} savedWeeks={Object.keys(state.weeks)} targets={week.targets} teamSize={state.operators.length} hasPlan={!!week.plan} planStatus={week.planStatus} checks={checks}
            focusCheckId={focusCheckId} building={build.busy} buildError={build.error}
            onOpenWeek={weekStart => { build.cancel(); setSelected(null); setFocusCheckId(null); change(current => openWeek(current, weekStart)); }}
            onTarget={(day, field, value) => change(current => setTarget(current, day, field, value))}
            onBuild={() => build.start(input)} onCancel={build.cancel}
            onFocusCheck={id => { setFocusCheckId(id); if (id) setActivePane('schedule'); }} />
        </section>
        <PaneDivider index={1} widths={widths} setWidths={setWidths} />
        <section id="workspace-schedule" className="ws-pane ws-scenario-pane" aria-labelledby="schedule-heading" data-active={activePane === 'schedule'} tabIndex={-1}>
          <SchedulePane input={input} plan={week.plan} planStatus={week.planStatus} checks={checks} loads={loads} counts={counts} selected={selected} focusCheckId={focusCheckId} exportNotice={exportNotice}
            onSelect={setSelected} onRequest={(operatorId, day, request) => change(current => setRequest(current, operatorId, day, request))} onClearFocus={() => setFocusCheckId(null)}
            onCopy={() => void copy()} onDownload={() => { if (week.plan) { download(`operators-schedule-${state.weekStart}.csv`, 'text/csv;charset=utf-8', toCsv(state.weekStart, state.operators, week.plan)); setExportNotice('The CSV was saved. In Google Sheets: File → Import.'); } }} />
        </section>
      </main>
      <footer className="ws-statusbar"><span><span className="ws-status-dot" aria-hidden="true" /> {saved ? 'SAVED IN THIS BROWSER' : 'NOT SAVED — USE “SAVE TO FILE”'} <span className="ws-footer-divider">/</span> <span>NO SERVER</span></span><span><Link to="/workspace/repair" className="csr-footer-link">SCHEDULE REPAIR DEMO ↗</Link></span></footer>
    </div>
  );
}
