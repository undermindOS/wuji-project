import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import BrandMark from '../components/BrandMark';
import ScanlineOverlay from '../components/ScanlineOverlay';
import { useSharedSync } from '../features/csr/api/useSharedSync.ts';
import type { SharedSync } from '../features/csr/api/useSharedSync.ts';
import { useWishes } from '../features/csr/api/useWishes.ts';
import Bell from '../features/csr/components/Bell';
import Guide from '../features/csr/components/Guide';
import RolloutPane from '../features/csr/components/RolloutPane';
import SaveHistory from '../features/csr/components/SaveHistory';
import SchedulePane from '../features/csr/components/SchedulePane';
import type { ClockMode } from '../features/csr/components/SchedulePane';
import TeamPane from '../features/csr/components/TeamPane';
import WeekPane from '../features/csr/components/WeekPane';
import WeekPicker from '../features/csr/components/WeekPicker';
import { copyTable } from '../features/csr/components/clipboard.ts';
import { schedulePdf } from '../features/csr/components/schedulePdf.ts';
import { addChannel, addOperator, applyBuild, clearWeek, openWeek, removeChannel, removeOperator, renameChannel, setChannelHolder, setDayRollout, setRequest, setTarget, updateOperator } from '../features/csr/model/actions.ts';
import type { BuildResult } from '../features/csr/model/build.ts';
import { checkWeek, dayCounts, workloads } from '../features/csr/model/check.ts';
import { defaultState, weekInput } from '../features/csr/model/defaults.ts';
import { toCsv, toHtml, toTsv } from '../features/csr/model/export.ts';
import { STORAGE_KEY, parseState, serializeState } from '../features/csr/model/storage.ts';
import type { CellRef, CsrState, WeekInput } from '../features/csr/model/types.ts';
import { whenLabel } from '../features/csr/model/wishes.ts';
import { useBuild } from '../features/csr/solver/useBuild.ts';
import '../features/workspace/workspace.css';
import '../features/csr/csr.css';

type View = 'team' | 'week' | 'schedule';
type Notice = { tone: 'ok' | 'error'; text: string } | null;
const GUIDE_KEY = 'wuji.csr.guide.v1';
const views: { id: View; number: string; label: string }[] = [
  { id: 'team', number: '01', label: 'Team' },
  { id: 'week', number: '02', label: 'Targets' },
  { id: 'schedule', number: '03', label: 'Schedule' },
];

// Saved data that cannot be read is set aside under a second key, never overwritten or dropped.
function loadState(): { state: CsrState; notice: Notice; hadLocalCopy: boolean } {
  try {
    const text = window.localStorage.getItem(STORAGE_KEY);
    if (text === null) return { state: defaultState(), notice: null, hadLocalCopy: false };
    const parsed = parseState(text);
    if ('state' in parsed) return { state: parsed.state, notice: null, hadLocalCopy: true };
    window.localStorage.setItem(`${STORAGE_KEY}.unreadable`, text);
    return { state: defaultState(), notice: { tone: 'error', text: `The data saved in this browser could not be read (${parsed.error}) It was set aside, and the team’s sample week was opened instead.` }, hadLocalCopy: false };
  } catch {
    return { state: defaultState(), notice: { tone: 'error', text: 'This browser does not allow saving here. Changes will be lost when the page closes; use “Save to file” under the team list.' }, hadLocalCopy: false };
  }
}

function guideSeen(): boolean {
  try { return window.localStorage.getItem(GUIDE_KEY) !== null; } catch { return false; }
}

