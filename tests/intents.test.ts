import assert from 'node:assert/strict';
import test from 'node:test';
import { createExample } from '../src/features/workspace/data/examples.ts';
import { canConfirmIntent, intentBelongsTo, mergeIntentUpdate, microUsd } from '../src/features/workspace/model/intents.ts';
import type { IntentDraft, WorkspaceSnapshot } from '../src/features/workspace/model/types.ts';

const example = createExample('absence');
const snapshot: WorkspaceSnapshot = {
  project: { id: 'project', name: 'Example', headSourceId: example.source.id, headTaskId: example.task.id, sourceCount: 1, createdAt: '2026-11-02T00:00:00Z', updatedAt: '2026-11-02T00:00:00Z' },
  source: example.source, task: example.task, tasks: [example.task], baseline: example.scenarios[0], versions: [],
};
const draft: IntentDraft = {
  id: 'draft', projectId: 'project', sourceVersionId: example.source.id, taskSpecId: example.task.id,
  sourceHash: 'abc', request: 'Анна отсутствует в среду.', requestHash: 'request-hash',
  provider: 'openai', providerMode: 'test', model: 'requested-model', responseModel: 'fixture-model',
  responseId: 'fixture', promptVersion: 'quotes/1', status: 'ready', isCurrent: true, canConfirm: true,
  maxCostMicroUsd: 50000, estimatedMaxCostMicroUsd: 12000, usage: null, cancelRequested: false,
  confirmedTaskId: null, events: [], createdAt: '2026-11-02T00:00:00Z', finishedAt: null,
  proposal: { absence: example.task.absence, fixedAssignments: {}, objective: 'compare', issues: [],
    review: ['absence', 'fixed', 'objective', 'safety'].map(id => ({ id, label: id, detail: id, quotes: [], changed: false })) },
};
const acknowledgements = ['absence', 'fixed', 'objective', 'safety'];

test('confirmation requires every critical rule exactly once', () => {
  assert.equal(canConfirmIntent(draft, snapshot, draft.request, acknowledgements), true);
  assert.equal(canConfirmIntent(draft, snapshot, draft.request, acknowledgements.slice(1)), false);
  assert.equal(canConfirmIntent(draft, snapshot, draft.request, [...acknowledgements, 'safety']), false);
});
test('a changed request or input version cannot confirm an old interpretation', () => {
  assert.equal(canConfirmIntent(draft, snapshot, 'Другой текст', acknowledgements), false);
  assert.equal(canConfirmIntent(draft, { ...snapshot, source: { ...snapshot.source, id: 'new-source' } }, draft.request, acknowledgements), false);
  assert.equal(canConfirmIntent(draft, { ...snapshot, task: { ...snapshot.task, id: 'new-task' } }, draft.request, acknowledgements), false);
});
test('questions, failed jobs and stale backend state block confirmation', () => {
  assert.equal(canConfirmIntent({ ...draft, proposal: { ...draft.proposal!, issues: ['Уточните сотрудника'] } }, snapshot, draft.request, acknowledgements), false);
  assert.equal(canConfirmIntent({ ...draft, status: 'failed' }, snapshot, draft.request, acknowledgements), false);
  assert.equal(canConfirmIntent({ ...draft, canConfirm: false }, snapshot, draft.request, acknowledgements), false);
});
test('confirmed provenance can remain visible on the resulting task without becoming confirmable again', () => {
  const confirmed = { ...draft, status: 'confirmed' as const, confirmedTaskId: 'new-task', canConfirm: false };
  const current = { ...snapshot, task: { ...snapshot.task, id: 'new-task' } };
  assert.equal(intentBelongsTo(confirmed, current), true);
  assert.equal(canConfirmIntent(confirmed, current, draft.request, acknowledgements), false);
});
test('a late progress poll cannot overwrite a ready or confirmed interpretation', () => {
  assert.equal(mergeIntentUpdate(draft, { ...draft, status: 'running' }), draft);
  const next = { ...draft, status: 'confirmed' as const };
  assert.equal(mergeIntentUpdate(draft, next), next);
});
test('analysis money distinguishes missing usage and sub-cent estimates', () => {
  assert.equal(microUsd(null), 'Неизвестно');
  assert.notEqual(microUsd(930), microUsd(0));
});
