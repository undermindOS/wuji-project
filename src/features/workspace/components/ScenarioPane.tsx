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
      <div className="ws-pane-heading"><span className="ws-kicker ws-red">03 // {manualVersion?'REVISION':run ? 'CALCULATION' : snapshot ? 'REVIEW' : 'SCENARIO'}</span><div><h2 id="scenario-heading">{manualVersion?'Ручная версия':run ? 'Результат расчёта' : snapshot ? 'Проверка исходника' : 'Вариант результата'}</h2><span className="ws-version">{manualVersion?'R'+manualVersion.revisionVersion:snapshot ? `V${source.version}` : 'ДЕМО'}</span></div></div>
      <div className="ws-pane-scroll">
        <div className="ws-result-disclaimer"><span aria-hidden="true">◇</span> {manualVersion?'Ручная правка в копии расписания. Ничего не опубликовано.':run ? 'Расчёт в копии расписания. Ничего не опубликовано.' : snapshot ? 'Сохранённый исходник. Перестановки не рассчитывались.' : 'Изменения показаны в копии расписания.'}</div>
        {run && (manualVersion?<details className="ws-base-run"><summary>Исходный расчёт OR-Tools</summary><RunReport run={run} onShiftSelect={onShiftSelect}/></details>:<RunReport run={run} onShiftSelect={onShiftSelect} />)}
        {versionControls}
        {actionError && <p className="ws-notice" role="alert">{actionError}</p>}
        {requestEdited && <p className="ws-notice">{snapshot ? 'Есть несохранённые изменения. Метрики и проверка относятся к открытой сохранённой версии.' : 'Запрос изменён. Здесь показан вариант исходного примера.'}</p>}
        {example.conflict ? (
          <div className="ws-conflict" role="status">
            <span className="ws-conflict-symbol" aria-hidden="true">×</span>
            <span className="ws-kicker ws-red">КОНФЛИКТ УСЛОВИЙ</span>
            <h3>{example.conflict.title}</h3><p>{example.conflict.detail}</p>
            <div className="ws-conflict-pair"><span>▣ Смена закреплена за Анной</span><span>× Анна отсутствует в эту смену</span></div>
            <button type="button" className="ws-outline" onClick={onReviewConflict}>Открыть основания ↖</button>
            <p className="ws-note">Пример показывает прямое противоречие двух условий. Поиск решателем не запускался.</p>
          </div>
        ) : scenario && metrics && (!run || !!calculated || !!manualVersion) ? (
          <>
            {(!snapshot || calculated || manualVersion) && <div className="ws-variant-picker" aria-label="Варианты расписания">
              {example.scenarios.map((item, index) => {
                const itemMetrics = run?.result?.scenarios.find(s => s.scenario.id === item.id)?.metrics ?? getMetrics(source, item);
                return <button type="button" key={item.id} className="ws-variant" aria-pressed={(baseScenarioId??scenario.id) === item.id} disabled={reviewBusy} onClick={() => onScenarioSelect(item.id)}><span className="ws-kicker">0{index + 1} {(baseScenarioId??scenario.id) === item.id ? '/ ВЫБРАН' : '/ ВАРИАНТ'}</span><strong>{item.label}</strong><span>{itemMetrics.changes.length} {itemMetrics.changes.length === 1 ? 'смена' : 'смены'} · {money(itemMetrics.costDeltaMinor, source.currency, true)}</span></button>;
              })}
            </div>}
            <div className={`ws-validation ws-validation-${unverified?'unknown':status}`} role="status"><span aria-hidden="true">{unverified?'?':status === 'pass' ? '✓' : status === 'unknown' ? '?' : '×'}</span><div><strong>{unverified?'Ручная версия не проверена':status === 'pass' ? calculated ? 'Независимая проверка пройдена' : snapshot ? 'Поддержанные условия соблюдены' : 'Условия примера соблюдены' : status === 'unknown' ? 'Требуется уточнение' : 'Есть нарушения условий'}</strong><small>{unverified?'Метрики предварительные. Утверждение недоступно.':<>{calculated ? 'Серверные проверки' : snapshot ? 'Проверки исходника' : 'Проверки примера'}: {passed}/{checks.length}. {manualVersion?'Оптимизация ручного варианта не выполнялась.':calculated ? calculated.searchStatus === 'OPTIMAL' ? 'Оптимум приоритета доказан при подтверждённой доступности.' : 'Допустимое решение найдено; оптимум не доказан.' : 'Оптимальность не оценивалась.'}</>}</small></div></div>
            <div className="ws-metrics" aria-label="Последствия варианта">
              <div><strong>{metrics.changes.length.toString().padStart(2, '0')}</strong><span>изменённых смен</span></div>
              <div><strong>{metrics.affectedEmployeeIds.length.toString().padStart(2, '0')}</strong><span>затронутых людей</span></div>
              <div className="ws-metric-cost"><strong>{money(metrics.costDeltaMinor, source.currency, true)}</strong><span>к исходной оплате</span></div>
              <div><strong>{metrics.coveredShifts}<small>/{metrics.totalShifts}</small></strong><span>смен с назначением</span></div>
            </div>
            <div className="ws-cost-detail"><span>Оплата недели</span><strong>{money(metrics.costMinor, source.currency)}</strong><small>Исходная: {money(metrics.baselineCostMinor, source.currency)} · назначено {metrics.totalMinutes / 60} ч</small></div>
            {metrics.unknownRateEmployeeIds.length > 0 && <div className="ws-notice"><strong>Сумма не рассчитана</strong><p>Неизвестна ставка: {metrics.unknownRateEmployeeIds.map(id => source.employees.find(employee => employee.id === id)?.name).join(', ')}. Часы и перестановки доступны.</p></div>}
            {calculated && <details className="ws-hours"><summary>Часы по сотрудникам · {metrics.totalMinutes / 60} ч</summary><ul>{Object.entries(calculated.metrics.minutesByEmployee).map(([eid, minutes]) => <li key={eid}><span>{source.employees.find(e => e.id === eid)?.name}</span><strong>{minutes / 60} ч / {(source.employees.find(e => e.id === eid)?.maxWeeklyMinutes ?? 0) / 60} ч</strong></li>)}</ul></details>}
            <div className="ws-section-heading"><h3>{sourceOnly ? 'Состояние расчёта' : 'Что изменилось'}</h3><span className="ws-kicker">{metrics.changes.length.toString().padStart(2, '0')}</span></div>
            <div className="ws-changes">
              {metrics.changes.length ? metrics.changes.map((change, index) => {
                const shift = source.shifts.find(item => item.id === change.shiftId)!;
                const before = source.employees.find(employee => employee.id === change.beforeEmployeeId)!;
                const after = source.employees.find(employee => employee.id === change.afterEmployeeId)!;
                return <button type="button" className="ws-change" key={change.id} aria-pressed={selectedShiftId === change.shiftId} onClick={() => onShiftSelect(change.shiftId)} data-testid={`change-${change.shiftId}`}><span className="ws-change-index">0{index + 1}</span><span><small>{dayLabel(shift, source.timezone)} · {timeLabel(shift, source.timezone)}</small><strong><span className="ws-before">{before.name}</span><span className="ws-green"> → {after.name}</span></strong><small>Строка {change.sourceRow} · открыть основания</small></span><span className="ws-change-arrow" aria-hidden="true">↖</span></button>;
              }) : <div className="ws-unchanged"><span aria-hidden="true">=</span><p>{sourceOnly ? <>Исходные назначения сохранены.<br />Запустите расчёт в центральной области.</> : <>Перестановки не нужны.<br />Исходные назначения сохранены.</>}</p></div>}
            </div>
            {!unverified&&<details className="ws-checks"><summary>{calculated ? 'Серверные проверки варианта' : snapshot ? 'Проверки исходника' : 'Проверки примера'} <span>{passed}/{checks.length}</span></summary><ul>{checks.map(check => <li key={check.id} data-status={check.status}><span aria-hidden="true">{check.status === 'pass' ? '✓' : check.status === 'unknown' ? '?' : '×'}</span><div><strong>{check.label}</strong><small>{check.detail}</small></div></li>)}</ul><p className="ws-note">{calculated ? calculated.validation.validatorVersion + ': назначения перепроверены без модели CP-SAT.' : snapshot ? 'Проверяются только поддержанные условия из сохранённой версии задачи.' : 'Проверяются только описанные правила синтетического примера.'} Соответствие всем трудовым нормам не оценивается.</p></details>}
            <details className="ws-updated-schedule"><summary>{sourceOnly ? 'Сохранённое расписание' : 'Расписание варианта'} <span>{source.shifts.length} смен</span></summary><ScheduleTable source={source} task={example.task} assignments={scenario.assignments} selectedShiftId={selectedShiftId} onSelect={onShiftSelect} view="scenario" /></details>
            {calculated && !manualVersion && metrics.changes.length > 0 && <details className="ws-partial"><summary>Закрепить часть варианта</summary><p className="ws-note">Выбранные назначения станут обязательными условиями новой версии. Остальные смены будут рассчитаны заново.</p>{metrics.changes.map(change => <label key={change.shiftId}><input type="checkbox" checked={fixedIds.includes(change.shiftId)} onChange={event => setFixedIds(ids => event.target.checked ? [...ids, change.shiftId] : ids.filter(id => id !== change.shiftId))} /><span>{change.shiftId} → {source.employees.find(e => e.id === change.afterEmployeeId)?.name}</span></label>)}<button type="button" className="ws-primary" disabled={!fixedIds.length || fixing || requestEdited || !run?.isCurrent} onClick={() => onFixAssignments?.(fixedIds)}>Сохранить закрепления и пересчитать →</button>{!run?.isCurrent && <p className="ws-note">Закрепления доступны для текущих условий проекта.</p>}</details>}
            {!snapshot && <div className="ws-final-actions"><button type="button" className="ws-primary" disabled>Утвердить вариант <span aria-hidden="true">→</span></button><button type="button" className="ws-outline" disabled>Экспорт ↓</button><p>Утверждение и выдача файла результата ещё недоступны. Во внешней системе изменений нет.</p></div>}
          </>
        ) : null}
        {approvalControls}
        {snapshot && <div className="ws-source-export"><h3>Экспорт исходника V{source.version}</h3><div><a className="ws-outline" href={exportSourceUrl(snapshot.project.id, source.id, 'csv')} download>CSV-набор ↓</a><a className="ws-outline" href={exportSourceUrl(snapshot.project.id, source.id, 'xlsx')} download>XLSX ↓</a></div><p className="ws-note">Выдаётся сохранённый исходник с сотрудниками, доступностью и метаданными. Экспорт не утверждает и не публикует новое расписание.</p></div>}
      </div>
    </>
  );
}
