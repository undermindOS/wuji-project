import { useState } from 'react';
import type { useScenarioReview } from '../api/useScenarioReview';
import type { ApprovalDetail, WorkspaceSnapshot } from '../model/types';
import { canApproveCandidate } from '../model/review';
import { dayLabel, timeLabel } from '../model/schedule';

type State=ReturnType<typeof useScenarioReview>;
interface Props {state:State;snapshot:WorkspaceSnapshot;requestEdited:boolean}
const date=(value:string)=>new Date(value).toLocaleString('en-US',{timeZoneName:'short'});
const candidateLabel=(candidate:NonNullable<State['candidate']>)=>candidate.origin==='solver'?'Calculation · '+candidate.scenario.label:
  'R'+candidate.revisionVersion+' · '+(!candidate.validation?'Not validated':candidate.validation.status==='pass'?'Validated':candidate.validation.status==='unknown'?'Clarification needed':'Constraints violated');

export function ScenarioVersionControls({state,snapshot,requestEdited}:Props) {
  const candidate=state.candidate;
  const [shiftId,setShiftId]=useState('');
  const shift=snapshot.source.shifts.find(s=>s.id===shiftId)??snapshot.source.shifts.find(s=>s.id===snapshot.task.absence?.shiftIds[0])??snapshot.source.shifts[0];
  const current=!!state.review?.isCurrent&&snapshot.source.id===snapshot.project.headSourceId&&snapshot.task.id===snapshot.project.headTaskId;
  return <div className="ws-review-versions">
    {state.error&&<p className="ws-notice" role="alert">{state.error}</p>}
    {candidate&&<>
      <label className="ws-field-label" htmlFor="scenario-version">Option version</label>
      <select id="scenario-version" value={candidate.id} disabled={!!state.busy||state.loading} onChange={event=>state.select(event.target.value)}>
        {state.review?.candidates.filter(c=>c.baseScenarioId===candidate.baseScenarioId).map(c=><option key={c.id} value={c.id}>{candidateLabel(c)}</option>)}
      </select>
      {candidate.origin==='manual'&&<p className="ws-notice" role="status">{candidate.validation?'Manual option. The status reflects independent validation; no optimization was performed.':'NEW MANUAL REVISION · server validation has not run yet. Approval is unavailable.'}</p>}
      {state.editorDirty&&<p className="ws-notice" role="status">There are unsaved assignments. Metrics and checks refer to the open saved version.</p>}
      <details className="ws-review-editor"><summary>Edit assignments</summary>
        <p className="ws-note">Editing creates a separate manual revision. After saving, run server validation again for all constraints.</p>
        <label className="ws-field-label" htmlFor="revision-shift">Shift to edit</label>
        <select id="revision-shift" value={shift?.id??''} disabled={!!state.busy} onChange={event=>setShiftId(event.target.value)}>
          {snapshot.source.shifts.map(s=><option key={s.id} value={s.id}>{s.id} · {dayLabel(s,snapshot.source.timezone)} · {timeLabel(s,snapshot.source.timezone)}</option>)}
        </select>
        <label className="ws-field-label" htmlFor="revision-employee">Assigned employee</label>
        <select id="revision-employee" value={shift?state.assignments[shift.id]:''} disabled={!!state.busy||!current||requestEdited} onChange={event=>shift&&state.setAssignment(shift.id,event.target.value)}>
          {snapshot.source.employees.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        {shift&&<p className="ws-note">{shift.role}{shift.pinned?' · pinned in source':''}. Availability, roles, hours and overlaps are checked after saving.</p>}
        {state.editorDirty&&<ul className="ws-revision-changes">{Object.entries(state.assignments).filter(([id,value])=>candidate.scenario.assignments[id]!==value).map(([id,value])=><li key={id}>{id}: {snapshot.source.employees.find(e=>e.id===candidate.scenario.assignments[id])?.name} → {snapshot.source.employees.find(e=>e.id===value)?.name}</li>)}</ul>}
        <button type="button" className="ws-outline" disabled={!state.editorDirty||!!state.busy||state.loading||!current||requestEdited} onClick={()=>void state.save()}>{state.busy==='save'?'Saving version…':'Save manual revision'} <span aria-hidden="true">→</span></button>
        {state.editorDirty&&<button type="button" className="ws-text-button" disabled={!!state.busy} onClick={state.resetDraft}>Discard unsaved edit ↺</button>}
      </details>
      {candidate.origin==='manual'&&!candidate.validation&&<button type="button" className="ws-primary" disabled={!!state.busy||state.loading||state.editorDirty||!current||requestEdited} onClick={()=>void state.validate()}>{state.busy==='validate'?'Validating assignments…':'Validate manual revision'} <span aria-hidden="true">→</span></button>}
      {!current&&<p className="ws-note">Historical input versions. A run using the current constraints is required for a new edit or approval.</p>}
      <details className="ws-review-provenance"><summary>Version provenance</summary><p className="ws-note">Source V{snapshot.source.version} · constraints V{snapshot.task.version}<br />{candidate.origin==='solver'?'OR-Tools':'Manual edit'} · {date(candidate.createdAt)}<br />Version {candidate.id.slice(0,8)} · SHA-256 {candidate.candidateHash.slice(0,16)}…<br />{candidate.validatedAt?'Validated '+date(candidate.validatedAt):'Server validation has not run.'}</p></details>
    </>}
    <button type="button" className="ws-text-button" disabled={!!state.busy||state.loading} onClick={state.refresh}>Refresh revisions and approvals ↻</button>
  </div>;
}

function PreparedFiles({state,approval}: {state:State;approval:ApprovalDetail}) {
  return <div className="ws-approved-files">
    {approval.exports.map(file=><div className="ws-approved-file" key={file.id}>
      <strong>{file.format==='csv'?'CSV bundle':'XLSX'} · file prepared</strong>
      <small>{file.filename}<br />{new Intl.NumberFormat('en-US').format(file.size)} bytes · SHA-256 {file.sha256.slice(0,16)}…</small>
      <button type="button" className="ws-outline" disabled={!!state.busy} onClick={()=>void state.download(file)}>{state.busy==='download'?'Retrieving file…':'Download '+(file.format==='csv'?'CSV bundle':'XLSX')} <span aria-hidden="true">↓</span></button>
    </div>)}
  </div>;
}

export function ScenarioApprovalControls({state,snapshot,requestEdited}:Props) {
  const candidate=state.candidate;
  const [accepted,setAccepted]=useState<string|null>(null);
  const [unknownAccepted,setUnknownAccepted]=useState<string|null>(null);
  const [historyId,setHistoryId]=useState('');
  const target=state.scope+'/'+candidate?.candidateHash;
  const unknown=candidate?.metrics?.costMinor===null;
  const approval=state.currentApproval;
  const canApprove=canApproveCandidate(candidate,state.review,snapshot,requestEdited||state.editorDirty);
  const historic=state.approvals.find(a=>a.id===historyId)??state.approvals[0];
  return <div className="ws-final-actions ws-approval-controls">
    <div className="ws-rule-heading"><span className="ws-kicker ws-orange">// APPROVAL AND EXPORT</span><span className="ws-kicker">LOCAL</span></div>
    {state.error&&<p className="ws-notice" role="alert">{state.error}</p>}
    {candidate&&<>
      {approval?<div className="ws-approved-status" role="status"><strong>Option approved</strong><span>{date(approval.approvedAt)} · {approval.id.slice(0,8)}</span><small>Source V{approval.sourceVersion} · constraints V{approval.taskVersion} · {candidateLabel(candidate)}</small></div>:<>
        <p className="ws-note">Approval records the displayed assignments, source and constraints. File export is a separate step.</p>
        <label className="ws-approval-ack"><input type="checkbox" checked={accepted===target} disabled={!canApprove||!!state.busy||state.loading} onChange={event=>setAccepted(event.target.checked?target:null)} /><span>I have reviewed the assignments and constraints in this version.</span></label>
        {unknown&&<label className="ws-approval-ack"><input type="checkbox" checked={unknownAccepted===target} disabled={!canApprove||!!state.busy||state.loading} onChange={event=>setUnknownAccepted(event.target.checked?target:null)} /><span>Pay is unknown. I approve this option without a monetary total.</span></label>}
        <button type="button" className="ws-primary" disabled={!canApprove||accepted!==target||(unknown&&unknownAccepted!==target)||!!state.busy||state.loading} onClick={()=>void state.approve(unknownAccepted===target)}>{state.busy==='approve'?'Recording approval…':'Approve this version'} <span aria-hidden="true">→</span></button>
        {!canApprove&&<p className="ws-note">Current saved inputs and successful server validation of the selected version are required.</p>}
      </>}
      {approval&&<>
        <p className="ws-note">The file includes the schedule, team, availability, constraints, metrics and validation report. Absence and additional pinned assignments are preserved for reimport.</p>
        <div className="ws-export-actions">{(['csv','xlsx'] as const).filter(format=>!approval.exports.some(file=>file.format===format)).map(format=><button type="button" className="ws-outline" key={format} disabled={!!state.busy||state.loading||requestEdited||state.editorDirty} onClick={()=>void state.prepare(approval,format)}>{state.busy==='export'?'Preparing file…':'Prepare '+(format==='csv'?'CSV bundle':'XLSX')} <span aria-hidden="true">↓</span></button>)}</div>
        <PreparedFiles state={state} approval={approval} />
      </>}
    </>}
    <p className="ws-note">Approval is saved in WUJI. File preparation is a separate step. The schedule has not been published to an external system.</p>
    {state.approvals.length>0&&<details className="ws-approval-history"><summary>Approval history · {state.approvals.length}</summary>
      <label className="ws-field-label" htmlFor="approval-history">Saved approval</label>
      <select id="approval-history" value={historic?.id??''} disabled={!!state.busy} onChange={event=>setHistoryId(event.target.value)}>{state.approvals.map(a=><option key={a.id} value={a.id}>V{a.sourceVersion}/T{a.taskVersion} · {a.scenarioLabel} · {a.isCurrent&&a.isSelected?'current':'history'} · {date(a.approvedAt)}</option>)}</select>
      {historic&&<><p className="ws-note">{historic.isCurrent&&historic.isSelected?'Current approval.':!historic.isCurrent?'Historical approval: the source or constraints have changed.':'Previously approved option; a different option is now selected.'}<br />Version {historic.scenarioId.slice(0,8)} · SHA-256 {historic.candidateHash.slice(0,16)}…<br />{historic.exports.length?'Prepared files preserve the earlier version.':'No files have been prepared for this approval yet.'}</p><PreparedFiles state={state} approval={historic} /></>}
    </details>}
  </div>;
}
