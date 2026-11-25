import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { dayCoverage, isShift, overall } from '../model/check.ts';
import { DAY_NAMES, kindName, templateById } from '../model/defaults.ts';
import { clock, instantOf, localShift, offsetLabel, shortDate, weekDates } from '../model/time.ts';
import type { Cell, CellRef, Check, CheckStatus, Load, Plan, PlanStatus, Request, WeekInput } from '../model/types.ts';
import CellMenu from './CellMenu';

export type ClockMode = 'department' | 'local';

interface SchedulePaneProps {
  input: WeekInput;
  plan: Plan | null;
  planStatus: PlanStatus | null;
  checks: Check[];
  loads: Record<string, Load>;
  counts: { headcount: number; nonvoice: number }[];
  selected: CellRef | null;
  focusCheckId: string | null;
  clockMode: ClockMode;
  building: boolean;
  buildError: string | null;
  exportNotice: string | null;
  exportingPdf: boolean;
  onSelect: (ref: CellRef) => void;
  onRequest: (operatorId: string, day: number, request: Request) => void;
  onClearWeek: () => void;
  /** The non-voice channel table, shown on the second tab. */
  channels: ReactNode;
  onFocusCheck: (id: string | null) => void;
  onClockMode: (mode: ClockMode) => void;
  onPdf: () => void;
  onCopy: () => void;
  onDownload: () => void;
}

const MARK: Record<CheckStatus, string> = { pass: '✓', warn: '!', fail: '×' };
const hours = (minutes: number) => `${Math.round(minutes / 6) / 10}`;
const dayOffset = (shift: number) => shift === 0 ? '' : `${shift > 0 ? '+' : '−'}${Math.abs(shift)}`;

function statusLine(planStatus: PlanStatus, status: CheckStatus): { tone: CheckStatus; title: string; detail: string } {
  const after = planStatus.edited ? ' Edited by hand since.' : '';
  const verdict = status === 'fail' ? 'A rule is broken' : status === 'warn' ? 'The rules hold, with warnings' : 'Every rule holds';
  if (planStatus.source === 'manual') return { tone: status, title: `Put together by hand: ${verdict.toLowerCase()}`, detail: 'No solver was used for this week. Press “Rebuild the week” to let it fill the cells you have not set.' };
  if (planStatus.source === 'sample') return { tone: status, title: `The team’s own week: ${verdict.toLowerCase()}`, detail: `This is the schedule the team published for this week, loaded as a starting point.${after}` };
  if (planStatus.relaxed && planStatus.rulesProven !== null && !planStatus.stale && !planStatus.edited) return planStatus.rulesProven
    ? { tone: 'fail', title: 'No week can satisfy every rule', detail: 'The search finished: with these people, requests and “never” marks at least one rule has to give. This is the closest week; the failed checks say what gave.' }
    : { tone: 'fail', title: 'Time ran out before every rule was met', detail: 'That is not proof the week is impossible. Loosen a request or a “never” mark and rebuild.' };
  return { tone: status, title: verdict,
    detail: `${planStatus.stale ? 'Built by the solver on earlier settings.' : planStatus.tuned ? 'Built by the solver; preferences are within 3% of the best possible.' : 'Built by the solver. The search stopped on the time limit, so preferences may not be at their best.'}${after}` };
}

