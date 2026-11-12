import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { dayLabel, getMetrics, money, overallStatus, timeLabel } from '../model/schedule.ts';
import { exportSourceUrl } from '../api/HttpWorkspaceClient.ts';
import type { DemoCheck, ReviewCandidate, RunDetail, Scenario, ScenarioEvaluation, ScenarioMetrics, WorkspaceData, WorkspaceSnapshot } from '../model/types.ts';
import ScheduleTable from './ScheduleTable';
import RunReport from './RunReport';

interface ScenarioPaneProps {
  example: WorkspaceData;
  scenario: Scenario | null;
  metrics: ScenarioMetrics | null;
  checks: DemoCheck[];
  selectedShiftId: string | null;
  requestEdited: boolean;
  onScenarioSelect: (id: string) => void;
  onShiftSelect: (id: string) => void;
  onReviewConflict: () => void;
  snapshot?: WorkspaceSnapshot | null;
  run?: RunDetail | null;
  calculated?: ScenarioEvaluation | null;
  manualVersion?:ReviewCandidate|null;
  baseScenarioId?:string;
  reviewBusy?:boolean;
  versionControls?:ReactNode;
  approvalControls?:ReactNode;
  fixing?: boolean;
  actionError?: string | null;
  onFixAssignments?: (ids: string[]) => void;
}

