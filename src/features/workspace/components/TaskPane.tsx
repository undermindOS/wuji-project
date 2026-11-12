import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { EXAMPLES } from '../data/examples.ts';
import { availabilityFor, dayLabel, durationMinutes, money, shiftCostMinor, timeLabel } from '../model/schedule.ts';
import type { Absence, DemoCheck, ExampleId, RunDetail, Scenario, ScenarioEvaluation, WorkspaceData, WorkspaceSnapshot } from '../model/types.ts';

interface TaskPaneProps {
  example: WorkspaceData;
  scenario: Scenario | null;
  checks: DemoCheck[];
  selectedShiftId: string | null;
  selectionSequence: number;
  draft: string;
  onDraftChange: (value: string) => void;
  onExampleChange: (id: ExampleId) => void;
  onShowResults: () => void;
  onOpenSource: () => void;
  snapshot?: WorkspaceSnapshot | null;
  absenceDraft?: Absence | null;
  onAbsenceChange?: (value: Absence | null) => void;
  onSaveTask?: () => void;
  onTaskVersionSelect?: (id: string) => void;
  saving?: boolean;
  saveError?: string | null;
  fixedDraft?: Record<string, string>;
  onFixedChange?: (value: Record<string, string>) => void;
  runControls?: ReactNode;
  run?: RunDetail | null;
  evaluation?:ScenarioEvaluation|null;
  intentControls?: ReactNode;
  inputDisabled?: boolean;
  objectiveDraft?: 'compare' | 'min_changes' | 'min_cost';
  onObjectiveChange?: (value: 'compare' | 'min_changes' | 'min_cost') => void;
}

