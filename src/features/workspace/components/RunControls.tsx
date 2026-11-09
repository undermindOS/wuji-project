import type { useProjectRuns } from '../api/useProjectRuns';
import { isActiveRun, runStatusLabel } from '../model/runs';

export default function RunControls({ state, disabled, onShowResults }: {
  state: ReturnType<typeof useProjectRuns>; disabled: boolean; onShowResults: () => void;
}) {
  const active = state.runs.some(isActiveRun) || (!!state.run && isActiveRun(state.run));
  return <div className="ws-run-controls">
    <div className="ws-rule-heading"><span className="ws-kicker ws-orange">CP-SAT // РАСЧЁТ</span><span className="ws-kicker">ЛИМИТ 10 С</span></div>
    <button type="button" className="ws-primary" disabled={disabled || active || state.busy || state.loading} onClick={() => void state.start()}>
      {state.busy ? 'Отправляем…' : active ? 'Расчёт в работе…' : state.loading ? 'Открываем запуски…' : 'Рассчитать сохранённые условия'} <span aria-hidden="true">→</span>
    </button>
    {active && <button type="button" className="ws-outline" disabled={state.busy || state.run?.cancelRequested} onClick={() => void state.cancel()}>{state.run?.cancelRequested ? 'Отменяем…' : 'Отменить расчёт'}</button>}
    {disabled && <p className="ws-note">Для расчёта нужны сохранённые текущие условия.</p>}
    {state.runs.length > 0 && <><label className="ws-field-label" htmlFor="run-history">Запуски этих условий</label><select id="run-history" value={state.run?.id ?? state.runs[0].id} disabled={active || state.busy} onChange={event => state.select(event.target.value)}>{state.runs.map((run, index) => <option key={run.id} value={run.id}>{String(state.runs.length - index).padStart(2, '0')} · {runStatusLabel[run.status]} · {new Date(run.createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</option>)}</select><button type="button" className="ws-text-button" onClick={onShowResults}>Открыть результат и журнал ↗</button></>}
    {state.error && <p className="ws-notice" role="alert">{state.error}</p>}
    <button type="button" className="ws-text-button" disabled={state.busy} onClick={state.refresh}>Обновить запуски ↻</button>
    <p className="ws-note">Назначения рассчитывает OR-Tools. Текст задачи сохраняется отдельно; условия задаются явно.</p>
  </div>;
}
