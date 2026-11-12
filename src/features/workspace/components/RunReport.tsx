import type { RunDetail } from '../model/types';
import { runStatusLabel } from '../model/runs';

const outcomeLabel = {
  solutions: 'Verified options are ready',
  infeasible: 'Infeasibility proven under the given constraints',
  needs_clarification: 'Source data needs clarification',
  limit: 'Time limit reached; infeasibility not proven',
  invalid: 'The result failed validation',
};

export default function RunReport({ run, onShiftSelect }: { run: RunDetail; onShiftSelect: (id: string) => void }) {
  return <div className="ws-run-report">
    <div className="ws-rule-heading"><span className="ws-kicker ws-orange">{runStatusLabel[run.status]}</span><span className="ws-kicker">{run.result ? (run.result.elapsedMs / 1000).toFixed(2) + ' S' : 'CP-SAT'}</span></div>
    <strong role="status">{run.result ? outcomeLabel[run.result.outcome] : run.status === 'queued' ? 'Job queued. Execution has not started yet.' : run.status === 'running' ? run.cancelRequested ? 'Stopping search…' : 'Building and checking options…' : run.status === 'cancelled' ? 'Calculation cancelled. No option was returned.' : 'Run interrupted. You can calculate again.'}</strong>
    {!run.isCurrent && <p className="ws-notice">Historical run: the project’s current source or constraints have changed.</p>}
    {run.result?.issues.map((issue, index) => <div className="ws-notice" key={index}><p>{issue.message}</p>{(issue.shiftIds ?? []).slice(0, 5).map(sid => <button key={sid} type="button" className="ws-text-button" onClick={() => onShiftSelect(sid)}>Shift {sid} · view evidence ↖</button>)}</div>)}
    <details className="ws-journal"><summary>Calculation log · {run.events.length}</summary>
      <p className="ws-note">Engine: {run.engineVersion}<br />Source: {run.sourceHash.slice(0, 16)}…<br />Total search time limit: {run.maxTimeSeconds} s. OR-Tools calculates assignments.</p>
      <ol>{run.events.map((event, index) => <li key={index}>{new Date(event.at).toLocaleTimeString('en-US')} · {event.message}</li>)}</ol>
      {run.result?.attempts.map((attempt, index) => <p className="ws-note" key={index}>{attempt.priority === 'min_changes' ? 'Reassignments' : 'Pay'} / {attempt.phase === 'primary' ? 'primary objective' : 'secondary objective'}: <strong>{attempt.status}</strong> · {attempt.elapsedMs} ms</p>)}
    </details>
  </div>;
}
