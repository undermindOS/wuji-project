import { useEffect, useRef, useState } from 'react';
import type { AiConfiguration, IntentDraft, TaskSpec, WorkspaceSnapshot } from '../model/types.ts';
import { intentBelongsTo, isActiveIntent, mergeIntentUpdate } from '../model/intents.ts';
import { workspaceClient } from './WorkspaceClient.ts';

export function useIntentDraft(snapshot: WorkspaceSnapshot | null, request: string) {
  const scope = snapshot ? snapshot.project.id + '/' + snapshot.source.id + '/' + snapshot.task.id : '';
  const [configuration, setConfiguration] = useState<AiConfiguration | null>(null);
  const [job, setJob] = useState<IntentDraft | null>(null);
  const [history, setHistory] = useState<IntentDraft[]>([]);
  const [selection, setSelection] = useState<{ scope: string; id: string } | null>(null);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState<'start' | 'cancel' | 'confirm' | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const action = useRef<AbortController | null>(null);
  const pending = useRef<{ fingerprint: string; key: string } | null>(null);
  const inFlight = useRef(false);
  const id = selection?.scope === scope ? selection.id : null;

  useEffect(() => {
    const ticket = ++generation.current;
    const controller = new AbortController();
    action.current?.abort(); inFlight.current = false;
    let timer: ReturnType<typeof setTimeout>;
    setBusy(null); setError(null); setLoading(!!snapshot);
    setJob(previous => previous && snapshot && intentBelongsTo(previous, snapshot) ? previous : null);
    setHistory([]);
    if (!snapshot) return () => { controller.abort(); };
    const current = () => generation.current === ticket && !controller.signal.aborted;
    const apply = (next: IntentDraft) => {
      if (!current() || !intentBelongsTo(next, snapshot)) return;
      setJob(previous => mergeIntentUpdate(previous, next));
      setHistory(previous => previous.map(item => item.id === next.id ? next : item));
    };
    const poll = async (draftId: string) => {
      try {
        const next = await workspaceClient.getIntent(snapshot.project.id, draftId, controller.signal);
        apply(next);
        if (current() && isActiveIntent(next)) timer = setTimeout(() => void poll(draftId), 700);
      } catch (value) { if (current()) setError(value instanceof Error ? value.message : 'Не удалось обновить черновик.'); }
    };
    void Promise.all([
      workspaceClient.getAiConfiguration(controller.signal),
      workspaceClient.listIntents(snapshot.project.id, snapshot.source.id, snapshot.task.id, controller.signal),
    ]).then(async ([config, list]) => {
      if (!current()) return;
      setConfiguration(config);
      const origin = snapshot.task.interpretation?.draftId;
      if (origin && !list.some(item => item.id === origin)) {
        const confirmed = await workspaceClient.getIntent(snapshot.project.id, origin, controller.signal);
        if (!current()) return;
        list = [confirmed, ...list];
      }
      list = [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      setHistory(list);
      const selected = list.find(item => item.id === id) ?? list.find(isActiveIntent) ?? list[0];
      if (selected) await poll(selected.id);
    }).catch(value => { if (current()) setError(value instanceof Error ? value.message : 'Не удалось открыть подключение ИИ.'); })
      .finally(() => { if (current()) setLoading(false); });
    return () => { generation.current++; controller.abort(); action.current?.abort(); clearTimeout(timer); };
  }, [scope, id, revision]);

  async function perform<T>(kind: 'start' | 'cancel' | 'confirm', operation: (signal: AbortSignal) => Promise<T>, accept: (value: T) => void) {
    if (inFlight.current) return;
    const ticket = generation.current;
    const controller = new AbortController(); action.current = controller; inFlight.current = true;
    setBusy(kind); setError(null);
    try {
      const value = await operation(controller.signal);
      if (generation.current === ticket && !controller.signal.aborted) accept(value);
    } catch (value) {
      if (generation.current === ticket && !controller.signal.aborted) setError(value instanceof Error ? value.message : 'Не удалось выполнить запрос.');
    } finally {
      if (generation.current === ticket) { inFlight.current = false; setBusy(null); }
    }
  }
  const start = () => {
    if (!snapshot || !configuration) return;
    const fingerprint = scope + '/' + configuration.model + '/' + request;
    if (pending.current?.fingerprint !== fingerprint) pending.current = { fingerprint, key: crypto.randomUUID() };
    const key = pending.current.key;
    return perform('start', signal => workspaceClient.startIntent(snapshot.project.id, {
      sourceVersionId: snapshot.source.id, taskSpecId: snapshot.task.id, request, requestKey: key, consent: true,
      maxCostMicroUsd: configuration.maxCostMicroUsd,
    }, signal), next => { pending.current = null; setJob(next); setSelection({ scope, id: next.id }); setRevision(v => v + 1); });
  };
  const cancel = () => job && snapshot && perform('cancel', signal => workspaceClient.cancelIntent(snapshot.project.id, job.id, signal), next => { setJob(next); setRevision(v => v + 1); });
  const confirm = (acknowledged: string[], onConfirmed: (task: TaskSpec) => void) => job && snapshot && perform('confirm',
    signal => workspaceClient.confirmIntent(snapshot.project.id, job.id, {
      expectedSourceVersionId: snapshot.source.id, expectedTaskId: job.taskSpecId, requestHash: job.requestHash,
      acknowledgedRuleIds: acknowledged,
    }, signal), onConfirmed);
  return {
    configuration, job: job && snapshot && intentBelongsTo(job, snapshot) ? job : null,
    history: history.filter(item => snapshot && intentBelongsTo(item, snapshot)), busy, loading, error, start, cancel, confirm,
    select: (draftId: string) => setSelection({ scope, id: draftId }), refresh: () => setRevision(v => v + 1),
  };
}
