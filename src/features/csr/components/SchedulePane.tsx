import { useState } from 'react';
import { ALL_OPTIONS, dayCoverage, isShift, overall } from '../model/check.ts';
import { DAYS, DEPARTMENT_ZONE, kindLabel, templateById } from '../model/defaults.ts';
import { cellLines } from '../model/export.ts';
import { clock, dateLabel, instantOf, localRange, offsetLabel, weekDates } from '../model/time.ts';
import type { Assignment, Cell, CellRef, Check, CheckStatus, Load, Plan, PlanStatus, Request, WeekInput } from '../model/types.ts';

interface SchedulePaneProps {
  input: WeekInput;
  plan: Plan | null;
  planStatus: PlanStatus | null;
  checks: Check[];
  loads: Record<string, Load>;
  counts: { headcount: number; nonvoice: number }[];
  selected: CellRef | null;
  focusCheckId: string | null;
  exportNotice: string | null;
  onSelect: (ref: CellRef) => void;
  onRequest: (operatorId: string, day: number, request: Request) => void;
  onClearFocus: () => void;
  onCopy: () => void;
  onDownload: () => void;
}

const encode = (value: Request | Cell): string => isShift(value) ? `${value.templateId}/${value.kind}` : value;
const decode = (value: string): Request => {
  if (value === 'auto' || value === 'off' || value === 'vacation') return value;
  const [templateId, kind] = value.split('/');
  return { templateId, kind: kind as Assignment['kind'] };
};
const hours = (minutes: number) => `${Math.round(minutes / 6) / 10}`;

function statusLine(planStatus: PlanStatus | null, status: CheckStatus): { tone: CheckStatus; title: string; detail: string } {
  const after = `${planStatus?.edited ? ' Edited by hand since.' : ''}`;
  if (!planStatus) return { tone: 'warn', title: 'No week yet', detail: '' };
  const verdict = status === 'fail' ? 'A rule is broken' : status === 'warn' ? 'The rules hold, with warnings' : 'Every rule holds';
  if (planStatus.source === 'sample') return { tone: status, title: `The team’s own week: ${verdict.toLowerCase()}`, detail: `This is the schedule the team published for this week, loaded as a starting point.${after}` };
  if (planStatus.relaxed && planStatus.rulesProven !== null && !planStatus.stale && !planStatus.edited) return planStatus.rulesProven
    ? { tone: 'fail', title: 'No week can satisfy every rule', detail: 'The search finished: with these people, requests and “never” marks at least one rule has to give. This is the closest week; the failed checks say what gave.' }
    : { tone: 'fail', title: 'Time ran out before every rule was met', detail: 'That is not proof the week is impossible. Loosen a request or a “never” mark and rebuild.' };
  return { tone: status, title: verdict,
    detail: `${planStatus.stale ? 'Built by the solver on earlier settings.' : planStatus.tuned ? 'Built by the solver; preferences are within 3% of the best possible.' : 'Built by the solver. The search stopped on the time limit, so preferences may not be at their best.'}${after}` };
}

