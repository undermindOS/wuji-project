import type { RunDetail } from '../model/types';
import { runStatusLabel } from '../model/runs';

const outcomeLabel = {
  solutions: 'Проверенные варианты готовы',
  infeasible: 'Невозможность доказана при введённых условиях',
  needs_clarification: 'Требуется уточнение исходных данных',
  limit: 'Лимит исчерпан; невозможность не доказана',
  invalid: 'Результат не прошёл проверку',
};

export default function RunReport({ run, onShiftSelect }: { run: RunDetail; onShiftSelect: (id: string) => void }) {
  return <div className="ws-run-report">
    <div className="ws-rule-heading"><span className="ws-kicker ws-orange">{runStatusLabel[run.status]}</span><span className="ws-kicker">{run.result ? (run.result.elapsedMs / 1000).toFixed(2) + ' С' : 'CP-SAT'}</span></div>
    <strong role="status">{run.result ? outcomeLabel[run.result.outcome] : run.status === 'queued' ? 'Задание в очереди. Выполнение ещё не началось.' : run.status === 'running' ? run.cancelRequested ? 'Останавливаем поиск…' : 'Строим и проверяем варианты…' : run.status === 'cancelled' ? 'Расчёт отменён. Вариант не выдан.' : 'Запуск прерван. Можно повторить расчёт.'}</strong>
    {!run.isCurrent && <p className="ws-notice">Исторический запуск: текущий исходник или условия проекта уже изменились.</p>}
    {run.result?.issues.map((issue, index) => <div className="ws-notice" key={index}><p>{issue.message}</p>{(issue.shiftIds ?? []).slice(0, 5).map(sid => <button key={sid} type="button" className="ws-text-button" onClick={() => onShiftSelect(sid)}>Смена {sid} · открыть основания ↖</button>)}</div>)}
    <details className="ws-journal"><summary>Журнал расчёта · {run.events.length}</summary>
      <p className="ws-note">Движок: {run.engineVersion}<br />Исходник: {run.sourceHash.slice(0, 16)}…<br />Общий лимит поиска: {run.maxTimeSeconds} с. Назначения рассчитывает OR-Tools.</p>
      <ol>{run.events.map((event, index) => <li key={index}>{new Date(event.at).toLocaleTimeString('ru-RU')} · {event.message}</li>)}</ol>
      {run.result?.attempts.map((attempt, index) => <p className="ws-note" key={index}>{attempt.priority === 'min_changes' ? 'Перестановки' : 'Оплата'} / {attempt.phase === 'primary' ? 'главный приоритет' : 'дополнительный приоритет'}: <strong>{attempt.status}</strong> · {attempt.elapsedMs} мс</p>)}
    </details>
  </div>;
}
