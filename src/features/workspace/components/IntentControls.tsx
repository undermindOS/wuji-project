import { useState } from 'react';
import type { useIntentDraft } from '../api/useIntentDraft';
import { canConfirmIntent, intentStatusLabel, isActiveIntent, microUsd } from '../model/intents';
import type { IntentDraft, TaskSpec, WorkspaceSnapshot } from '../model/types';

type IntentState = ReturnType<typeof useIntentDraft>;
interface Props {
  state: IntentState;
  snapshot: WorkspaceSnapshot;
  request: string;
  manualEdited: boolean;
  onRequestChange: (text: string) => void;
  onConfirmed: (task: TaskSpec) => void;
}

function Preview({ draft, state, snapshot, request, manualEdited, onRequestChange, onConfirmed }: Props & { draft: IntentDraft }) {
  const [acknowledged, setAcknowledged] = useState<string[]>([]);
  const sameText = draft.request === request;
  const confirmed = draft.status === 'confirmed';
  const valid = !manualEdited && canConfirmIntent(draft, snapshot, request, acknowledged);
  const sent = draft.events.some(event => event.code === 'provider_request');
  return <div className="ws-intent-preview">
    {draft.providerMode === 'test' && <p className="ws-notice">КОНТРОЛЬНЫЙ ОТВЕТ · обращение к модели имитируется.</p>}
    <div className="ws-rule-heading"><span className="ws-kicker ws-orange">{intentStatusLabel[draft.status]}</span><span className="ws-kicker">{draft.id.slice(0, 8)}</span></div>
    {!sameText && <div className="ws-notice"><p>Этот черновик относится к предыдущему тексту. Новые условия не подставляются автоматически.</p><button type="button" className="ws-text-button" disabled={!!state.busy} onClick={() => onRequestChange(draft.request)}>Вернуть текст этого черновика ↺</button></div>}
    {!draft.isCurrent && <p className="ws-notice">Исходник или сохранённые условия изменились. Для подтверждения нужен новый разбор.</p>}
    {draft.status === 'queued' && <p className="ws-note">Задание сохранено. Отправка ещё не началась.</p>}
    {draft.status === 'running' && <p role="status" className="ws-note">{draft.cancelRequested ? 'Останавливаем разбор…' : 'Получаем черновик. Сохранённые условия не меняются.'}</p>}
    {(draft.status === 'failed' || draft.status === 'cancelled') && <p className="ws-notice" role={draft.status === 'failed' ? 'alert' : 'status'}>{draft.events.at(-1)?.message}</p>}
    {draft.proposal?.issues.map((issue, index) => <p className="ws-notice" role="status" key={index}>{issue}</p>)}
    {draft.proposal && <div className="ws-intent-review">
      <p className="ws-note">{confirmed ? 'Эти условия подтверждены и сохранены отдельной версией.' : draft.proposal.issues.length ? 'Уточните запрос и получите новый черновик. Подтверждение недоступно, пока остаются вопросы.' : 'Проверьте каждое условие. Подтверждение создаёт новую версию; расчёт запускается отдельно.'}</p>
      {draft.proposal.review.map(rule => <div className="ws-intent-rule" key={rule.id}>
        <label><input type="checkbox" aria-label={'Проверено: ' + rule.label} disabled={confirmed || !draft.canConfirm || !sameText || manualEdited || !!state.busy}
          checked={confirmed || acknowledged.includes(rule.id)} onChange={event => setAcknowledged(values => event.target.checked ? [...values, rule.id] : values.filter(id => id !== rule.id))} /><span><strong>{rule.label}</strong><small className={rule.changed ? 'ws-orange' : ''}>{rule.changed ? 'ИЗМЕНЕНИЕ' : 'СОХРАНЕНО'}</small></span></label>
        <p>{rule.detail}</p>{rule.quotes.map((quote, index) => <blockquote key={index}>«{quote}»</blockquote>)}
      </div>)}
      {!confirmed && <button type="button" className="ws-primary" disabled={!valid || !!state.busy} onClick={() => void state.confirm(acknowledged, onConfirmed)}>
        {state.busy === 'confirm' ? 'Сохраняем подтверждение…' : 'Подтвердить условия'} <span aria-hidden="true">→</span>
      </button>}
    </div>}
    <div className="ws-ai-cost"><span className="ws-kicker">СТОИМОСТЬ АНАЛИЗА // USD</span>
      {draft.providerMode === 'test' ? <p>Тестовый режим. Живого вызова провайдера не было.</p> : draft.usage ? <><strong>{microUsd(draft.usage.estimatedCostMicroUsd)} · оценка по тарифу</strong><small>{draft.usage.inputTokens} входных / {draft.usage.cachedInputTokens} кешированных / {draft.usage.outputTokens} выходных токенов</small><small>Usage получен от провайдера. Это расчёт по тарифу, не счёт провайдера.</small></> : <p>{sent ? 'Usage не получен; фактическая стоимость неизвестна.' : 'Запрос провайдеру ещё не отправлялся.'}</p>}
      <small>Лимит: {microUsd(draft.maxCostMicroUsd)} · оценка до запуска ≤ {microUsd(draft.estimatedMaxCostMicroUsd)}</small>
    </div>
    <details className="ws-journal"><summary>Журнал разбора · {draft.events.length}</summary>
      <p className="ws-note">OpenAI · {draft.responseModel ?? draft.model}<br />{draft.promptVersion} · исходник {draft.sourceHash.slice(0, 12)}…</p>
      <ol>{draft.events.map((event, index) => <li key={index}>{new Date(event.at).toLocaleTimeString('ru-RU')} · {event.message}</li>)}</ol>
    </details>
  </div>;
}