export default function SchedulePane({ input, plan, planStatus, checks, loads, counts, selected, focusCheckId, exportNotice, onSelect, onRequest, onClearFocus, onCopy, onDownload }: SchedulePaneProps) {
  const [clockMode, setClockMode] = useState<'department' | 'local'>('department');
  const { operators, requests, targets, weekStart } = input;
  const dates = weekDates(weekStart);
  const focused = checks.find(check => check.id === focusCheckId) ?? null;
  const issues = new Map<string, CheckStatus>();
  for (const check of focused ? [focused] : checks.filter(item => item.status !== 'pass')) {
    for (const ref of check.cells) {
      const key = `${ref.operatorId}/${ref.day}`;
      if (issues.get(key) !== 'fail') issues.set(key, check.status === 'pass' ? 'warn' : check.status);
    }
  }
  const banner = statusLine(planStatus, overall(checks));
  const operator = operators.find(item => item.id === selected?.operatorId) ?? null;
  const request: Request = operator && selected ? requests[operator.id]?.[selected.day] ?? 'auto' : 'auto';
  const cell: Cell | undefined = operator && selected ? plan?.[operator.id]?.[selected.day] : undefined;
  const template = isShift(cell) ? templateById(cell.templateId) : undefined;
  const coverage = plan && selected ? dayCoverage(plan, operators, selected.day) : [];
  const lowest = (line: 'voice' | 'nonvoice') => Math.min(...coverage.map(slot => slot[line].length));
  const cellIssues = selected ? checks.filter(check => check.status !== 'pass' && check.cells.some(ref => ref.operatorId === selected.operatorId && ref.day === selected.day)) : [];

  return (
    <>
      <div className="ws-pane-heading"><span className="ws-kicker ws-red">03 // SCHEDULE</span><div><h2 id="schedule-heading">The week</h2><span className="ws-version">{planStatus ? planStatus.source === 'sample' ? 'TEAM SHEET' : 'SOLVER' : 'EMPTY'}</span></div></div>
      <div className="ws-pane-scroll">
        {plan && <div className={`ws-validation ws-validation-${banner.tone === 'warn' ? 'unknown' : banner.tone}`} role="status"><span aria-hidden="true">{banner.tone === 'pass' ? '✓' : banner.tone === 'warn' ? '!' : '×'}</span><div><strong>{banner.title}</strong><small>{banner.detail}</small></div></div>}
        {!plan && <div className="ws-notice csr-empty"><strong>This week has no schedule yet</strong>Pin days off, vacations or fixed shifts in the cells below if there are any, then press “Build the week” in the Week panel.</div>}
        {focused && <p className="csr-focus">Showing only: {focused.label}. <button type="button" className="ws-text-button" onClick={onClearFocus}>Show all issues</button></p>}

        <div className="ws-segmented" aria-label="Clock shown in the cells">
          <button type="button" onClick={() => setClockMode('department')} aria-pressed={clockMode === 'department'}>Department time · PT</button>
          <button type="button" onClick={() => setClockMode('local')} aria-pressed={clockMode === 'local'}>Each operator’s local time</button>
        </div>
        <div className="csr-grid-wrap">
          <table className="csr-grid" aria-label={`Schedule for the week of ${dateLabel(dates[0])}`}>
            <thead><tr><th scope="col">Operator</th>{DAYS.map((day, index) => <th scope="col" key={day} data-weekend={index >= 5}>{dateLabel(dates[index])}<small>{day}</small></th>)}<th scope="col">Week</th></tr></thead>
            <tbody>
              {operators.map(person => {
                const load = loads[person.id];
                return (
                  <tr key={person.id}>
                    <th scope="row">{person.nick}<small>{person.timeZone ? offsetLabel(person.timeZone, instantOf(weekStart, 12 * 60)) : 'zone ?'}</small></th>
                    {DAYS.map((day, index) => {
                      const wanted = requests[person.id]?.[index] ?? 'auto';
                      const shown: Cell | undefined = plan ? plan[person.id]?.[index] ?? 'off' : wanted === 'auto' ? undefined : wanted;
                      const shift = isShift(shown) ? templateById(shown.templateId) : undefined;
                      const lines = shown === undefined ? ['·'] : cellLines(shown);
                      if (clockMode === 'local' && shift) lines[0] = person.timeZone ? localRange(dates[index], shift, person.timeZone) : `${lines[0]} PT`;
                      const issue = issues.get(`${person.id}/${index}`);
                      const isSelected = selected?.operatorId === person.id && selected.day === index;
                      return (
                        <td key={day}>
                          <button type="button" className="csr-cell" data-kind={isShift(shown) ? shown.kind : shown ?? 'empty'} data-issue={issue} data-selected={isSelected} aria-pressed={isSelected}
                            aria-label={`${person.nick}, ${day} ${dateLabel(dates[index])}: ${lines.join(' ')}${wanted !== 'auto' ? ', pinned' : ''}${issue ? `, ${issue === 'fail' ? 'breaks a rule' : 'warning'}` : ''}`}
                            onClick={() => onSelect({ operatorId: person.id, day: index })}>
                            <span>{lines[0]}</span>{lines[1] && <small>{lines[1]}</small>}
                            {wanted !== 'auto' && <i className="csr-pin" aria-hidden="true">▣</i>}
                            {issue && <i className="csr-flag" aria-hidden="true">{issue === 'fail' ? '×' : '!'}</i>}
                          </button>
                        </td>
                      );
                    })}
                    <td className="csr-load" data-off={plan ? load.shifts !== load.required : false}>{plan ? <>{load.shifts}/{load.required}<small>{hours(load.paidMinutes)} h</small></> : <>–/{load.required}</>}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr><th scope="row">On shift<small>target</small></th>{DAYS.map((day, index) => <td key={day} data-off={plan ? counts[index].headcount !== targets[index].headcount : false}>{plan ? counts[index].headcount : '–'}<small>{targets[index].headcount}</small></td>)}<td /></tr>
              <tr><th scope="row">n/v+v<small>target</small></th>{DAYS.map((day, index) => <td key={day} data-off={plan ? counts[index].nonvoice !== targets[index].nonvoice : false}>{plan ? counts[index].nonvoice : '–'}<small>{targets[index].nonvoice}</small></td>)}<td /></tr>
            </tfoot>
          </table>
        </div>
        <div className="ws-source-footnote csr-legend">
          <span><i data-kind="nv" /> n/v+v — non-voice and calls, covers both lines</span>
          <span><i data-kind="v" /> v — calls only</span>
          <span>▣ pinned by the scheduler · × breaks a rule · ! warning</span>
        </div>

        {operator && selected && (
          <div className="csr-editor">
            <span className="ws-kicker">SELECTED CELL</span>
            <strong>{operator.nick} · {DAYS[selected.day]} {dateLabel(dates[selected.day])}</strong>
            {template && isShift(cell) ? (
              <p>{clock(template.start)}–{clock(template.end)} Pacific, {kindLabel(cell.kind)}.{' '}
                {operator.timeZone ? <>For {operator.nick} that is <b>{localRange(dates[selected.day], template, operator.timeZone)}</b> ({offsetLabel(operator.timeZone, instantOf(dates[selected.day], template.start))}).</> : <>No time zone is set for {operator.nick}, so local hours are unknown.</>}</p>
            ) : <p>{cell === 'vacation' ? 'Vacation.' : cell === 'off' ? 'Day off.' : 'Nothing scheduled yet.'}</p>}
            {cellIssues.map(check => <p key={check.id} className={check.status === 'fail' ? 'ws-red' : 'ws-orange'}>{check.status === 'fail' ? '×' : '!'} {check.label}: {check.detail}</p>)}
            <label className="ws-field-label" htmlFor="csr-request">For the next build, this cell is</label>
            <select id="csr-request" value={encode(request)} onChange={event => onRequest(operator.id, selected.day, decode(event.target.value))}>
              <option value="auto">Free — the solver decides</option>
              <option value="off">Pinned: day off</option>
              <option value="vacation">Pinned: vacation</option>
              <optgroup label="Pinned shift">
                {ALL_OPTIONS.map(option => <option key={encode(option)} value={encode(option)}>{templateById(option.templateId)!.label} · {kindLabel(option.kind)}</option>)}
              </optgroup>
            </select>
            <p className="ws-note">{request === 'auto' ? 'Pinning writes the choice into the week right away and keeps it on every rebuild.' : 'Set it back to “Free” to let the solver decide again on the next build.'}</p>
            {plan && coverage.length > 0 && (
              <div className="csr-coverage">
                <span className="ws-kicker">COVERAGE · {DAYS[selected.day]} {dateLabel(dates[selected.day])} · {offsetLabel(DEPARTMENT_ZONE, instantOf(dates[selected.day], 12 * 60))}</span>
                {(['voice', 'nonvoice'] as const).map(line => (
                  <div key={line} className="csr-coverage-row" role="img" aria-label={`${line === 'voice' ? 'Voice' : 'Non-voice'} line: between ${lowest(line)} and ${Math.max(...coverage.map(slot => slot[line].length))} operators through the day`}>
                    <b>{line === 'voice' ? 'Voice' : 'Non-voice'}</b>
                    <div>{coverage.map(slot => <i key={slot.start} data-level={Math.min(slot[line].length, 2)} title={`${clock(slot.start)}: ${slot[line].length}`}>{slot[line].length}</i>)}</div>
                  </div>
                ))}
                <div className="csr-coverage-row csr-coverage-axis" aria-hidden="true"><b /><div>{coverage.map(slot => <i key={slot.start}>{slot.start % 120 === 0 ? clock(slot.start).replace(' ', '').replace('M', '').toLowerCase() : ''}</i>)}</div></div>
                <p className="ws-note">Operators on each line per half hour. With 1 on a line nobody there can leave for lunch or a break.</p>
              </div>
            )}
          </div>
        )}

        {plan && (
          <>
            <div className="ws-section-heading"><h3>Load through the week</h3><span className="ws-kicker">PAID HOURS EXCLUDE LUNCH</span></div>
            <div className="csr-grid-wrap">
              <table className="csr-loads">
                <thead><tr><th scope="col">Operator</th><th scope="col">Shifts</th><th scope="col">Paid h</th><th scope="col">v</th><th scope="col">n/v+v</th><th scope="col">Early</th><th scope="col">Day</th><th scope="col">Late</th><th scope="col">Sa–Su</th></tr></thead>
                <tbody>
                  {operators.map(person => { const load = loads[person.id]; return (
                    <tr key={person.id}><th scope="row">{person.nick}</th><td data-off={load.shifts !== load.required}>{load.shifts}/{load.required}</td><td>{hours(load.paidMinutes)}</td><td>{load.voice}</td><td>{load.nonvoice}</td><td>{load.bands.early}</td><td>{load.bands.day}</td><td>{load.bands.late}</td><td>{load.weekend}</td></tr>
                  ); })}
                </tbody>
              </table>
            </div>
            <div className="ws-final-actions">
              <button type="button" className="ws-primary" onClick={onCopy}><span>Copy for Google Sheets</span><span aria-hidden="true">⧉</span></button>
              <button type="button" className="ws-outline" onClick={onDownload}>CSV ↓</button>
              <p role="status">{exportNotice ?? 'Both keep the team’s layout: hours on the first line of a cell, shift type on the second. Nothing is sent anywhere.'}</p>
            </div>
          </>
        )}
      </div>
    </>
  );
}
