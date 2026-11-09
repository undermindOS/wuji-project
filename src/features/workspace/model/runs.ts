import type { RunDetail, RunSummary } from './types.ts';

export const isActiveRun = (run: Pick<RunSummary, 'status'>) => run.status === 'queued' || run.status === 'running';
export const runBelongsTo = (run: RunSummary, projectId: string, sourceId: string, taskId: string) =>
  run.projectId === projectId && run.sourceVersionId === sourceId && run.taskSpecId === taskId;

// A delayed poll must not revert a terminal result to a running state.
export const mergeRunUpdate = (previous: RunDetail | null, next: RunDetail) =>
  previous?.id === next.id && !isActiveRun(previous) && isActiveRun(next) ? previous : next;

export const runStatusLabel: Record<RunSummary['status'], string> = {
  queued: 'В очереди', running: 'Выполняется', completed: 'Завершён',
  needs_clarification: 'Требуется уточнение', failed: 'Ошибка', cancelled: 'Отменён',
};