export default function SchedulePane({ input, plan, planStatus, checks, loads, counts, selected, focusCheckId, clockMode, building, buildError, exportNotice, exportingPdf, onSelect, onRequest, onClearWeek, channels, onFocusCheck, onClockMode, onPdf, onCopy, onDownload }: SchedulePaneProps) {
  const [tab, setTab] = useState<'week' | 'channels'>('week');
  const [menu, setMenu] = useState<{ ref: CellRef; anchor: DOMRect } | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const closeMenu = useCallback(() => {
    setMenu(current => {
      if (current) document.querySelector<HTMLButtonElement>(`[data-cell="${current.ref.operatorId}/${current.ref.day}"]`)?.focus();
      return null;
    });
  }, []);
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
  const banner = plan && planStatus ? statusLine(planStatus, overall(checks)) : null;
  const operator = operators.find(item => item.id === selected?.operatorId) ?? null;
  const request: Request = operator && selected ? requests[operator.id]?.[selected.day] ?? 'auto' : 'auto';
  const cell: Cell | undefined = operator && selected ? plan?.[operator.id]?.[selected.day] : undefined;
  const template = isShift(cell) ? templateById(cell.templateId) : undefined;
  const local = template && operator?.timeZone && selected ? localShift(dates[selected.day], template, operator.timeZone) : null;
  const coverage = plan && selected ? dayCoverage(plan, operators, selected.day) : [];
  const cellIssues = selected ? checks.filter(check => check.status !== 'pass' && check.cells.some(ref => ref.operatorId === selected.operatorId && ref.day === selected.day)) : [];

  return (
    <>
      <div className="ws-pane-heading csr-pane-heading"><span className="ws-kicker ws-red">02 // SCHEDULE</span><span className="ws-version">{planStatus ? planStatus.source === 'sample' ? 'TEAM SHEET' : planStatus.source === 'manual' ? 'BY HAND' : 'SOLVER' : 'EMPTY'}</span><h2 id="schedule-heading" className="ws-sr-only">The week</h2></div>
      <div className="ws-segmented csr-setup-tabs" aria-label="Schedule section">
        <button type="button" onClick={() => setTab('week')} aria-pressed={tab === 'week'}>Week schedule</button>
        <button type="button" onClick={() => { setTab('channels'); setMenu(null); }} aria-pressed={tab === 'channels'}>Non-voice channels</button>
      </div>
      {tab === 'channels' ? <div className="ws-pane-scroll">{channels}</div> : (
      <div className="ws-pane-scroll">
        {banner && <div className={`ws-validation ws-validation-${banner.tone === 'warn' ? 'unknown' : banner.tone}`} role="status"><span aria-hidden="true">{MARK[banner.tone]}</span><div><strong>{banner.title}</strong><small>{banner.detail}</small></div></div>}
        {!plan && <div className="ws-notice csr-pane-notice"><strong>This week has no schedule yet</strong>Press “Build the week” above to let the solver make one, or click any cell below and put the week together by hand. You can mix both: the solver keeps what you set.</div>}
        {building && <p className="csr-pane-status" role="status">Building the week… this takes up to 15 seconds.</p>}
        {buildError && <p className="ws-notice csr-pane-notice" role="alert"><strong>The week was not built</strong>{buildError}</p>}
        {planStatus?.stale && !building && <p className="ws-notice csr-pane-notice"><strong>Settings changed after this week was produced</strong>The checks already use the new settings. Press “Rebuild the week” to let the solver use them too.</p>}

        <div className="csr-bar">
          <div className="ws-segmented" aria-label="Clock shown in the cells">
            <button type="button" onClick={() => onClockMode('department')} aria-pressed={clockMode === 'department'}>Pacific time</button>
            <button type="button" onClick={() => onClockMode('local')} aria-pressed={clockMode === 'local'}>Each operator’s local time</button>
          </div>
          {plan && (
            <div className="csr-exports">
              <button type="button" className="ws-outline" onClick={onPdf} disabled={exportingPdf}>{exportingPdf ? 'Preparing…' : 'PDF ↓'}</button>
              <button type="button" className="ws-outline" onClick={onCopy}>Copy for Google Sheets</button>
              <button type="button" className="ws-outline" onClick={onDownload}>CSV ↓</button>
              {confirmClear
                ? <><button type="button" className="ws-outline csr-danger" onClick={() => { onClearWeek(); setConfirmClear(false); }}>Yes, empty the week</button><button type="button" className="ws-outline" onClick={() => setConfirmClear(false)}>Keep it</button></>
                : <button type="button" className="ws-outline" onClick={() => setConfirmClear(true)}>Clear the week</button>}
            </div>
          )}
        </div>
        {exportNotice && <p className="csr-pane-status" role="status">{exportNotice}</p>}
        {focused && <p className="csr-focus">Showing only the cells for: {focused.label}. <button type="button" className="ws-text-button" onClick={() => onFocusCheck(null)}>Show all issues</button></p>}

        <div className="csr-grid-wrap">
          <table className="csr-grid" aria-label={`Schedule for the week of ${shortDate(dates[0])}`}>
            <thead><tr><th scope="col">Operator</th>{DAY_NAMES.map((day, index) => <th scope="col" key={day} data-weekend={index >= 5}>{day}<small>{shortDate(dates[index])}</small></th>)}<th scope="col">Week</th></tr></thead>
            <tbody>
              {operators.map(person => {
                const load = loads[person.id];
                return (
                  <tr key={person.id}>
                    <th scope="row">{person.nick}<small>{person.timeZone ? offsetLabel(person.timeZone, instantOf(weekStart, 12 * 60)) : 'no time zone'}</small></th>
                    {DAY_NAMES.map((day, index) => {
                      const wanted = requests[person.id]?.[index] ?? 'auto';
                      const shown: Cell | undefined = plan ? plan[person.id]?.[index] ?? 'off' : wanted === 'auto' ? undefined : wanted;
                      const shift = isShift(shown) ? templateById(shown.templateId) : undefined;
                      const own = clockMode === 'local' && shift && person.timeZone ? localShift(dates[index], shift, person.timeZone) : null;
                      const first = !isShift(shown) ? shown === 'vacation' ? 'vacation' : shown === 'off' ? 'off' : '·' : own ? own.range : shift?.label ?? shown.templateId;
                      const second = isShift(shown) ? kindName(shown.kind) : '';
                      // Without a time zone the hours stay Pacific, and the cell says so.
                      const pacific = clockMode === 'local' && !!shift && !person.timeZone;
                      const issue = issues.get(`${person.id}/${index}`);
                      const isSelected = selected?.operatorId === person.id && selected.day === index;
                      return (
                        <td key={day}>
                          <button type="button" className="csr-cell" data-cell={`${person.id}/${index}`} data-kind={isShift(shown) ? shown.kind : shown ?? 'empty'} data-issue={issue} data-selected={isSelected} aria-haspopup="dialog" aria-expanded={menu?.ref.operatorId === person.id && menu.ref.day === index}
                            aria-label={`${person.nick}, ${day} ${shortDate(dates[index])}: ${first}${own?.dayShift ? ` ${dayOffset(own.dayShift)} day` : ''}${pacific ? ' Pacific time' : ''} ${second}${wanted !== 'auto' ? ', pinned' : ''}${issue ? `, ${issue === 'fail' ? 'breaks a rule' : 'warning'}` : ''}`}
                            onClick={event => {
                              // Measured now: the event no longer knows its target by the time the state update runs.
                              const ref = { operatorId: person.id, day: index }, anchor = event.currentTarget.getBoundingClientRect();
                              onSelect(ref);
                              setMenu(current => current?.ref.operatorId === ref.operatorId && current.ref.day === ref.day ? null : { ref, anchor });
                            }}>
                            <span>{first}{own?.dayShift ? <sup>{dayOffset(own.dayShift)}</sup> : null}{pacific && <em>Pacific</em>}</span>{second && <small>{second}</small>}
                            {wanted !== 'auto' && <i className="csr-pin" aria-hidden="true">▣</i>}
                            {issue && <i className="csr-flag" aria-hidden="true">{MARK[issue]}</i>}
                          </button>
                        </td>
                      );
                    })}
                    <td className="csr-load" data-off={plan ? load.shifts !== load.required : false}>{plan ? <>{load.shifts} of {load.required}<small>{hours(load.paidMinutes)} hours</small></> : <>– of {load.required}</>}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr><th scope="row">People on shift</th>{DAY_NAMES.map((day, index) => <td key={day} data-off={plan ? counts[index].headcount !== targets[index].headcount : false}>{plan ? counts[index].headcount : '–'}<small>target {targets[index].headcount}</small></td>)}<td /></tr>
              <tr><th scope="row">of them non-voice</th>{DAY_NAMES.map((day, index) => <td key={day} data-off={plan ? counts[index].nonvoice !== targets[index].nonvoice : false}>{plan ? counts[index].nonvoice : '–'}<small>target {targets[index].nonvoice}</small></td>)}<td /></tr>
            </tfoot>
          </table>
        </div>
        <div className="csr-legend">
          <span><i data-kind="nv" /> Non-voice: the non-voice channels and calls, covers both lines</span>
          <span><i data-kind="v" /> Voice: calls only</span>
          <span>▣ set by hand, kept on rebuild</span>
          <span>× breaks a rule</span>
          <span>! warning</span>
          {clockMode === 'local' && <span><b>+1</b> starts on the next calendar day there</span>}
        </div>

        <div className="csr-detail">
          <section className="csr-editor" aria-label="Selected cell">
            <span className="ws-kicker">SELECTED CELL</span>
            {operator && selected ? (
              <>
                <strong>{operator.nick} · {DAY_NAMES[selected.day]}, {shortDate(dates[selected.day])}</strong>
                {template && isShift(cell) ? (
                  <p>{clock(template.start)} to {clock(template.end)} Pacific time, {kindName(cell.kind).toLowerCase()} shift.{' '}
                    {local ? <>For {operator.nick} that is <b>{local.range}</b>{local.dayShift ? <> on the {local.dayShift > 0 ? 'next' : 'previous'} calendar day</> : null} ({offsetLabel(operator.timeZone!, instantOf(dates[selected.day], template.start))}).</> : <>No time zone is set for {operator.nick}, so local hours are unknown.</>}</p>
                ) : <p>{cell === 'vacation' ? 'Vacation.' : cell === 'off' ? 'Day off.' : 'Nothing scheduled yet.'}</p>}
                {cellIssues.map(check => <p key={check.id} className={check.status === 'fail' ? 'ws-red' : 'ws-orange'}>{MARK[check.status]} {check.label}: {check.detail}</p>)}
                <p className="csr-hint">{request === 'auto' ? 'Click the cell to change it. What you set by hand is kept on every rebuild.' : 'Set by hand ▣. Click the cell to change it or to hand it back to the solver.'}</p>
                {plan && coverage.length > 0 && (
                  <div className="csr-coverage">
                    <span className="ws-kicker">PEOPLE ON EACH LINE · {DAY_NAMES[selected.day]}, {shortDate(dates[selected.day])}</span>
                    {(['voice', 'nonvoice'] as const).map(line => (
                      <div key={line} className="csr-coverage-row" role="img" aria-label={`${line === 'voice' ? 'Voice' : 'Non-voice'} line: between ${Math.min(...coverage.map(slot => slot[line].length))} and ${Math.max(...coverage.map(slot => slot[line].length))} operators through the day`}>
                        <b>{line === 'voice' ? 'Voice' : 'Non-voice'}</b>
                        <div>{coverage.map(slot => <i key={slot.start} data-level={Math.min(slot[line].length, 2)} title={`${clock(slot.start)}: ${slot[line].length}`}>{slot[line].length}</i>)}</div>
                      </div>
                    ))}
                    <div className="csr-coverage-row csr-coverage-axis" aria-hidden="true"><b /><div>{coverage.map(slot => <i key={slot.start}>{slot.start % 120 === 0 ? clock(slot.start) : ''}</i>)}</div></div>
                    <p className="csr-hint">One number per half hour, Pacific time. With 1 on a line, nobody there can leave for lunch or a break.</p>
                  </div>
                )}
              </>
            ) : <p className="csr-hint">Click a cell in the schedule to change it and to see its local hours here.</p>}
          </section>

          <section className="csr-checks-block" aria-label="Checks">
            <div className="csr-block-head"><span className="ws-kicker">CHECKS</span><span className="ws-kicker">{plan ? `${checks.filter(check => check.status === 'pass').length} of ${checks.length} pass` : 'no week yet'}</span></div>
            {plan ? (
              <ul className="csr-checks">
                {checks.map(check => (
                  <li key={check.id} data-status={check.status}>
                    <button type="button" aria-pressed={focusCheckId === check.id} disabled={!check.cells.length} onClick={() => onFocusCheck(focusCheckId === check.id ? null : check.id)}>
                      <span aria-hidden="true">{MARK[check.status]}</span>
                      <span><strong>{check.label}<span className="ws-sr-only">: {check.status === 'pass' ? 'passes' : check.status === 'warn' ? 'warning' : 'fails'}</span></strong><small>{check.detail}</small>{check.cells.length > 0 && <small className="csr-check-link">{focusCheckId === check.id ? 'Showing these cells in the schedule' : `Show ${check.cells.length} cell${check.cells.length === 1 ? '' : 's'} in the schedule`}</small>}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : <p className="csr-hint">Nothing to check yet. Build the week, or pin shifts by hand in the schedule.</p>}
          </section>
        </div>

        {plan && (
          <>
            <div className="ws-section-heading"><h3>Load through the week</h3><span className="ws-kicker">PAID HOURS EXCLUDE LUNCH</span></div>
            <div className="csr-grid-wrap">
              <table className="csr-loads">
                <thead><tr><th scope="col">Operator</th><th scope="col">Shifts</th><th scope="col">Paid hours</th><th scope="col">Voice</th><th scope="col">Non-voice</th><th scope="col">Early</th><th scope="col">Day</th><th scope="col">Late</th><th scope="col">Weekend</th></tr></thead>
                <tbody>
                  {operators.map(person => { const load = loads[person.id]; return (
                    <tr key={person.id}><th scope="row">{person.nick}</th><td data-off={load.shifts !== load.required}>{load.shifts} of {load.required}</td><td>{hours(load.paidMinutes)}</td><td>{load.voice}</td><td>{load.nonvoice}</td><td>{load.bands.early}</td><td>{load.bands.day}</td><td>{load.bands.late}</td><td>{load.weekend}</td></tr>
                  ); })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
      )}
      {menu && (() => {
        const person = operators.find(item => item.id === menu.ref.operatorId);
        if (!person) return null;
        // The pane is animated with a transform, and inside a transformed box "fixed" stops meaning
        // "fixed to the screen". The menu is therefore mounted on the page root, outside the pane.
        return createPortal(<CellMenu anchor={menu.anchor} title={`${person.nick} · ${DAY_NAMES[menu.ref.day]}, ${shortDate(dates[menu.ref.day])}`}
          cell={plan?.[person.id]?.[menu.ref.day]} pinned={(requests[person.id]?.[menu.ref.day] ?? 'auto') !== 'auto'}
          onPick={picked => { onRequest(person.id, menu.ref.day, picked); closeMenu(); }} onClose={closeMenu} />, document.querySelector('.workspace.csr') ?? document.body);
      })()}
    </>
  );
}
