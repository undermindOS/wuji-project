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
      <div className="ws-pane-heading"><span className="ws-kicker ws-orange">02 // INTENT</span><div><h2 id="task-heading">Задача и основания</h2><span className="ws-version">V{task.version ?? 1}</span></div></div>
      <div className="ws-pane-scroll ws-task-body">
        {!snapshot && <><label className="ws-field-label" htmlFor="demo-case">Пример ситуации</label>
        <select id="demo-case" value={example.id} onChange={event => onExampleChange(event.target.value as ExampleId)}>
          {EXAMPLES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select></>}
        {snapshot && <><label className="ws-field-label" htmlFor="task-version">Сохранённые условия</label><select id="task-version" disabled={inputDisabled || saving} value={task.id} onChange={event => onTaskVersionSelect?.(event.target.value)}>{snapshot.tasks.map(version => <option key={version.id} value={version.id}>V{version.version} · {version.request.slice(0, 50)}</option>)}</select></>}
        <label className="ws-field-label" htmlFor="task-request">Что нужно изменить?</label>
        <div className="ws-prompt-wrap"><span className="ws-prompt-symbol" aria-hidden="true">&gt;</span><textarea id="task-request" value={draft} disabled={inputDisabled || saving} maxLength={8000} onChange={event => onDraftChange(event.target.value)} rows={6} spellCheck={false} aria-describedby="request-help" /></div>
        <p id="request-help" className="ws-note">{snapshot ? 'Получите черновик из текста и подтвердите условия. Для явного редактирования доступны поля ниже. Расчёт запускается по сохранённой версии.' : 'В демо открываются готовые варианты выбранного примера. Свободный запрос будет обрабатываться после подключения ИИ.'}</p>
        {intentControls}
        {task.interpretation && <p className="ws-note ws-intent-origin">{task.interpretation.providerMode === 'test' ? 'Контрольный ответ' : 'OpenAI'} · {task.interpretation.model}<br />Черновик {task.interpretation.draftId.slice(0, 8)} подтверждён {new Date(task.interpretation.confirmedAt).toLocaleString('ru-RU')}.</p>}
        {snapshot && <><label className="ws-field-label" htmlFor="task-objective">Приоритет расчёта</label><select id="task-objective" disabled={inputDisabled || saving} value={objectiveDraft} onChange={event => onObjectiveChange?.(event.target.value as 'compare' | 'min_changes' | 'min_cost')}><option value="compare">Сравнить приоритеты</option><option value="min_changes">Меньше перестановок</option><option value="min_cost">Меньше оплаты</option></select></>}
        {snapshot && <div className="ws-absence-editor"><label className="ws-field-label" htmlFor="absence-employee">Сотрудник отсутствует · явное условие</label><select id="absence-employee" disabled={inputDisabled || saving} value={absenceDraft?.employeeId ?? ''} onChange={event => { const id = event.target.value; onAbsenceChange?.(id ? { employeeId: id, shiftIds: source.shifts.filter(shift => shift.employeeId === id).map(shift => shift.id) } : null); }}><option value="">Отсутствие не задано</option>{source.employees.map(employee => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select>{absenceDraft && <details><summary>Смены отсутствия · {absenceDraft.shiftIds.length}</summary><div className="ws-absence-shifts">{source.shifts.map(shift => <label key={shift.id}><input type="checkbox" disabled={inputDisabled || saving} checked={absenceDraft.shiftIds.includes(shift.id)} onChange={event => onAbsenceChange?.({ employeeId: absenceDraft.employeeId, shiftIds: (event.target.checked ? [...absenceDraft.shiftIds, shift.id] : absenceDraft.shiftIds.filter(id => id !== shift.id)).sort() })} /><span>{dayLabel(shift, source.timezone)} · {timeLabel(shift, source.timezone)}</span></label>)}</div></details>}<p className="ws-note">Отсутствие действует на интервалы выбранных смен, включая пересекающиеся с ними смены.</p></div>}
        {snapshot && Object.keys(task.fixedAssignments ?? {}).length > 0 && <details className="ws-fixed-editor"><summary>Закрепления условий · {Object.keys(fixedDraft).length}</summary>{Object.entries(task.fixedAssignments ?? {}).map(([sid, eid]) => <label key={sid}><input type="checkbox" disabled={inputDisabled || saving} checked={!!fixedDraft[sid]} onChange={event => { const next = { ...fixedDraft }; if (event.target.checked) next[sid] = eid; else delete next[sid]; onFixedChange?.(next); }} /><span>{sid} → {source.employees.find(e => e.id === eid)?.name}</span></label>)}</details>}
        {edited && <div className="ws-notice" role="status"><p>{snapshot ? 'Есть несохранённые условия. Проверка справа относится к сохранённой версии.' : 'Текст изменён. Показанные варианты относятся к исходному запросу примера.'}</p><button type="button" className="ws-text-button" disabled={inputDisabled || saving} onClick={() => { onDraftChange(task.request); onAbsenceChange?.(task.absence); onFixedChange?.(task.fixedAssignments ?? {}); onObjectiveChange?.(task.objective ?? 'compare'); }}>{snapshot ? 'Вернуть сохранённые условия ↺' : 'Восстановить запрос примера ↺'}</button></div>}
        {snapshot && edited && <button type="button" className="ws-primary" disabled={!edited || !canSave || saving || inputDisabled || !draft.trim() || (!!absenceDraft && !absenceDraft.shiftIds.length)} onClick={onSaveTask}>{saving ? 'Сохраняем условия…' : 'Сохранить новую версию условий'} <span aria-hidden="true">→</span></button>}
        {runControls}
        <div className="ws-rule-heading"><span className="ws-kicker">ОБЯЗАТЕЛЬНЫЕ УСЛОВИЯ</span><span className="ws-kicker">{task.rules.length.toString().padStart(2, '0')}</span></div>
        <ul className="ws-rules">
          {task.rules.map(rule => <li key={rule.id}><span aria-hidden="true">▣</span><div><strong>{rule.label}</strong><small>{rule.detail}</small></div></li>)}
        </ul>
        {!intentControls && <div className="ws-provider">
          <div><label htmlFor="ai-provider">Провайдер</label><select id="ai-provider" disabled><option>Не подключён</option></select></div>
          <div><label htmlFor="ai-model">Модель</label><select id="ai-model" disabled><option>Недоступна</option></select></div>
        </div>}
        {snapshot ? <>{!canSave && <p className="ws-note">Историческая версия доступна для просмотра. Для изменений откройте текущую версию проекта.</p>}{saveError && <p className="ws-notice" role="alert">{saveError}</p>}<button type="button" className="ws-outline" onClick={onShowResults}>{run ? 'Открыть результат расчёта' : 'Открыть проверку исходника'} <span aria-hidden="true">→</span></button></> : <button type="button" className="ws-primary" onClick={onShowResults} disabled={edited}>{example.conflict ? 'Показать конфликт' : `Открыть ${example.scenarios.length === 1 ? 'вариант' : 'варианты'}`} <span aria-hidden="true">→</span></button>}
        <p className="ws-analysis-cost">{snapshot ? 'Расчёт, проверка и происхождение открытой версии показаны отдельно. Использование модели записано в журнале черновика.' : 'Демонстрационные варианты подготовлены заранее.'}</p>

        <div className="ws-evidence" ref={evidenceRef} data-testid="evidence">
          <div className="ws-rule-heading"><span className="ws-kicker ws-orange">// TRACE THE CHANGE</span><span aria-hidden="true">↙</span></div>
          <h3>{example.conflict ? 'Основания конфликта' : unchanged ? 'Основания назначения' : 'Основания изменения'}</h3>
          {selected ? (
            <>
              <div className="ws-evidence-selected"><span>{dayLabel(selected, source.timezone)} · {timeLabel(selected, source.timezone)}</span><strong>{unchanged ? <>{before.name}<small>Назначение сохранено</small></> : <>{before?.name ?? 'Неизвестно'} <span className="ws-orange">→</span> {after?.name ?? (example.conflict ? 'Конфликт условий' : 'Без назначения')}</>}</strong></div>
              <div className="ws-evidence-item"><span className="ws-evidence-tag">ИСТОЧНИК</span><button type="button" className="ws-text-button" onClick={onOpenSource}>Строка {selected.sourceRow} · {selected.id} ↖</button><p>{selected.role} · {durationMinutes(selected) / 60} ч · исходник v{source.version}.</p>{selected.sourceRefs?.employee_id && <small>{selected.sourceRefs.employee_id.filename}{selected.sourceRefs.employee_id.sheet ? ` / ${selected.sourceRefs.employee_id.sheet}` : ''} · столбец {selected.sourceRefs.employee_id.column}</small>}</div>
              <div className="ws-evidence-item"><span className="ws-evidence-tag">УСЛОВИЕ</span><p>{example.conflict ? example.conflict.detail : scenario?.description ?? 'Выберите вариант.'}</p>{task.absence?.shiftIds.includes(selected.id) && <small>{absenceEmployee?.name ?? 'Сотрудник'} отсутствует в выбранную смену. Условия v{task.version ?? 1}.</small>}</div>
              {after && <div className="ws-evidence-item"><span className="ws-evidence-tag">ПРОВЕРКА</span><p className={availability === 'available' ? 'ws-green' : availability === 'unknown' ? 'ws-orange' : 'ws-red'}>{availability === 'available' ? `${after.name}: доступность подтверждена.` : availability === 'unknown' ? `${after.name}: доступность неизвестна.` : `${after.name}: в это время отсутствует.`}</p><small>{availabilityRef ? `Источник: ${availabilityRef.filename}${availabilityRef.sheet ? ` / ${availabilityRef.sheet}` : ''} · строка ${availabilityRef.row} · ${availabilityRef.column}; ${task.absence ? 'также учтено отсутствие из условий.' : 'отсутствие не задано.'}` : `Основание — доступность для смены ${selected.id} в карточке сотрудника и условие об отсутствии.`}</small></div>}
              {after && <div className="ws-evidence-item"><span className="ws-evidence-tag">РАСЧЁТ</span>{beforeCost !== null && afterCost !== null && before?.ratePerHourMinor != null && after.ratePerHourMinor !== null
                ? <><p className="ws-formula">{money(afterCost, source.currency)} − {money(beforeCost, source.currency)}</p><strong className="ws-orange">{money(afterCost - beforeCost, source.currency, true)}</strong><small>Разница округлённой оплаты этой смены. {rateRef ? `Ставка: ${rateRef.filename}${rateRef.sheet ? ` / ${rateRef.sheet}` : ''} · строка ${rateRef.row} · ${rateRef.column}.` : 'Ставки взяты из карточек команды.'}</small></>
                : <><p className="ws-orange">Денежная разница неизвестна.</p><small>Для расчёта нужна ставка сотрудника. Отсутствующая ставка не считается нулём.</small></>}
              </div>}
              {serverEvidence && <div className="ws-evidence-item"><span className="ws-evidence-tag">СЕРВЕРНАЯ ПРОВЕРКА</span><p>{serverEvidence.checkIds.length} проверок · {serverScenario?.validation.validatorVersion}</p><small>Условия: {serverEvidence.ruleIds.join(', ')} · {serverEvidence.durationMinutes} мин</small><details><summary>Ссылки на исходные ячейки · {serverEvidence.sourceRefs.length}</summary><ul className="ws-server-refs">{serverEvidence.sourceRefs.map((ref, index) => <li key={index}>{ref.filename}{ref.sheet ? ' / ' + ref.sheet : ''} · строка {ref.row} · {ref.column}</li>)}</ul></details></div>}
              {checks.some(check => check.status !== 'pass' && check.shiftIds.includes(selected.id)) && <p className="ws-notice">Есть непроверенное или нарушенное условие для выбранной смены. См. проверки варианта справа.</p>}
            </>
          ) : <p className="ws-note">Выберите назначение или изменение, чтобы увидеть исходную строку, условие и расчёт.</p>}
        </div>
        <details className="ws-journal"><summary>{snapshot ? 'История открытой версии' : 'Журнал примера'}</summary><ol>{snapshot ? <><li>Открыт сохранённый исходник v{source.version}: {source.shifts.length} смен.</li><li>Условия v{task.version}; {run ? 'расчёт сохранён отдельно, журнал доступен справа.' : 'решатель ещё не запускался.'}</li><li>{run?.result?.scenarios.length ? 'Метрики и проверки варианта рассчитаны на сервере.' : 'Метрики и проверки исходника выполнены в браузере.'}</li></> : <><li>Открыт синтетический исходник: {source.shifts.length} смен.</li><li>Загружены заранее подготовленные варианты: {example.scenarios.length}.</li><li>Метрики и проверки примера выполнены в браузере.</li></>}</ol></details>
      </div>
    </>
  );
}
