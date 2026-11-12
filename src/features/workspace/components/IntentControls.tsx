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
    {draft.providerMode === 'test' && <p className="ws-notice">TEST RESPONSE · the model call is simulated.</p>}
    <div className="ws-rule-heading"><span className="ws-kicker ws-orange">{intentStatusLabel[draft.status]}</span><span className="ws-kicker">{draft.id.slice(0, 8)}</span></div>
    {!sameText && <div className="ws-notice"><p>This draft belongs to an earlier request. New constraints are not applied automatically.</p><button type="button" className="ws-text-button" disabled={!!state.busy} onClick={() => onRequestChange(draft.request)}>Restore this draft’s request ↺</button></div>}
    {!draft.isCurrent && <p className="ws-notice">The source or saved constraints have changed. Generate a new draft before confirming.</p>}
    {draft.status === 'queued' && <p className="ws-note">Job saved. Submission has not started yet.</p>}
    {draft.status === 'running' && <p role="status" className="ws-note">{draft.cancelRequested ? 'Stopping interpretation…' : 'Generating a draft. Saved constraints stay unchanged.'}</p>}
    {(draft.status === 'failed' || draft.status === 'cancelled') && <p className="ws-notice" role={draft.status === 'failed' ? 'alert' : 'status'}>{draft.events.at(-1)?.message}</p>}
    {draft.proposal?.issues.map((issue, index) => <p className="ws-notice" role="status" key={index}>{issue}</p>)}
    {draft.proposal && <div className="ws-intent-review">
      <p className="ws-note">{confirmed ? 'These constraints have been confirmed and saved as a separate version.' : draft.proposal.issues.length ? 'Clarify the request and generate a new draft. Resolve all questions before confirming.' : 'Review each constraint. Confirmation creates a new version; calculation starts separately.'}</p>
      {draft.proposal.review.map(rule => <div className="ws-intent-rule" key={rule.id}>
        <label><input type="checkbox" aria-label={'Reviewed: ' + rule.label} disabled={confirmed || !draft.canConfirm || !sameText || manualEdited || !!state.busy}
          checked={confirmed || acknowledged.includes(rule.id)} onChange={event => setAcknowledged(values => event.target.checked ? [...values, rule.id] : values.filter(id => id !== rule.id))} /><span><strong>{rule.label}</strong><small className={rule.changed ? 'ws-orange' : ''}>{rule.changed ? 'CHANGE' : 'SAVED'}</small></span></label>
        <p>{rule.detail}</p>{rule.quotes.map((quote, index) => <blockquote key={index}>«{quote}»</blockquote>)}
      </div>)}
      {!confirmed && <button type="button" className="ws-primary" disabled={!valid || !!state.busy} onClick={() => void state.confirm(acknowledged, onConfirmed)}>
        {state.busy === 'confirm' ? 'Saving confirmation…' : 'Confirm constraints'} <span aria-hidden="true">→</span>
      </button>}
    </div>}
    <div className="ws-ai-cost"><span className="ws-kicker">ANALYSIS COST // USD</span>
      {draft.providerMode === 'test' ? <p>Test mode. No live provider call was made.</p> : draft.usage ? <><strong>{microUsd(draft.usage.estimatedCostMicroUsd)} · estimate at the configured rate</strong><small>{draft.usage.inputTokens} input / {draft.usage.cachedInputTokens} cached / {draft.usage.outputTokens} output tokens</small><small>Usage reported by the provider. This is a rate-based estimate, not a provider invoice.</small></> : <p>{sent ? 'Usage was not reported; the actual cost is unknown.' : 'The request has not been sent to the provider yet.'}</p>}
      <small>Limit: {microUsd(draft.maxCostMicroUsd)} · estimate before starting ≤ {microUsd(draft.estimatedMaxCostMicroUsd)}</small>
    </div>
    <details className="ws-journal"><summary>Interpretation log · {draft.events.length}</summary>
      <p className="ws-note">OpenAI · {draft.responseModel ?? draft.model}<br />{draft.promptVersion} · source {draft.sourceHash.slice(0, 12)}…</p>
      <ol>{draft.events.map((event, index) => <li key={index}>{new Date(event.at).toLocaleTimeString('en-US')} · {event.message}</li>)}</ol>
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
    <div className="ws-rule-heading"><span className="ws-kicker ws-orange">AI // CONSTRAINT DRAFT</span><span className="ws-kicker">WITH CONFIRMATION</span></div>
    {config?.providerMode === 'test' && <p className="ws-notice">INTERFACE TEST · the model response is simulated.</p>}
    <div className="ws-ai-connection"><span>OpenAI</span><strong>{config?.model ?? 'Loading configuration…'}</strong><small>{config?.providerMode === 'test' ? 'Test adapter. No external requests.' : config?.configured ? 'Configured on the server. Access is checked when a request is made.' : config?.reason ?? 'The connection has not been verified yet.'}</small></div>
    <details className="ws-ai-sharing"><summary>What is sent to the provider</summary>
      <p className="ws-note">Only the request above, the time zone {snapshot.source.timezone} and the dates of the source week. Names are included if they appear in the request. The roster, rates, availability and original files are not sent separately.</p>
      <p className="ws-note">The server matches employees and shifts after the response. The model proposes supporting quotes; OR-Tools calculates assignments.</p>
    </details>
    <label className="ws-ai-consent"><input type="checkbox" checked={consent} disabled={!!state.busy || active} onChange={event => setConsentFor(event.target.checked ? consentKey : null)} /><span>I allow this request and the week’s calendar to be sent to OpenAI.</span></label>
    <p className="ws-note">One request · up to {config?.maxOutputTokens ?? 2048} output tokens · budget {microUsd(config?.maxCostMicroUsd ?? null)} · time limit {config?.timeoutSeconds ?? 35} s.</p>
    <button type="button" className="ws-outline" disabled={!consent || !config?.configured || !request.trim() || request.length > 8000 || manualEdited || !current || !!state.busy || active || state.loading} onClick={() => void state.start()}>
      {state.busy === 'start' ? 'Sending request…' : active ? 'Interpreting request…' : 'Suggest constraints from text'} <span aria-hidden="true">→</span>
    </button>
    {manualEdited && <p className="ws-note">Save or restore changes to explicit constraints first. You can keep the new request text.</p>}
    {active && <button type="button" className="ws-text-button" disabled={!!state.busy || state.job?.cancelRequested} onClick={() => void state.cancel()}>{state.job?.cancelRequested ? 'Cancelling…' : 'Cancel interpretation'}</button>}
    {state.history.length > 0 && <><label className="ws-field-label" htmlFor="intent-history">Drafts for these constraints</label><select id="intent-history" disabled={active || !!state.busy} value={state.job?.id ?? state.history[0].id} onChange={event => state.select(event.target.value)}>{state.history.map((job, index) => <option key={job.id} value={job.id}>{state.history.length - index} · {intentStatusLabel[job.status]}</option>)}</select></>}
    {state.error && <p role="alert" className="ws-notice">{state.error}</p>}
    {state.job && <Preview key={state.job.id} {...props} draft={state.job} />}
    <button type="button" className="ws-text-button" disabled={!!state.busy} onClick={state.refresh}>Refresh drafts ↻</button>
  </div>;
}
