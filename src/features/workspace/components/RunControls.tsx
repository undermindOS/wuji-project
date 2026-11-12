import type { useProjectRuns } from '../api/useProjectRuns';
import { isActiveRun, runStatusLabel } from '../model/runs';

export default function RunControls({ state, disabled, onShowResults }: {
  state: ReturnType<typeof useProjectRuns>; disabled: boolean; onShowResults: () => void;
}) {
  const active = state.runs.some(isActiveRun) || (!!state.run && isActiveRun(state.run));
  return <div className="ws-run-controls">
    <div className="ws-rule-heading"><span className="ws-kicker ws-orange">CP-SAT // CALCULATION</span><span className="ws-kicker">10 S LIMIT</span></div>
    <button type="button" className="ws-primary" disabled={disabled || active || state.busy || state.loading} onClick={() => void state.start()}>
      {state.busy ? 'Submitting…' : active ? 'Calculation in progress…' : state.loading ? 'Loading runs…' : 'Calculate saved constraints'} <span aria-hidden="true">→</span>
    </button>
    {active && <button type="button" className="ws-outline" disabled={state.busy || state.run?.cancelRequested} onClick={() => void state.cancel()}>{state.run?.cancelRequested ? 'Cancelling…' : 'Cancel calculation'}</button>}
    {disabled && <p className="ws-note">Save the current constraints before calculating.</p>}
    {state.runs.length > 0 && <><label className="ws-field-label" htmlFor="run-history">Runs for these constraints</label><select id="run-history" value={state.run?.id ?? state.runs[0].id} disabled={active || state.busy} onChange={event => state.select(event.target.value)}>{state.runs.map((run, index) => <option key={run.id} value={run.id}>{String(state.runs.length - index).padStart(2, '0')} · {runStatusLabel[run.status]} · {new Date(run.createdAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</option>)}</select><button type="button" className="ws-text-button" onClick={onShowResults}>Open result and log ↗</button></>}
    {state.error && <p className="ws-notice" role="alert">{state.error}</p>}
    <button type="button" className="ws-text-button" disabled={state.busy} onClick={state.refresh}>Refresh runs ↻</button>
    <p className="ws-note">OR-Tools calculates assignments. The request text is saved separately; constraints are specified explicitly.</p>
  </div>;
}
