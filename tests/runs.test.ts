import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeRunUpdate, runBelongsTo } from '../src/features/workspace/model/runs.ts';
import { availabilityFor, checkSchedule } from '../src/features/workspace/model/schedule.ts';
import { createExample } from '../src/features/workspace/data/examples.ts';
import type { RunDetail } from '../src/features/workspace/model/types.ts';

const run = (status: RunDetail['status']) => ({
  id: 'run', projectId: 'project', sourceVersionId: 'source', taskSpecId: 'task',
  sourceHash: 'abc', engineVersion: 'engine/1', status, isCurrent: true, maxTimeSeconds: 10,
  cancelRequested: false, createdAt: '2026-11-02T00:00:00Z', startedAt: null,
  finishedAt: null, heartbeatAt: null, result: null, events: [],
} satisfies RunDetail);

test('a delayed poll cannot replace a completed or cancelled result with running', () => {
  for (const status of ['completed', 'cancelled', 'failed', 'needs_clarification'] as const) {
    const previous = run(status);
    assert.equal(mergeRunUpdate(previous, run('running')), previous);
  }
  assert.equal(mergeRunUpdate(run('running'), run('completed')).status, 'completed');
});

test('run adoption requires the exact project source and task version', () => {
  const value = run('completed');
  assert.equal(runBelongsTo(value, 'project', 'source', 'task'), true);
  for (const context of [['other', 'source', 'task'], ['project', 'new-source', 'task'], ['project', 'source', 'new-task']]) {
    assert.equal(runBelongsTo(value, context[0], context[1], context[2]), false);
  }
});

test('absence applies to the entire interval including overlapping shifts', () => {
  const { source, task } = createExample('absence');
  const emily = source.employees.find(e => e.id === 'emily')!;
  assert.equal(availabilityFor(emily, 's06', task, source), 'unavailable');
  assert.equal(availabilityFor(emily, 's09', task, source), 'available');
});

test('client display also detects a violated explicit fixed assignment', () => {
  const { source, task, scenarios } = createExample('absence');
  const checks = checkSchedule(source, { ...task, fixedAssignments: { s05: 'daniel' } }, scenarios[0]);
  assert.equal(checks.find(check => check.id === 'pinned')?.status, 'fail');
});
