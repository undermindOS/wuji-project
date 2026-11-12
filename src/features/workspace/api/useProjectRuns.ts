import { useEffect, useRef, useState } from 'react';
import type { ApiSchemas, RunDetail, RunSummary, WorkspaceSnapshot } from '../model/types.ts';
import { isActiveRun, mergeRunUpdate, runBelongsTo } from '../model/runs.ts';
import { workspaceClient } from './WorkspaceClient.ts';

export function useProjectRuns(snapshot: WorkspaceSnapshot | null) {
  const project = snapshot?.project.id ?? '';
  const source = snapshot?.source.id ?? '';
  const task = snapshot?.task.id ?? '';
  const scope = project + '/' + source + '/' + task;
  const [run, setRun] = useState<RunDetail | null>(null);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [selection, setSelection] = useState<{ scope: string; id: string } | null>(null);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const action = useRef<AbortController | null>(null);
  const pendingKey = useRef<{ scope: string; key: string } | null>(null);
  const pendingFix = useRef<{ context: string; key: string } | null>(null);
  const selectedId = selection?.scope === scope ? selection.id : null;

  useEffect(() => {
    const ticket = ++generation.current;
    const controller = new AbortController();
    action.current?.abort();
    let timer: ReturnType<typeof setTimeout>;
    setBusy(false); setError(null);
    setLoading(true);
    setRun(previous => previous && runBelongsTo(previous, project, source, task) ? previous : null);
    setRuns(previous => previous.filter(item => runBelongsTo(item, project, source, task)));
    if (!project || !source || !task) { setLoading(false); return () => controller.abort(); }
    const current = () => generation.current === ticket && !controller.signal.aborted;
    const apply = (next: RunDetail) => {
      if (!current() || !runBelongsTo(next, project, source, task)) return;
      setRun(previous => mergeRunUpdate(previous, next));
      setRuns(previous => previous.map(item => item.id === next.id ? next : item));
    };
    const poll = async (id: string) => {
      try {
        const next = await workspaceClient.getRun(project, id, controller.signal);
        apply(next);
        if (current() && isActiveRun(next)) timer = setTimeout(() => void poll(id), 700);
      } catch (value) {
        if (current()) setError(value instanceof Error ? value.message : 'Could not refresh the calculation.');
      }
    };
    void workspaceClient.listRuns(project, source, task, controller.signal).then(async list => {
      if (!current()) return;
      setRuns(list); pendingKey.current = null;
      const selected = list.find(item => item.id === selectedId) ?? list.find(isActiveRun) ?? list[0];
      if (selected) await poll(selected.id);
    }).catch(value => { if (current()) setError(value instanceof Error ? value.message : 'Could not load runs.'); })
      .finally(() => { if (current()) setLoading(false); });
    return () => { generation.current++; controller.abort(); action.current?.abort(); clearTimeout(timer); };
  }, [project, source, task, selectedId, revision]);

  const perform = async <T,>(operation: (signal: AbortSignal) => Promise<T>, accept: (value: T) => void) => {
    if (busy) return;
    const ticket = generation.current;
    const controller = new AbortController(); action.current = controller;
    setBusy(true); setError(null);
    try {
      const value = await operation(controller.signal);
      if (generation.current === ticket && !controller.signal.aborted) accept(value);
    } catch (value) {
      if (generation.current === ticket && !controller.signal.aborted) setError(value instanceof Error ? value.message : 'Could not complete the operation.');
    } finally { if (generation.current === ticket) setBusy(false); }
  };
  const start = () => {
    if (!pendingKey.current || pendingKey.current.scope !== scope) pendingKey.current = { scope, key: crypto.randomUUID() };
    const requestKey = pendingKey.current.key;
    return perform(signal => workspaceClient.startRun(project, { sourceVersionId: source, taskSpecId: task, requestKey, maxTimeSeconds: 10 }, signal), next => {
      pendingKey.current = null; setRun(next); setSelection({ scope, id: next.id }); setRevision(v => v + 1);
    });
  };
  const cancel = () => run && perform(signal => workspaceClient.cancelRun(project, run.id, signal), next => {
    setRun(next); setRevision(v => v + 1);
  });
  const fix = (scenarioId: string, shiftIds: string[], onFixed: (result: ApiSchemas['FixedRun']) => void) => {
    if (!run) return;
    const context = scope + '/' + run.id + '/' + scenarioId + '/' + [...shiftIds].sort().join(',');
    if (pendingFix.current?.context !== context) pendingFix.current = { context, key: crypto.randomUUID() };
    const requestKey = pendingFix.current.key;
    return perform(signal => workspaceClient.fixAssignments(project, run.id, {
      sourceVersionId: source, taskSpecId: task, scenarioId, shiftIds, requestKey, maxTimeSeconds: 10,
    }, signal), result => { pendingFix.current = null; onFixed(result); });
  };
  return {
    run: run && runBelongsTo(run, project, source, task) ? run : null,
    runs: runs.filter(item => runBelongsTo(item, project, source, task)),
    busy, loading, error, start, cancel, fix,
    select: (id: string) => setSelection({ scope, id }),
    refresh: () => setRevision(v => v + 1),
  };
}