export default function ScenarioPane({ example, scenario, metrics, checks, selectedShiftId, requestEdited, onScenarioSelect, onShiftSelect, onReviewConflict, snapshot, run, calculated, manualVersion, baseScenarioId, reviewBusy, versionControls, approvalControls, fixing, actionError, onFixAssignments }: ScenarioPaneProps) {
  const { source } = example;
  const status = overallStatus(checks);
  const passed = checks.filter(check => check.status === 'pass').length;
  const [fixedIds, setFixedIds] = useState<string[]>([]);
  useEffect(() => setFixedIds([]), [calculated?.scenario.id]);
  const sourceOnly = !!snapshot && !calculated && !manualVersion;
  const unverified=!!manualVersion&&!manualVersion.validation;
  return (
    <>
      <div className="ws-pane-heading"><span className="ws-kicker ws-red">03 // {manualVersion?'REVISION':run ? 'CALCULATION' : snapshot ? 'REVIEW' : 'SCENARIO'}</span><div><h2 id="scenario-heading">{manualVersion?'Manual revision':run ? 'Calculation result' : snapshot ? 'Source validation' : 'Result option'}</h2><span className="ws-version">{manualVersion?'R'+manualVersion.revisionVersion:snapshot ? `V${source.version}` : 'DEMO'}</span></div></div>
      <div className="ws-pane-scroll">
        <div className="ws-result-disclaimer"><span aria-hidden="true">◇</span> {manualVersion?'Manual edit in a copy of the schedule. Nothing has been published.':run ? 'Calculation in a copy of the schedule. Nothing has been published.' : snapshot ? 'Saved source. No reassignments were calculated.' : 'Changes are shown in a copy of the schedule.'}</div>
        {run && (manualVersion?<details className="ws-base-run"><summary>Original OR-Tools run</summary><RunReport run={run} onShiftSelect={onShiftSelect}/></details>:<RunReport run={run} onShiftSelect={onShiftSelect} />)}
        {versionControls}
        {actionError && <p className="ws-notice" role="alert">{actionError}</p>}
        {requestEdited && <p className="ws-notice">{snapshot ? 'There are unsaved changes. Metrics and checks refer to the open saved version.' : 'The request has changed. This option belongs to the original example.'}</p>}
        {example.conflict ? (
          <div className="ws-conflict" role="status">
            <span className="ws-conflict-symbol" aria-hidden="true">×</span>
            <span className="ws-kicker ws-red">CONSTRAINT CONFLICT</span>
            <h3>{example.conflict.title}</h3><p>{example.conflict.detail}</p>
            <div className="ws-conflict-pair"><span>▣ The shift is pinned to Emily</span><span>× Emily is absent during this shift</span></div>
            <button type="button" className="ws-outline" onClick={onReviewConflict}>View evidence ↖</button>
            <p className="ws-note">This example shows a direct conflict between two constraints. The solver was not run.</p>
          </div>
        ) : scenario && metrics && (!run || !!calculated || !!manualVersion) ? (
          <>
            {(!snapshot || calculated || manualVersion) && <div className="ws-variant-picker" aria-label="Schedule options">
              {example.scenarios.map((item, index) => {
                const itemMetrics = run?.result?.scenarios.find(s => s.scenario.id === item.id)?.metrics ?? getMetrics(source, item);
                return <button type="button" key={item.id} className="ws-variant" aria-pressed={(baseScenarioId??scenario.id) === item.id} disabled={reviewBusy} onClick={() => onScenarioSelect(item.id)}><span className="ws-kicker">0{index + 1} {(baseScenarioId??scenario.id) === item.id ? '/ SELECTED' : '/ OPTION'}</span><strong>{item.label}</strong><span>{itemMetrics.changes.length} {itemMetrics.changes.length === 1 ? 'shift' : 'shifts'} · {money(itemMetrics.costDeltaMinor, source.currency, true)}</span></button>;
              })}
            </div>}
            <div className={`ws-validation ws-validation-${unverified?'unknown':status}`} role="status"><span aria-hidden="true">{unverified?'?':status === 'pass' ? '✓' : status === 'unknown' ? '?' : '×'}</span><div><strong>{unverified?'Manual revision not validated':status === 'pass' ? calculated ? 'Independent validation passed' : snapshot ? 'Supported constraints satisfied' : 'Example constraints satisfied' : status === 'unknown' ? 'Clarification required' : 'Some constraints are violated'}</strong><small>{unverified?'Metrics are preliminary. Approval is unavailable.':<>{calculated ? 'Server checks' : snapshot ? 'Source checks' : 'Example checks'}: {passed}/{checks.length}. {manualVersion?'The manual option was not optimized.':calculated ? calculated.searchStatus === 'OPTIMAL' ? 'Objective optimum proven with confirmed availability.' : 'A feasible solution was found; optimality was not proven.' : 'Optimality was not assessed.'}</>}</small></div></div>
            <div className="ws-metrics" aria-label="Option impact">
              <div><strong>{metrics.changes.length.toString().padStart(2, '0')}</strong><span>shifts changed</span></div>
              <div><strong>{metrics.affectedEmployeeIds.length.toString().padStart(2, '0')}</strong><span>people affected</span></div>
              <div className="ws-metric-cost"><strong>{money(metrics.costDeltaMinor, source.currency, true)}</strong><span>vs. original pay</span></div>
              <div><strong>{metrics.coveredShifts}<small>/{metrics.totalShifts}</small></strong><span>assigned shifts</span></div>
            </div>
            <div className="ws-cost-detail"><span>Weekly pay</span><strong>{money(metrics.costMinor, source.currency)}</strong><small>Original: {money(metrics.baselineCostMinor, source.currency)} · assigned {metrics.totalMinutes / 60} h</small></div>
            {metrics.unknownRateEmployeeIds.length > 0 && <div className="ws-notice"><strong>Total not calculated</strong><p>Unknown rate: {metrics.unknownRateEmployeeIds.map(id => source.employees.find(employee => employee.id === id)?.name).join(', ')}. Hours and reassignments are available.</p></div>}
            {calculated && <details className="ws-hours"><summary>Hours by employee · {metrics.totalMinutes / 60} h</summary><ul>{Object.entries(calculated.metrics.minutesByEmployee).map(([eid, minutes]) => <li key={eid}><span>{source.employees.find(e => e.id === eid)?.name}</span><strong>{minutes / 60} h / {(source.employees.find(e => e.id === eid)?.maxWeeklyMinutes ?? 0) / 60} h</strong></li>)}</ul></details>}
            <div className="ws-section-heading"><h3>{sourceOnly ? 'Calculation status' : 'What changed'}</h3><span className="ws-kicker">{metrics.changes.length.toString().padStart(2, '0')}</span></div>
            <div className="ws-changes">
              {metrics.changes.length ? metrics.changes.map((change, index) => {
                const shift = source.shifts.find(item => item.id === change.shiftId)!;
                const before = source.employees.find(employee => employee.id === change.beforeEmployeeId)!;
                const after = source.employees.find(employee => employee.id === change.afterEmployeeId)!;
                return <button type="button" className="ws-change" key={change.id} aria-pressed={selectedShiftId === change.shiftId} onClick={() => onShiftSelect(change.shiftId)} data-testid={`change-${change.shiftId}`}><span className="ws-change-index">0{index + 1}</span><span><small>{dayLabel(shift, source.timezone)} · {timeLabel(shift, source.timezone)}</small><strong><span className="ws-before">{before.name}</span><span className="ws-green"> → {after.name}</span></strong><small>Row {change.sourceRow} · view evidence</small></span><span className="ws-change-arrow" aria-hidden="true">↖</span></button>;
              }) : <div className="ws-unchanged"><span aria-hidden="true">=</span><p>{sourceOnly ? <>Original assignments preserved.<br />Start a calculation in the center panel.</> : <>No reassignments needed.<br />Original assignments preserved.</>}</p></div>}
            </div>
            {!unverified&&<details className="ws-checks"><summary>{calculated ? 'Server checks for this option' : snapshot ? 'Source checks' : 'Example checks'} <span>{passed}/{checks.length}</span></summary><ul>{checks.map(check => <li key={check.id} data-status={check.status}><span aria-hidden="true">{check.status === 'pass' ? '✓' : check.status === 'unknown' ? '?' : '×'}</span><div><strong>{check.label}</strong><small>{check.detail}</small></div></li>)}</ul><p className="ws-note">{calculated ? calculated.validation.validatorVersion + ': assignments rechecked independently of the CP-SAT model.' : snapshot ? 'Only supported constraints from the saved task version are checked.' : 'Only the stated rules of the synthetic example are checked.'} Compliance with all labor regulations is not assessed.</p></details>}
            <details className="ws-updated-schedule"><summary>{sourceOnly ? 'Saved schedule' : 'Option schedule'} <span>{source.shifts.length} shifts</span></summary><ScheduleTable source={source} task={example.task} assignments={scenario.assignments} selectedShiftId={selectedShiftId} onSelect={onShiftSelect} view="scenario" /></details>
            {calculated && !manualVersion && metrics.changes.length > 0 && <details className="ws-partial"><summary>Pin part of this option</summary><p className="ws-note">Selected assignments become required constraints in a new version. The remaining shifts will be recalculated.</p>{metrics.changes.map(change => <label key={change.shiftId}><input type="checkbox" checked={fixedIds.includes(change.shiftId)} onChange={event => setFixedIds(ids => event.target.checked ? [...ids, change.shiftId] : ids.filter(id => id !== change.shiftId))} /><span>{change.shiftId} → {source.employees.find(e => e.id === change.afterEmployeeId)?.name}</span></label>)}<button type="button" className="ws-primary" disabled={!fixedIds.length || fixing || requestEdited || !run?.isCurrent} onClick={() => onFixAssignments?.(fixedIds)}>Save pinned assignments and recalculate →</button>{!run?.isCurrent && <p className="ws-note">Pinning is available for the project’s current constraints.</p>}</details>}
            {!snapshot && <div className="ws-final-actions"><button type="button" className="ws-primary" disabled>Approve option <span aria-hidden="true">→</span></button><button type="button" className="ws-outline" disabled>Export ↓</button><p>Approval and result export are not available yet. No changes have been made in any external system.</p></div>}
          </>
        ) : null}
        {approvalControls}
        {snapshot && <div className="ws-source-export"><h3>Export source V{source.version}</h3><div><a className="ws-outline" href={exportSourceUrl(snapshot.project.id, source.id, 'csv')} download>CSV bundle ↓</a><a className="ws-outline" href={exportSourceUrl(snapshot.project.id, source.id, 'xlsx')} download>XLSX ↓</a></div><p className="ws-note">Downloads the saved source with employees, availability and metadata. Exporting does not approve or publish a new schedule.</p></div>}
      </div>
    </>
  );
}
