import { useCallback, useEffect, useRef, useState } from 'react';
import type { BuildResult } from '../model/build.ts';
import type { WeekInput } from '../model/types.ts';

type Reply = { ok: true; result: BuildResult } | { ok: false; error: string };

/** Runs one build at a time in a worker; cancelling terminates the worker. */
export function useBuild(onResult: (input: WeekInput, result: BuildResult) => void) {
  const worker = useRef<Worker | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stop = useCallback(() => { worker.current?.terminate(); worker.current = null; setBusy(false); }, []);
  useEffect(() => stop, [stop]);
  const start = useCallback((input: WeekInput) => {
    stop(); setError(null); setBusy(true);
    const current = new Worker(new URL('./buildWorker.ts', import.meta.url), { type: 'module' });
    worker.current = current;
    const finish = (message: string | null) => { if (worker.current !== current) return; stop(); setError(message); };
    current.onmessage = (event: MessageEvent<Reply>) => {
      if (worker.current !== current) return;
      if (!event.data.ok) return finish(`The solver stopped with an error: ${event.data.error}`);
      if (!event.data.result.plan) return finish(`The solver returned no week (${event.data.result.solverStatus}).`);
      onResult(input, event.data.result); finish(null);
    };
    current.onerror = event => finish(`The solver could not start: ${event.message || 'unknown error'}`);
    current.postMessage(input);
  }, [onResult, stop]);
  return { busy, error, start, cancel: stop };
}