export default function IntentControls(props: Props) {
  const { state, snapshot, request, manualEdited } = props;
  const config = state.configuration;
  const [consentFor, setConsentFor] = useState<string | null>(null);
  const consentKey = snapshot.source.id + '/' + snapshot.task.id + '/' + config?.model + '/' + request;
  const consent = consentFor === consentKey;
  const active = state.history.some(isActiveIntent) || (!!state.job && isActiveIntent(state.job));
  const current = snapshot.source.id === snapshot.project.headSourceId && snapshot.task.id === snapshot.project.headTaskId;
  return <div className="ws-intent-controls">
    <div className="ws-rule-heading"><span className="ws-kicker ws-orange">AI // ЧЕРНОВИК УСЛОВИЙ</span><span className="ws-kicker">С ПОДТВЕРЖДЕНИЕМ</span></div>
    {config?.providerMode === 'test' && <p className="ws-notice">ПРОВЕРКА ИНТЕРФЕЙСА · ответ модели имитируется.</p>}
    <div className="ws-ai-connection"><span>OpenAI</span><strong>{config?.model ?? 'Открываем настройку…'}</strong><small>{config?.providerMode === 'test' ? 'Контрольный адаптер. Внешних запросов нет.' : config?.configured ? 'Настроен на сервере. Доступ проверяется при запросе.' : config?.reason ?? 'Подключение ещё не проверено.'}</small></div>
    <details className="ws-ai-sharing"><summary>Что передаётся провайдеру</summary>
      <p className="ws-note">Только текст выше, часовой пояс {snapshot.source.timezone} и даты исходной недели. Имена передаются, если они есть в тексте. Состав команды, ставки, доступность и оригинальные файлы отдельно не отправляются.</p>
      <p className="ws-note">Сотрудников и смены сопоставляет сервер после ответа. Модель предлагает цитаты, назначения рассчитывает OR-Tools.</p>
    </details>
    <label className="ws-ai-consent"><input type="checkbox" checked={consent} disabled={!!state.busy || active} onChange={event => setConsentFor(event.target.checked ? consentKey : null)} /><span>Разрешаю отправить этот текст и календарь недели в OpenAI.</span></label>
    <p className="ws-note">Один запрос · до {config?.maxOutputTokens ?? 2048} выходных токенов · лимит {microUsd(config?.maxCostMicroUsd ?? null)} · {config?.timeoutSeconds ?? 35} с.</p>
    <button type="button" className="ws-outline" disabled={!consent || !config?.configured || !request.trim() || request.length > 8000 || manualEdited || !current || !!state.busy || active || state.loading} onClick={() => void state.start()}>
      {state.busy === 'start' ? 'Отправляем запрос…' : active ? 'Разбор в работе…' : 'Предложить условия из текста'} <span aria-hidden="true">→</span>
    </button>
    {manualEdited && <p className="ws-note">Сначала сохраните изменения явных условий или верните сохранённые. Текст запроса можно оставить новым.</p>}
    {active && <button type="button" className="ws-text-button" disabled={!!state.busy || state.job?.cancelRequested} onClick={() => void state.cancel()}>{state.job?.cancelRequested ? 'Отменяем…' : 'Отменить разбор'}</button>}
    {state.history.length > 0 && <><label className="ws-field-label" htmlFor="intent-history">Черновики этих условий</label><select id="intent-history" disabled={active || !!state.busy} value={state.job?.id ?? state.history[0].id} onChange={event => state.select(event.target.value)}>{state.history.map((job, index) => <option key={job.id} value={job.id}>{state.history.length - index} · {intentStatusLabel[job.status]}</option>)}</select></>}
    {state.error && <p role="alert" className="ws-notice">{state.error}</p>}
    {state.job && <Preview key={state.job.id} {...props} draft={state.job} />}
    <button type="button" className="ws-text-button" disabled={!!state.busy} onClick={state.refresh}>Обновить черновики ↻</button>
  </div>;
}
