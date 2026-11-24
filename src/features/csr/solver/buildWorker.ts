import highsLoader from 'highs';
import wasmUrl from 'highs/runtime?url';
import { solveWeek } from '../model/build.ts';
import type { LpSolver } from '../model/build.ts';
import type { WeekInput } from '../model/types.ts';

// The solver blocks while it searches, so it runs here and the page stays responsive.
self.onmessage = async (event: MessageEvent<WeekInput>) => {
  try {
    const solver = await highsLoader({ locateFile: () => wasmUrl }) as unknown as LpSolver;
    self.postMessage({ ok: true, result: solveWeek(event.data, solver) });
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};