function download(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = filename;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** One line under the toolbar: where the work is saved, what just happened to it, and what to do when two copies disagree. */
function SyncLine({ sync, autosaved, note }: { sync: SharedSync; autosaved: boolean; note: Notice }) {
  const [key, setKey] = useState('');
  const here = autosaved ? 'Autosaved in this browser.' : 'This browser cannot autosave; use “Save to file” under the team list.';
  const shared = sync.status === 'checking' ? 'Checking the copy saved for everyone…'
    : sync.status === 'not_connected' ? 'Shared storage is not connected yet, so “Save for everyone” is off.'
    : sync.status === 'unavailable' ? 'Shared storage cannot be reached right now.'
    : sync.status === 'locked' ? 'The copy saved for everyone is behind the team key.'
    : sync.revision === 0 ? 'Nothing has been saved for everyone yet.'
    : sync.dirty ? `You have changes that are not saved for everyone. Last shared save: ${whenLabel(sync.savedAt)}.`
    : `Same as the copy saved for everyone on ${whenLabel(sync.savedAt)}.`;
  return (
    <div className="csr-sync" data-tone={sync.incoming || sync.status === 'locked' ? 'warn' : sync.message?.tone === 'error' || note?.tone === 'error' ? 'error' : 'plain'}>
      {sync.incoming ? (
        <p role="alert"><strong>Someone saved a newer copy for everyone{sync.incoming.savedAt ? ` on ${whenLabel(sync.incoming.savedAt)}` : ''}, and you have changes of your own.</strong>{' '}
          <button type="button" className="ws-text-button" onClick={sync.loadIncoming}>Load theirs and drop mine</button>
          <button type="button" className="ws-text-button" onClick={() => sync.save(true)}>Save mine over theirs</button>
          <button type="button" className="ws-text-button" onClick={sync.keepMine}>Decide later</button></p>
      ) : (
        <p role="status">{here} {shared}{sync.message ? <b data-tone={sync.message.tone}> {sync.message.text}</b> : null}
          {sync.status === 'ready' && sync.protectedByKey && <button type="button" className="ws-text-button" onClick={sync.forgetKey}>Forget the team key here</button>}</p>
      )}
      {sync.status === 'locked' && !sync.incoming && (
        <form className="csr-unlock" onSubmit={event => { event.preventDefault(); sync.unlock(key); setKey(''); }}>
          <label htmlFor="csr-team-key">Team key</label>
          <input id="csr-team-key" type="password" autoComplete="current-password" value={key} onChange={event => setKey(event.target.value)} />
          <button type="submit" className="ws-outline" disabled={!key.trim()}>Unlock</button>
          <span>Ask the scheduler for it. It is remembered in this browser.</span>
        </form>
      )}
      {note && <p role="status"><b data-tone={note.tone}>{note.text}</b></p>}
    </div>
  );
}

export default function CsrWorkspace() {
  const [initial] = useState(loadState);
  const [state, setState] = useState<CsrState>(initial.state);
  const [notice, setNotice] = useState<Notice>(initial.notice);
  const [saved, setSaved] = useState(true);
  const [selected, setSelected] = useState<CellRef | null>(null);
  const [focusCheckId, setFocusCheckId] = useState<string | null>(null);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [clockMode, setClockMode] = useState<ClockMode>('department');
  const [setupView, setSetupView] = useState<'team' | 'week'>('team');
  const [mobileView, setMobileView] = useState<View>('schedule');
  const [guideOpen, setGuideOpen] = useState(() => !guideSeen());
  const [bellOpen, setBellOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'WUJI — Operators Division schedule';
    window.scrollTo(0, 0);
    return () => { document.title = previousTitle; };
  }, []);
  // A note about a file or a reset is news for a moment; a note about trouble stays.
  useEffect(() => {
    if (!notice || notice.tone === 'error') return;
    const timer = window.setTimeout(() => setNotice(null), 8000);
    return () => window.clearTimeout(timer);
  }, [notice]);
  // Autosave: every change is written to this browser at once.
  useEffect(() => {
    try { window.localStorage.setItem(STORAGE_KEY, serializeState(state)); setSaved(true); } catch { setSaved(false); }
  }, [state]);

  const week = state.weeks[state.weekStart];
  const input = useMemo(() => weekInput(state), [state]);
  const checks = useMemo(() => week.plan ? checkWeek(input, week.plan) : [], [input, week.plan]);
  const loads = useMemo(() => workloads(input, week.plan ?? {}), [input, week.plan]);
  const counts = useMemo(() => dayCounts(week.plan ?? {}, state.operators), [week.plan, state.operators]);
  const builtWeeks = useMemo(() => Object.entries(state.weeks).filter(([, item]) => item.plan).map(([start]) => start), [state.weeks]);
  const change = (next: (current: CsrState) => CsrState) => { setState(next); setExportNotice(null); };
  const onResult = useCallback((builtFrom: WeekInput, result: BuildResult) => {
    setState(current => applyBuild(current, builtFrom.weekStart, result, builtFrom));
    setFocusCheckId(null); setMobileView('schedule');
  }, []);
  const build = useBuild(onResult);
  const cancelBuild = build.cancel;
  // A copy loaded from shared storage replaces this browser's copy as a whole.
  const adopt = useCallback((next: CsrState) => { cancelBuild(); setState(next); setSelected(null); setFocusCheckId(null); setExportNotice(null); }, [cancelBuild]);
  const sync = useSharedSync(state, adopt, initial.hadLocalCopy);
  const wishes = useWishes(sync.status === 'ready', sync.status === 'locked');
  const closeGuide = useCallback(() => {
    setGuideOpen(false);
    try { window.localStorage.setItem(GUIDE_KEY, 'seen'); } catch { /* the guide simply opens again next time */ }
  }, []);

  const closeHistory = useCallback(() => setHistoryOpen(false), []);

  const showSetup = (view: 'team' | 'week') => { setSetupView(view); setMobileView(view); };
  const openWeekAt = (weekStart: string) => { build.cancel(); setSelected(null); setFocusCheckId(null); change(current => openWeek(current, weekStart)); };
  const exportFile = () => {
    download(`operators-team-and-weeks-${state.weekStart}.json`, new Blob([serializeState(state)], { type: 'application/json' }));
    setNotice({ tone: 'ok', text: 'Saved the team and every week to a file. A colleague opens it with “Load from file”.' });
  };
  const importFile = async (file: File) => {
    if (file.size > 5_000_000) return setNotice({ tone: 'error', text: 'That file is larger than 5 MB and was not opened.' });
    const parsed = parseState(await file.text());
    if ('error' in parsed) return setNotice({ tone: 'error', text: `${parsed.error} Nothing was changed.` });
    build.cancel(); setState(parsed.state); setSelected(null); setFocusCheckId(null);
    setNotice({ tone: 'ok', text: `Loaded ${parsed.state.operators.length} operators and ${Object.keys(parsed.state.weeks).length} week(s) from ${file.name}.` });
  };
  const pdf = async () => {
    if (!week.plan || exportingPdf) return;
    setExportingPdf(true); setExportNotice(null);
    try {
      download(`operators-schedule-${state.weekStart}.pdf`, await schedulePdf(input, week.plan, clockMode));
      setExportNotice(`The PDF was saved with ${clockMode === 'local' ? 'each operator’s local hours' : 'Pacific hours'}. It is ready to drop into a chat.`);
    } catch (error) {
      setExportNotice(`The PDF could not be made: ${error instanceof Error ? error.message : 'unknown error'}`);
    } finally { setExportingPdf(false); }
  };
  const copy = async () => {
    if (!week.plan) return;
    const copied = await copyTable(toHtml(state.weekStart, state.operators, week.plan), toTsv(state.weekStart, state.operators, week.plan));
    setExportNotice(copied ? 'Copied in the team sheet’s own layout. Select the top-left cell in the sheet and paste.' : 'The browser refused to copy. Use the CSV file instead.');
  };
  const reset = () => {
    build.cancel(); setState(defaultState()); setSelected(null); setFocusCheckId(null); setConfirmReset(false);
    setNotice({ tone: 'ok', text: 'This browser is back to the team’s sample week and default settings. The copy saved for everyone was not touched.' });
  };

  return (
    <div className="workspace csr">
      <ScanlineOverlay />
      <a className="ws-skip" href="#workspace-schedule" onClick={() => setMobileView('schedule')}>Skip to schedule</a>
      <header className="ws-header">
        <Link to="/" aria-label="WUJI — home" className="ws-brand"><BrandMark /></Link>
        <span className="ws-header-label">SCHEDULE BUILDER <span aria-hidden="true">/</span> OPERATORS</span>
        <div className="ws-header-actions"><Bell wishes={wishes} operators={state.operators} weekStart={state.weekStart} locked={sync.status === 'locked'} open={bellOpen} onToggle={setBellOpen} /><Link to="/" className="ws-home-link">HOME ↗</Link></div>
      </header>
      <div className="csr-top">
        <div className="csr-title"><p className="ws-kicker"><span className="ws-green">WU</span><span className="ws-red">JI</span> // OPERATORS DIVISION</p><h1 className="font-display">BUILD THE WEEK<span className="ws-orange">_</span></h1></div>
        <div className="csr-toolbar">
          <WeekPicker weekStart={state.weekStart} builtWeeks={builtWeeks} onOpenWeek={openWeekAt} />
          {build.busy
            ? <button type="button" className="ws-outline csr-build" onClick={build.cancel}><span>Building…</span><span>Cancel ×</span></button>
            : <button type="button" className="ws-primary csr-build" onClick={() => { setExportNotice(null); build.start(input); }}><span>{week.plan ? 'Rebuild the week' : 'Build the week'}</span><span aria-hidden="true">→</span></button>}
          <button type="button" className="ws-outline csr-save" data-dirty={sync.status === 'ready' && sync.dirty} disabled={sync.status !== 'ready' || sync.saving} onClick={() => sync.save()}
            title={sync.status === 'ready' ? 'Saves the team and every week where everyone who opens this page gets them' : sync.status === 'locked' ? 'Enter the team key first' : 'Shared storage is not available'}>
            <span>{sync.saving ? 'Saving…' : 'Save for everyone'}</span><span aria-hidden="true">↑</span></button>
          <button type="button" className="ws-outline csr-guide-open" onClick={() => setGuideOpen(true)}>Guide ?</button>
          {confirmReset
            ? <span className="csr-reset-confirm"><button type="button" className="ws-reset" onClick={reset}>Erase this browser’s copy</button><button type="button" className="ws-reset" onClick={() => setConfirmReset(false)}>Keep</button></span>
            : <button type="button" className="ws-reset" onClick={() => setConfirmReset(true)}>Reset ↺</button>}
        </div>
      </div>
      <SyncLine sync={sync} autosaved={saved} note={notice} />
      <nav className="ws-mobile-tabs" aria-label="Schedule builder panels">{views.map(view => <button type="button" key={view.id} onClick={() => { setMobileView(view.id); if (view.id !== 'schedule') setSetupView(view.id); }} aria-pressed={mobileView === view.id}><span>{view.number}</span> {view.label}</button>)}</nav>
      <main className="ws-panels" aria-label="Schedule builder">
        <section id="workspace-setup" className="ws-pane ws-source-pane" aria-labelledby="setup-heading" data-active={mobileView !== 'schedule'}>
          <div className="ws-pane-heading csr-pane-heading"><span className="ws-kicker ws-green">01 // SETUP</span><span className="ws-version">{state.operators.length} PEOPLE</span><h2 id="setup-heading" className="ws-sr-only">{setupView === 'team' ? 'Operators and their sides' : 'Day targets and rules'}</h2></div>
          <div className="ws-segmented csr-setup-switch" aria-label="Setup section">
            <button type="button" onClick={() => showSetup('team')} aria-pressed={setupView === 'team'}>Team</button>
            <button type="button" onClick={() => showSetup('week')} aria-pressed={setupView === 'week'}>Day targets and rules</button>
          </div>
          <div className="ws-pane-scroll">
            {setupView === 'team'
              ? <TeamPane operators={state.operators} weekStart={state.weekStart} wishes={wishes.wishes} onRemoveWish={wishes.remove} onOpenWishes={() => setBellOpen(true)} onOpenHistory={() => setHistoryOpen(true)}
                  onUpdate={(id, patch) => change(current => updateOperator(current, id, patch))} onAdd={() => change(addOperator)}
                  onRemove={id => { if (selected?.operatorId === id) setSelected(null); change(current => removeOperator(current, id)); }}
                  onExport={exportFile} onImport={file => void importFile(file)} />
              : <WeekPane weekStart={state.weekStart} targets={week.targets} teamSize={state.operators.length} onTarget={(day, field, value) => change(current => setTarget(current, day, field, value))} />}
          </div>
        </section>
        <section id="workspace-schedule" className="ws-pane ws-scenario-pane" aria-labelledby="schedule-heading" data-active={mobileView === 'schedule'} tabIndex={-1}>
          <SchedulePane input={input} plan={week.plan} planStatus={week.planStatus} checks={checks} loads={loads} counts={counts} selected={selected} focusCheckId={focusCheckId}
            clockMode={clockMode} building={build.busy} buildError={build.error} exportNotice={exportNotice} exportingPdf={exportingPdf}
            onSelect={setSelected} onRequest={(operatorId, day, request) => change(current => setRequest(current, operatorId, day, request))}
            onClearWeek={() => { build.cancel(); setSelected(null); setFocusCheckId(null); change(clearWeek); }}
            onFocusCheck={setFocusCheckId} onClockMode={setClockMode}
            onPdf={() => void pdf()} onCopy={() => void copy()}
            onDownload={() => { if (week.plan) { download(`operators-schedule-${state.weekStart}.csv`, new Blob([toCsv(state.weekStart, state.operators, week.plan)], { type: 'text/csv;charset=utf-8' })); setExportNotice('The CSV was saved in the team sheet’s own layout. In Google Sheets: File → Import.'); } }}
            channels={<RolloutPane weekStart={state.weekStart} operators={state.operators} plan={week.plan} channels={state.channels} rollout={week.rollout}
              onHolder={(day, channelId, slots, operatorId) => change(current => setChannelHolder(current, day, channelId, slots, operatorId))}
              onTable={(day, table) => change(current => setDayRollout(current, day, table))}
              onAddChannel={() => change(addChannel)} onRenameChannel={(id, name) => change(current => renameChannel(current, id, name))} onRemoveChannel={id => change(current => removeChannel(current, id))} />} />
        </section>
      </main>
      <footer className="ws-statusbar"><span><span className="ws-status-dot" aria-hidden="true" /> {saved ? 'AUTOSAVED IN THIS BROWSER' : 'NOT AUTOSAVED — USE “SAVE TO FILE”'} <span className="ws-footer-divider">/</span> <span>{sync.status === 'ready' ? sync.dirty ? 'NOT YET SAVED FOR EVERYONE' : 'SAVED FOR EVERYONE' : sync.status === 'locked' ? 'SHARED COPY NEEDS THE TEAM KEY' : 'SHARED STORAGE OFF'}</span></span><span><Link to="/workspace" className="csr-footer-link">SCHEDULE REPAIR DEMO ↗</Link></span></footer>
      {guideOpen && <Guide onClose={closeGuide} />}
      {historyOpen && <SaveHistory sync={sync} onClose={closeHistory} />}
    </div>
  );
}
