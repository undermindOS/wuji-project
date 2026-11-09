import { useState } from 'react';
import type { useScenarioReview } from '../api/useScenarioReview';
import type { ApprovalDetail, WorkspaceSnapshot } from '../model/types';
import { canApproveCandidate } from '../model/review';
import { dayLabel, timeLabel } from '../model/schedule';

type State=ReturnType<typeof useScenarioReview>;
interface Props {state:State;snapshot:WorkspaceSnapshot;requestEdited:boolean}
const date=(value:string)=>new Date(value).toLocaleString('ru-RU',{timeZoneName:'short'});
const candidateLabel=(candidate:NonNullable<State['candidate']>)=>candidate.origin==='solver'?'Расчёт · '+candidate.scenario.label:
  'R'+candidate.revisionVersion+' · '+(!candidate.validation?'Не проверено':candidate.validation.status==='pass'?'Проверено':candidate.validation.status==='unknown'?'Нужно уточнение':'Нарушены условия');

export function ScenarioVersionControls({state,snapshot,requestEdited}:Props) {
  const candidate=state.candidate;
  const [shiftId,setShiftId]=useState('');
  const shift=snapshot.source.shifts.find(s=>s.id===shiftId)??snapshot.source.shifts.find(s=>s.id===snapshot.task.absence?.shiftIds[0])??snapshot.source.shifts[0];
  const current=!!state.review?.isCurrent&&snapshot.source.id===snapshot.project.headSourceId&&snapshot.task.id===snapshot.project.headTaskId;
  return <div className="ws-review-versions">
    {state.error&&<p className="ws-notice" role="alert">{state.error}</p>}
    {candidate&&<>
      <label className="ws-field-label" htmlFor="scenario-version">Версия варианта</label>
      <select id="scenario-version" value={candidate.id} disabled={!!state.busy||state.loading} onChange={event=>state.select(event.target.value)}>
        {state.review?.candidates.filter(c=>c.baseScenarioId===candidate.baseScenarioId).map(c=><option key={c.id} value={c.id}>{candidateLabel(c)}</option>)}
      </select>
      {candidate.origin==='manual'&&<p className="ws-notice" role="status">{candidate.validation?'Ручной вариант. Статус относится к независимой проверке; оптимизация не выполнялась.':'НОВАЯ РУЧНАЯ ВЕРСИЯ · серверная проверка ещё не выполнена. Утверждение недоступно.'}</p>}
      {state.editorDirty&&<p className="ws-notice" role="status">Есть несохранённые назначения. Метрики и проверки относятся к открытой сохранённой версии.</p>}
      <details className="ws-review-editor"><summary>Изменить назначения</summary>
        <p className="ws-note">Правка создаёт отдельную ручную версию. После сохранения нужна новая серверная проверка всех условий.</p>
        <label className="ws-field-label" htmlFor="revision-shift">Смена для правки</label>
        <select id="revision-shift" value={shift?.id??''} disabled={!!state.busy} onChange={event=>setShiftId(event.target.value)}>
          {snapshot.source.shifts.map(s=><option key={s.id} value={s.id}>{s.id} · {dayLabel(s,snapshot.source.timezone)} · {timeLabel(s,snapshot.source.timezone)}</option>)}
        </select>
        <label className="ws-field-label" htmlFor="revision-employee">Назначенный сотрудник</label>
        <select id="revision-employee" value={shift?state.assignments[shift.id]:''} disabled={!!state.busy||!current||requestEdited} onChange={event=>shift&&state.setAssignment(shift.id,event.target.value)}>
          {snapshot.source.employees.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        {shift&&<p className="ws-note">{shift.role}{shift.pinned?' · закрепление исходника':''}. Доступность, роли, часы и пересечения проверяются после сохранения.</p>}
        {state.editorDirty&&<ul className="ws-revision-changes">{Object.entries(state.assignments).filter(([id,value])=>candidate.scenario.assignments[id]!==value).map(([id,value])=><li key={id}>{id}: {snapshot.source.employees.find(e=>e.id===candidate.scenario.assignments[id])?.name} → {snapshot.source.employees.find(e=>e.id===value)?.name}</li>)}</ul>}
        <button type="button" className="ws-outline" disabled={!state.editorDirty||!!state.busy||state.loading||!current||requestEdited} onClick={()=>void state.save()}>{state.busy==='save'?'Сохраняем версию…':'Сохранить ручную версию'} <span aria-hidden="true">→</span></button>
        {state.editorDirty&&<button type="button" className="ws-text-button" disabled={!!state.busy} onClick={state.resetDraft}>Отменить несохранённую правку ↺</button>}
      </details>
      {candidate.origin==='manual'&&!candidate.validation&&<button type="button" className="ws-primary" disabled={!!state.busy||state.loading||state.editorDirty||!current||requestEdited} onClick={()=>void state.validate()}>{state.busy==='validate'?'Проверяем назначения…':'Проверить ручную версию'} <span aria-hidden="true">→</span></button>}
      {!current&&<p className="ws-note">Исторические входные версии. Для новой правки или утверждения нужен расчёт текущих условий.</p>}
      <details className="ws-review-provenance"><summary>Происхождение версии</summary><p className="ws-note">Исходник V{snapshot.source.version} · условия V{snapshot.task.version}<br />{candidate.origin==='solver'?'OR-Tools':'Ручная правка'} · {date(candidate.createdAt)}<br />Версия {candidate.id.slice(0,8)} · SHA-256 {candidate.candidateHash.slice(0,16)}…<br />{candidate.validatedAt?'Проверено '+date(candidate.validatedAt):'Серверная проверка не выполнялась.'}</p></details>
    </>}
    <button type="button" className="ws-text-button" disabled={!!state.busy||state.loading} onClick={state.refresh}>Обновить версии и утверждения ↻</button>
  </div>;
}

function PreparedFiles({state,approval}: {state:State;approval:ApprovalDetail}) {
  return <div className="ws-approved-files">
    {approval.exports.map(file=><div className="ws-approved-file" key={file.id}>
      <strong>{file.format==='csv'?'CSV-набор':'XLSX'} · файл подготовлен</strong>
      <small>{file.filename}<br />{new Intl.NumberFormat('ru-RU').format(file.size)} байт · SHA-256 {file.sha256.slice(0,16)}…</small>
      <button type="button" className="ws-outline" disabled={!!state.busy} onClick={()=>void state.download(file)}>{state.busy==='download'?'Получаем файл…':'Скачать '+(file.format==='csv'?'CSV-набор':'XLSX')} <span aria-hidden="true">↓</span></button>
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
    <div className="ws-rule-heading"><span className="ws-kicker ws-orange">// УТВЕРЖДЕНИЕ И ВЫДАЧА</span><span className="ws-kicker">ЛОКАЛЬНО</span></div>
    {state.error&&<p className="ws-notice" role="alert">{state.error}</p>}
    {candidate&&<>
      {approval?<div className="ws-approved-status" role="status"><strong>Вариант утверждён</strong><span>{date(approval.approvedAt)} · {approval.id.slice(0,8)}</span><small>Исходник V{approval.sourceVersion} · условия V{approval.taskVersion} · {candidateLabel(candidate)}</small></div>:<>
        <p className="ws-note">Утверждение фиксирует показанную версию назначений, исходник и условия. Выдача файла выполняется отдельно.</p>
        <label className="ws-approval-ack"><input type="checkbox" checked={accepted===target} disabled={!canApprove||!!state.busy||state.loading} onChange={event=>setAccepted(event.target.checked?target:null)} /><span>Я проверил назначения и условия этой версии.</span></label>
        {unknown&&<label className="ws-approval-ack"><input type="checkbox" checked={unknownAccepted===target} disabled={!canApprove||!!state.busy||state.loading} onChange={event=>setUnknownAccepted(event.target.checked?target:null)} /><span>Оплата неизвестна. Подтверждаю вариант без денежного итога.</span></label>}
        <button type="button" className="ws-primary" disabled={!canApprove||accepted!==target||(unknown&&unknownAccepted!==target)||!!state.busy||state.loading} onClick={()=>void state.approve(unknownAccepted===target)}>{state.busy==='approve'?'Фиксируем утверждение…':'Утвердить эту версию'} <span aria-hidden="true">→</span></button>
        {!canApprove&&<p className="ws-note">Нужны текущие сохранённые входы и пройденная серверная проверка выбранной версии.</p>}
      </>}
      {approval&&<>
        <p className="ws-note">Файл включает расписание, команду, доступность, условия, метрики и протокол проверки. Отсутствие и дополнительные закрепления сохраняются для повторного импорта.</p>
        <div className="ws-export-actions">{(['csv','xlsx'] as const).filter(format=>!approval.exports.some(file=>file.format===format)).map(format=><button type="button" className="ws-outline" key={format} disabled={!!state.busy||state.loading||requestEdited||state.editorDirty} onClick={()=>void state.prepare(approval,format)}>{state.busy==='export'?'Готовим файл…':'Подготовить '+(format==='csv'?'CSV-набор':'XLSX')} <span aria-hidden="true">↓</span></button>)}</div>
        <PreparedFiles state={state} approval={approval} />
      </>}
    </>}
    <p className="ws-note">Утверждение сохраняется в WUJI. Подготовка файла выполняется отдельно. Расписание во внешней системе не опубликовано.</p>
    {state.approvals.length>0&&<details className="ws-approval-history"><summary>История утверждений · {state.approvals.length}</summary>
      <label className="ws-field-label" htmlFor="approval-history">Сохранённое утверждение</label>
      <select id="approval-history" value={historic?.id??''} disabled={!!state.busy} onChange={event=>setHistoryId(event.target.value)}>{state.approvals.map(a=><option key={a.id} value={a.id}>V{a.sourceVersion}/T{a.taskVersion} · {a.scenarioLabel} · {a.isCurrent&&a.isSelected?'текущее':'история'} · {date(a.approvedAt)}</option>)}</select>
      {historic&&<><p className="ws-note">{historic.isCurrent&&historic.isSelected?'Текущее утверждение.':!historic.isCurrent?'Историческое утверждение: исходник или условия уже изменились.':'Ранее утверждённый вариант; сейчас выбран другой.'}<br />Версия {historic.scenarioId.slice(0,8)} · SHA-256 {historic.candidateHash.slice(0,16)}…<br />{historic.exports.length?'Готовые файлы сохраняют прежнюю версию.':'Файлы для этого утверждения ещё не готовились.'}</p><PreparedFiles state={state} approval={historic} /></>}
    </details>}
  </div>;
}
