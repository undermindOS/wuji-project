import { DAYS } from '../model/defaults.ts';
import { addDays, dateLabel, mondayOf, weekDates } from '../model/time.ts';
import type { Check, DayTarget, PlanStatus } from '../model/types.ts';

const RULES: [string, string][] = [
  ['Department hours', 'Every day, 6 AM–8 PM Pacific time.'],
  ['Both lines, every moment', 'At least one operator on voice and one on non-voice. An n/v+v shift covers both lines; a v shift covers voice only.'],
  ['Mandatory lunch', 'Every 8.5-hour shift needs a 30-minute lunch, one operator at a time, never in the first or last hour and never while alone on a line.'],
  ['Personal norm', 'Each operator gets their own number of shifts a week, less requested days off and vacation, and no more 6-hour shifts than allowed.'],
  ['Strong and weak sides', '“Never” is a ban. Strong sides are preferred and weak ones avoided, by shift type and by time of day.'],
  ['Preferences', 'Day targets below, one start time through the week, and days off together. These give way to the rules above.'],
];
const MARK: Record<Check['status'], string> = { pass: '✓', warn: '!', fail: '×' };

interface WeekPaneProps {
  weekStart: string;
  savedWeeks: string[];
  targets: DayTarget[];
  teamSize: number;
  hasPlan: boolean;
  planStatus: PlanStatus | null;
  checks: Check[];
  focusCheckId: string | null;
  building: boolean;
  buildError: string | null;
  onOpenWeek: (weekStart: string) => void;
  onTarget: (day: number, field: 'headcount' | 'nonvoice', value: number) => void;
  onBuild: () => void;
  onCancel: () => void;
  onFocusCheck: (id: string | null) => void;
}

export default function WeekPane({ weekStart, savedWeeks, targets, teamSize, hasPlan, planStatus, checks, focusCheckId, building, buildError, onOpenWeek, onTarget, onBuild, onCancel, onFocusCheck }: WeekPaneProps) {
  const dates = weekDates(weekStart);
  const target = (day: number, field: 'headcount' | 'nonvoice', label: string) => (
    <input type="number" inputMode="numeric" min={0} max={teamSize} value={targets[day][field]} aria-label={`${label}, ${DAYS[day]} ${dateLabel(dates[day])}`}
      onChange={event => { const next = Number(event.target.value); if (event.target.value !== '' && Number.isInteger(next) && next >= 0 && next <= 99) onTarget(day, field, next); }} />
  );
  return (
    <>
      <div className="ws-pane-heading"><span className="ws-kicker ws-orange">02 // WEEK</span><div><h2 id="week-heading">Rules and requests</h2><span className="ws-version">{dateLabel(dates[0])}–{dateLabel(dates[6])}</span></div></div>
      <div className="ws-pane-scroll">
        <div className="ws-task-body">
          <label className="ws-field-label" htmlFor="csr-week">Week starting Monday</label>
          <div className="csr-week-nav">
            <button type="button" className="ws-outline" onClick={() => onOpenWeek(addDays(weekStart, -7))} aria-label="Previous week">←</button>
            <input id="csr-week" type="date" value={weekStart} onChange={event => { if (event.target.value) onOpenWeek(mondayOf(event.target.value)); }} />
            <button type="button" className="ws-outline" onClick={() => onOpenWeek(addDays(weekStart, 7))} aria-label="Next week">→</button>
          </div>
          <p className="ws-note">{savedWeeks.length > 1 ? `${savedWeeks.length} weeks are kept in this browser. ` : ''}A new week starts empty and keeps these day targets.</p>

          <div className="ws-rule-heading"><span className="ws-kicker">DAY TARGETS</span><span className="ws-kicker">PREFERRED, NOT REQUIRED</span></div>
          <table className="csr-targets">
            <thead><tr><th scope="col"><span className="ws-sr-only">Target</span></th>{DAYS.map((day, index) => <th scope="col" key={day}>{day}<small>{dateLabel(dates[index])}</small></th>)}</tr></thead>
            <tbody>
              <tr><th scope="row">On shift</th>{DAYS.map((day, index) => <td key={day}>{target(index, 'headcount', 'Operators on shift')}</td>)}</tr>
              <tr><th scope="row">of them n/v+v</th>{DAYS.map((day, index) => <td key={day}>{target(index, 'nonvoice', 'Operators on n/v+v')}</td>)}</tr>
            </tbody>
          </table>
          <p className="ws-note">Days off, vacations and fixed shifts are set per cell in the schedule: select a cell and choose what to pin.</p>

          <div className="ws-run-controls">
            <div className="ws-rule-heading"><span className="ws-kicker ws-orange">SOLVER</span><span className="ws-kicker">RUNS IN THIS BROWSER</span></div>
            {building
              ? <button type="button" className="ws-outline" onClick={onCancel}><span>Building the week… up to 15 seconds</span><span>CANCEL ×</span></button>
              : <button type="button" className="ws-primary" onClick={onBuild}><span>{hasPlan ? 'Rebuild the week' : 'Build the week'}</span><span aria-hidden="true">→</span></button>}
            {hasPlan && !building && <p className="ws-analysis-cost">Rebuilding replaces every cell that is not pinned. Pinned cells, days off and vacations are kept.</p>}
            {buildError && <p className="ws-notice" role="alert"><strong>The week was not built</strong>{buildError}</p>}
            {planStatus?.stale && !building && <p className="ws-notice"><strong>Settings changed after this week was produced</strong>The checks below already use the new settings. Rebuild to let the solver use them too.</p>}
          </div>

          <div className="ws-rule-heading"><span className="ws-kicker">CHECKS</span><span className="ws-kicker">{hasPlan ? `${checks.filter(check => check.status === 'pass').length}/${checks.length} PASS` : 'NO WEEK YET'}</span></div>
          {hasPlan ? (
            <ul className="csr-checks">
              {checks.map(check => (
                <li key={check.id} data-status={check.status}>
                  <button type="button" aria-pressed={focusCheckId === check.id} disabled={!check.cells.length} onClick={() => onFocusCheck(focusCheckId === check.id ? null : check.id)}>
                    <span aria-hidden="true">{MARK[check.status]}</span>
                    <span><strong>{check.label}<span className="ws-sr-only">: {check.status === 'pass' ? 'passes' : check.status === 'warn' ? 'warning' : 'fails'}</span></strong><small>{check.detail}</small>{check.cells.length > 0 && <small className="csr-check-link">{focusCheckId === check.id ? 'Showing these cells in the schedule ↗' : `Show ${check.cells.length} cell${check.cells.length === 1 ? '' : 's'} in the schedule ↗`}</small>}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : <p className="ws-note">Nothing to check yet. Build the week, or pin shifts by hand in the schedule.</p>}

          <div className="ws-rule-heading"><span className="ws-kicker">TEAM RULES IN THE MODEL</span><span className="ws-kicker">{RULES.length}</span></div>
          <ul className="ws-rules">
            {RULES.map(([label, detail], index) => <li key={label}><span>{String(index + 1).padStart(2, '0')}</span><div><strong>{label}</strong><small>{detail}</small></div></li>)}
          </ul>
        </div>
      </div>
    </>
  );
}
