import type { IntentDraft, WorkspaceSnapshot } from './types.ts';

export const isActiveIntent = (draft: IntentDraft) => draft.status === 'queued' || draft.status === 'running';
export const intentBelongsTo = (draft: IntentDraft, snapshot: WorkspaceSnapshot) =>
  draft.projectId === snapshot.project.id && draft.sourceVersionId === snapshot.source.id &&
  (draft.taskSpecId === snapshot.task.id || draft.confirmedTaskId === snapshot.task.id);
export const canConfirmIntent = (draft: IntentDraft, snapshot: WorkspaceSnapshot, text: string, acknowledged: string[]) =>
  intentBelongsTo(draft, snapshot) && draft.canConfirm && draft.status === 'ready' && draft.request === text &&
  !!draft.proposal && draft.proposal.issues.length === 0 &&
  new Set(acknowledged).size === acknowledged.length && acknowledged.length === draft.proposal.review.length &&
  draft.proposal.review.every(rule => acknowledged.includes(rule.id));
export const mergeIntentUpdate = (previous: IntentDraft | null, next: IntentDraft) =>
  previous?.id === next.id && !isActiveIntent(previous) && isActiveIntent(next) ? previous : next;
export const microUsd = (amount: number | null) => amount == null ? 'Unknown' :
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(amount / 1_000_000);
export const intentStatusLabel: Record<IntentDraft['status'], string> = {
  queued: 'Queued', running: 'Interpreting request', ready: 'Confirmation required', needs_clarification: 'Clarification needed',
  failed: 'Interpretation failed', cancelled: 'Cancelled', confirmed: 'Constraints confirmed',
};