export default function TaskPane({ example, scenario, checks, selectedShiftId, selectionSequence, draft, onDraftChange, onExampleChange, onShowResults, onOpenSource, snapshot, absenceDraft, onAbsenceChange, onSaveTask, onTaskVersionSelect, saving, saveError, fixedDraft = {}, onFixedChange, runControls, run, evaluation, intentControls, inputDisabled, objectiveDraft = 'compare', onObjectiveChange }: TaskPaneProps) {
  const evidenceRef = useRef<HTMLDivElement>(null);
  const { source, task } = example;
  const selected = source.shifts.find(shift => shift.id === selectedShiftId);
  const before = source.employees.find(employee => employee.id === selected?.employeeId);
  const after = source.employees.find(employee => selected && employee.id === scenario?.assignments[selected.id]);
  const availability = after && selected ? availabilityFor(after, selected.id, task, source) : null;
  const beforeCost = selected ? shiftCostMinor(selected, before) : null;
  const afterCost = selected ? shiftCostMinor(selected, after) : null;
  const unchanged = !!before && before.id === after?.id;
  const edited = draft !== task.request || (!!snapshot && (JSON.stringify(absenceDraft) !== JSON.stringify(task.absence)
    || JSON.stringify(Object.entries(fixedDraft).sort()) !== JSON.stringify(Object.entries(task.fixedAssignments ?? {}).sort()) || objectiveDraft !== (task.objective ?? 'compare')));
  const canSave = !!snapshot && source.id === snapshot.project.headSourceId && task.id === snapshot.project.headTaskId;
  const absenceEmployee = source.employees.find(employee => employee.id === task.absence?.employeeId);
  const availabilityRef = after && selected ? after.sourceRefs?.[`availability.${selected.id}`] : undefined;
  const rateRef = after?.sourceRefs?.ratePerHourMinor;
  const serverScenario = evaluation ?? run?.result?.scenarios.find(item => item.scenario.id === scenario?.id);
  const serverEvidence = serverScenario?.evidence.find(item => item.shiftId === selectedShiftId);
  useEffect(() => {
    if (selectionSequence > 0) evidenceRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selectionSequence]);
  return (
    <>
      <div className="ws-pane-heading"><span className="ws-kicker ws-orange">02 // INTENT</span><div><h2 id="task-heading">Task and evidence</h2><span className="ws-version">V{task.version ?? 1}</span></div></div>
      <div className="ws-pane-scroll ws-task-body">
        {!snapshot && <><label className="ws-field-label" htmlFor="demo-case">Example situation</label>
        <select id="demo-case" value={example.id} onChange={event => onExampleChange(event.target.value as ExampleId)}>
          {EXAMPLES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select></>}
        {snapshot && <><label className="ws-field-label" htmlFor="task-version">Saved constraints</label><select id="task-version" disabled={inputDisabled || saving} value={task.id} onChange={event => onTaskVersionSelect?.(event.target.value)}>{snapshot.tasks.map(version => <option key={version.id} value={version.id}>V{version.version} · {version.request.slice(0, 50)}</option>)}</select></>}
        <label className="ws-field-label" htmlFor="task-request">What needs to change?</label>
        <div className="ws-prompt-wrap"><span className="ws-prompt-symbol" aria-hidden="true">&gt;</span><textarea id="task-request" value={draft} disabled={inputDisabled || saving} maxLength={8000} onChange={event => onDraftChange(event.target.value)} rows={6} spellCheck={false} aria-describedby="request-help" /></div>
        <p id="request-help" className="ws-note">{snapshot ? 'Generate a draft from the text and confirm the constraints. Use the fields below to edit them explicitly. Calculations use the saved version.' : 'The demo opens prepared options for the selected example. Free-form requests require an AI connection.'}</p>
        {intentControls}
        {task.interpretation && <p className="ws-note ws-intent-origin">{task.interpretation.providerMode === 'test' ? 'Test response' : 'OpenAI'} · {task.interpretation.model}<br />Draft {task.interpretation.draftId.slice(0, 8)} confirmed on {new Date(task.interpretation.confirmedAt).toLocaleString('en-US')}.</p>}
        {snapshot && <><label className="ws-field-label" htmlFor="task-objective">Calculation priority</label><select id="task-objective" disabled={inputDisabled || saving} value={objectiveDraft} onChange={event => onObjectiveChange?.(event.target.value as 'compare' | 'min_changes' | 'min_cost')}><option value="compare">Compare priorities</option><option value="min_changes">Fewer reassignments</option><option value="min_cost">Lower pay</option></select></>}
        {snapshot && <div className="ws-absence-editor"><label className="ws-field-label" htmlFor="absence-employee">Employee absence · explicit constraint</label><select id="absence-employee" disabled={inputDisabled || saving} value={absenceDraft?.employeeId ?? ''} onChange={event => { const id = event.target.value; onAbsenceChange?.(id ? { employeeId: id, shiftIds: source.shifts.filter(shift => shift.employeeId === id).map(shift => shift.id) } : null); }}><option value="">No absence specified</option>{source.employees.map(employee => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select>{absenceDraft && <details><summary>Absent shifts · {absenceDraft.shiftIds.length}</summary><div className="ws-absence-shifts">{source.shifts.map(shift => <label key={shift.id}><input type="checkbox" disabled={inputDisabled || saving} checked={absenceDraft.shiftIds.includes(shift.id)} onChange={event => onAbsenceChange?.({ employeeId: absenceDraft.employeeId, shiftIds: (event.target.checked ? [...absenceDraft.shiftIds, shift.id] : absenceDraft.shiftIds.filter(id => id !== shift.id)).sort() })} /><span>{dayLabel(shift, source.timezone)} · {timeLabel(shift, source.timezone)}</span></label>)}</div></details>}<p className="ws-note">Absence applies to the selected shift intervals, including any overlapping shifts.</p></div>}
        {snapshot && Object.keys(task.fixedAssignments ?? {}).length > 0 && <details className="ws-fixed-editor"><summary>Pinned assignments in constraints · {Object.keys(fixedDraft).length}</summary>{Object.entries(task.fixedAssignments ?? {}).map(([sid, eid]) => <label key={sid}><input type="checkbox" disabled={inputDisabled || saving} checked={!!fixedDraft[sid]} onChange={event => { const next = { ...fixedDraft }; if (event.target.checked) next[sid] = eid; else delete next[sid]; onFixedChange?.(next); }} /><span>{sid} → {source.employees.find(e => e.id === eid)?.name}</span></label>)}</details>}
        {edited && <div className="ws-notice" role="status"><p>{snapshot ? 'There are unsaved constraints. The checks on the right refer to the saved version.' : 'The text has changed. The displayed options belong to the example’s original request.'}</p><button type="button" className="ws-text-button" disabled={inputDisabled || saving} onClick={() => { onDraftChange(task.request); onAbsenceChange?.(task.absence); onFixedChange?.(task.fixedAssignments ?? {}); onObjectiveChange?.(task.objective ?? 'compare'); }}>{snapshot ? 'Restore saved constraints ↺' : 'Restore example request ↺'}</button></div>}
        {snapshot && edited && <button type="button" className="ws-primary" disabled={!edited || !canSave || saving || inputDisabled || !draft.trim() || (!!absenceDraft && !absenceDraft.shiftIds.length)} onClick={onSaveTask}>{saving ? 'Saving constraints…' : 'Save new constraint version'} <span aria-hidden="true">→</span></button>}
        {runControls}
        <div className="ws-rule-heading"><span className="ws-kicker">REQUIRED CONSTRAINTS</span><span className="ws-kicker">{task.rules.length.toString().padStart(2, '0')}</span></div>
        <ul className="ws-rules">
          {task.rules.map(rule => <li key={rule.id}><span aria-hidden="true">▣</span><div><strong>{rule.label}</strong><small>{rule.detail}</small></div></li>)}
        </ul>
        {!intentControls && <div className="ws-provider">
          <div><label htmlFor="ai-provider">Provider</label><select id="ai-provider" disabled><option>Not connected</option></select></div>
          <div><label htmlFor="ai-model">Model</label><select id="ai-model" disabled><option>Unavailable</option></select></div>
        </div>}
        {snapshot ? <>{!canSave && <p className="ws-note">This historical version is available to view. Open the project’s current version to make changes.</p>}{saveError && <p className="ws-notice" role="alert">{saveError}</p>}<button type="button" className="ws-outline" onClick={onShowResults}>{run ? 'Open calculation result' : 'Open source validation'} <span aria-hidden="true">→</span></button></> : <button type="button" className="ws-primary" onClick={onShowResults} disabled={edited}>{example.conflict ? 'Show conflict' : `Open ${example.scenarios.length === 1 ? 'option' : 'options'}`} <span aria-hidden="true">→</span></button>}
        <p className="ws-analysis-cost">{snapshot ? 'Calculation, validation and provenance for the open version are shown separately. Model usage is recorded in the draft log.' : 'Demo options were prepared in advance.'}</p>

        <div className="ws-evidence" ref={evidenceRef} data-testid="evidence">
          <div className="ws-rule-heading"><span className="ws-kicker ws-orange">// TRACE THE CHANGE</span><span aria-hidden="true">↙</span></div>
          <h3>{example.conflict ? 'Conflict evidence' : unchanged ? 'Assignment evidence' : 'Change evidence'}</h3>
          {selected ? (
            <>
              <div className="ws-evidence-selected"><span>{dayLabel(selected, source.timezone)} · {timeLabel(selected, source.timezone)}</span><strong>{unchanged ? <>{before.name}<small>Assignment preserved</small></> : <>{before?.name ?? 'Unknown'} <span className="ws-orange">→</span> {after?.name ?? (example.conflict ? 'Constraint conflict' : 'Unassigned')}</>}</strong></div>
              <div className="ws-evidence-item"><span className="ws-evidence-tag">SOURCE</span><button type="button" className="ws-text-button" onClick={onOpenSource}>Row {selected.sourceRow} · {selected.id} ↖</button><p>{selected.role} · {durationMinutes(selected) / 60} h · source v{source.version}.</p>{selected.sourceRefs?.employee_id && <small>{selected.sourceRefs.employee_id.filename}{selected.sourceRefs.employee_id.sheet ? ` / ${selected.sourceRefs.employee_id.sheet}` : ''} · column {selected.sourceRefs.employee_id.column}</small>}</div>
              <div className="ws-evidence-item"><span className="ws-evidence-tag">CONSTRAINT</span><p>{example.conflict ? example.conflict.detail : scenario?.description ?? 'Select an option.'}</p>{task.absence?.shiftIds.includes(selected.id) && <small>{absenceEmployee?.name ?? 'Employee'} is absent during this shift. Constraints v{task.version ?? 1}.</small>}</div>
              {after && <div className="ws-evidence-item"><span className="ws-evidence-tag">CHECK</span><p className={availability === 'available' ? 'ws-green' : availability === 'unknown' ? 'ws-orange' : 'ws-red'}>{availability === 'available' ? `${after.name}: availability confirmed.` : availability === 'unknown' ? `${after.name}: availability unknown.` : `${after.name}: absent at this time.`}</p><small>{availabilityRef ? `Source: ${availabilityRef.filename}${availabilityRef.sheet ? ` / ${availabilityRef.sheet}` : ''} · row ${availabilityRef.row} · ${availabilityRef.column}; ${task.absence ? 'absence from the constraints is also applied.' : 'no absence specified.'}` : `Based on availability for shift ${selected.id} in the employee profile and the absence constraint.`}</small></div>}
              {after && <div className="ws-evidence-item"><span className="ws-evidence-tag">CALCULATION</span>{beforeCost !== null && afterCost !== null && before?.ratePerHourMinor != null && after.ratePerHourMinor !== null
                ? <><p className="ws-formula">{money(afterCost, source.currency)} − {money(beforeCost, source.currency)}</p><strong className="ws-orange">{money(afterCost - beforeCost, source.currency, true)}</strong><small>Difference in rounded pay for this shift. {rateRef ? `Rate: ${rateRef.filename}${rateRef.sheet ? ` / ${rateRef.sheet}` : ''} · row ${rateRef.row} · ${rateRef.column}.` : 'Rates come from team profiles.'}</small></>
                : <><p className="ws-orange">The pay difference is unknown.</p><small>The employee’s rate is required to calculate pay. A missing rate is not treated as zero.</small></>}
              </div>}
              {serverEvidence && <div className="ws-evidence-item"><span className="ws-evidence-tag">SERVER VALIDATION</span><p>{serverEvidence.checkIds.length} checks · {serverScenario?.validation.validatorVersion}</p><small>Constraints: {serverEvidence.ruleIds.join(', ')} · {serverEvidence.durationMinutes} min</small><details><summary>Source cell references · {serverEvidence.sourceRefs.length}</summary><ul className="ws-server-refs">{serverEvidence.sourceRefs.map((ref, index) => <li key={index}>{ref.filename}{ref.sheet ? ' / ' + ref.sheet : ''} · row {ref.row} · {ref.column}</li>)}</ul></details></div>}
              {checks.some(check => check.status !== 'pass' && check.shiftIds.includes(selected.id)) && <p className="ws-notice">A constraint for this shift is unverified or violated. See the option checks on the right.</p>}
            </>
          ) : <p className="ws-note">Select an assignment or change to see its source row, constraint and calculation.</p>}
        </div>
        <details className="ws-journal"><summary>{snapshot ? 'Open version history' : 'Example log'}</summary><ol>{snapshot ? <><li>Opened saved source v{source.version}: {source.shifts.length} shifts.</li><li>Constraints v{task.version}; {run ? 'calculation saved separately; the log is available on the right.' : 'the solver has not run yet.'}</li><li>{run?.result?.scenarios.length ? 'Option metrics and checks were calculated on the server.' : 'Source metrics and checks were calculated in the browser.'}</li></> : <><li>Opened synthetic source: {source.shifts.length} shifts.</li><li>Loaded prepared options: {example.scenarios.length}.</li><li>Example metrics and checks were calculated in the browser.</li></>}</ol></details>
      </div>
    </>
  );
}
