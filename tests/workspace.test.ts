import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { demoWorkspaceClient } from '../src/features/workspace/api/WorkspaceClient.ts';
import { createExample, EXAMPLES } from '../src/features/workspace/data/examples.ts';
import { assignmentsOf, checkDemoSchedule, durationMinutes, getMetrics, overallStatus, shiftCostMinor } from '../src/features/workspace/model/schedule.ts';

test('the source has 10 people, 14 eight-hour shifts, and manually reconciled payroll', () => {
  const { source, task } = createExample('unchanged');
  const scenario = createExample('unchanged').scenarios[0];
  assert.equal(source.employees.length, 10);
  assert.equal(source.shifts.length, 14);
  assert(source.shifts.every(shift => durationMinutes(shift) === 480));
  assert.equal(getMetrics(source, scenario).totalMinutes, 112 * 60);
  // Rates by shift: 300+280+260+300+300+280+280+250+300+300+270+260+280+240.
  assert.equal(getMetrics(source, scenario).costMinor, 31_200_00);
  assert.equal(overallStatus(checkDemoSchedule(source, task, scenario)), 'pass');
});

test('one replacement costs 160 RUB and affects exactly Anna and Sofia', () => {
  const { source, task, scenarios } = createExample('absence');
  const metrics = getMetrics(source, scenarios[0]);
  assert.equal(metrics.changes.length, 1);
  assert.equal(metrics.changes[0].shiftId, 's05');
  assert.equal(metrics.changes[0].sourceRow, 6);
  assert.deepEqual(metrics.affectedEmployeeIds.sort(), ['anna', 'sofia']);
  assert.equal(metrics.costMinor, 31_360_00);
  assert.equal(metrics.costDeltaMinor, 160_00);
  assert.equal(overallStatus(checkDemoSchedule(source, task, scenarios[0])), 'pass');
});

test('the economy example costs 480 RUB less with two changes and three affected people', () => {
  const { source, task, scenarios } = createExample('absence');
  const metrics = getMetrics(source, scenarios[1]);
  assert.deepEqual(metrics.changes.map(change => change.shiftId), ['s05', 's08']);
  assert.deepEqual(metrics.affectedEmployeeIds.sort(), ['anna', 'denis', 'oleg']);
  assert.equal(metrics.costMinor, 30_720_00);
  assert.equal(metrics.costDeltaMinor, -480_00);
  assert.equal(metrics.coveredShifts, 14);
  assert.equal(overallStatus(checkDemoSchedule(source, task, scenarios[1])), 'pass');
});

test('unknown rate propagates to total and delta while keeping hours and change count', () => {
  const { source, scenarios } = createExample('missing-rate');
  const metrics = getMetrics(source, scenarios[0]);
  assert.equal(metrics.costMinor, null);
  assert.equal(metrics.costDeltaMinor, null);
  assert.equal(metrics.baselineCostMinor, 31_200_00);
  assert.equal(metrics.totalMinutes, 112 * 60);
  assert.equal(metrics.changes.length, 1);
  assert.deepEqual(metrics.unknownRateEmployeeIds, ['sofia']);
  assert.equal(getMetrics(source, scenarios[1]).costMinor, 30_720_00);
});

test('unknown availability is not treated as a passed check', () => {
  const { source, task, scenarios } = createExample('unknown-availability');
  const checks = checkDemoSchedule(source, task, scenarios[0]);
  assert.equal(overallStatus(checks), 'unknown');
  assert.deepEqual(checks.find(check => check.id === 'availability')?.shiftIds, ['s05']);
  assert.equal(overallStatus(checkDemoSchedule(source, task, scenarios[1])), 'pass');
});

test('the fixed absent assignment is a direct conflict and has no prepared solution', () => {
  const { source, task, scenarios, conflict } = createExample('conflict');
  assert.equal(scenarios.length, 0);
  assert.equal(conflict?.shiftId, 's05');
  assert(source.shifts.find(shift => shift.id === 's05')?.pinned);
  const original = { id: 'original', sourceVersionId: source.id, taskSpecId: task.id, label: '', description: '', assignments: assignmentsOf(source) };
  assert.equal(checkDemoSchedule(source, task, original).find(check => check.id === 'availability')?.status, 'fail');
  const replacement = { ...original, assignments: { ...original.assignments, s05: 'sofia' } };
  assert.equal(checkDemoSchedule(source, task, replacement).find(check => check.id === 'pinned')?.status, 'fail');
});

test('the unchanged example preserves every assignment and costs the same', () => {
  const { source, scenarios } = createExample('unchanged');
  const metrics = getMetrics(source, scenarios[0]);
  assert.equal(metrics.changes.length, 0);
  assert.equal(metrics.affectedEmployeeIds.length, 0);
  assert.equal(metrics.costDeltaMinor, 0);
  assert.deepEqual(scenarios[0].assignments, assignmentsOf(source));
});

test('giving Denis the extra shift without moving Thursday exceeds his weekly limit', () => {
  const { source, task, scenarios } = createExample('absence');
  const bad = { ...scenarios[0], assignments: { ...scenarios[0].assignments, s05: 'denis' } };
  assert.equal(checkDemoSchedule(source, task, bad).find(check => check.id === 'hours')?.status, 'fail');
});

test('overlapping, unqualified, and changed pinned assignments are detected', () => {
  const { source, task, scenarios } = createExample('unchanged');
  const bad = { ...scenarios[0], assignments: { ...scenarios[0].assignments, s02: 'anna' } };
  const checks = checkDemoSchedule(source, task, bad);
  for (const id of ['overlap', 'roles', 'pinned']) assert.equal(checks.find(check => check.id === id)?.status, 'fail', id);
});

test('uncovered shifts, unknown employees, and stale versions cannot pass', () => {
  const { source, task, scenarios } = createExample('absence');
  const bad = { ...scenarios[0], sourceVersionId: 'stale', assignments: { ...scenarios[0].assignments, s05: 'unknown-person' } };
  const checks = checkDemoSchedule(source, task, bad);
  assert.equal(checks.find(check => check.id === 'references')?.status, 'fail');
  assert.equal(checks.find(check => check.id === 'coverage')?.status, 'fail');
  assert.equal(getMetrics(source, bad).costMinor, null);
});

test('calculations leave the input unchanged and separately loaded examples do not share state', async () => {
  const first = await demoWorkspaceClient.loadExample('absence');
  const snapshot = structuredClone(first);
  for (const scenario of first.scenarios) { getMetrics(first.source, scenario); checkDemoSchedule(first.source, first.task, scenario); }
  assert.deepEqual(first, snapshot);
  first.source.employees[0].name = 'Changed locally';
  const second = await demoWorkspaceClient.loadExample('absence');
  assert.equal(second.source.employees[0].name, 'Anna Volkova');
});

test('an aborted load rejects without supplying a stale example', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(demoWorkspaceClient.loadExample('absence', controller.signal), { name: 'AbortError' });
});

test('cost rounding is performed per shift in minor units', () => {
  const { source } = createExample('absence');
  const shortShift = { ...source.shifts[0], endsAt: '2026-11-02T09:01:00+03:00' };
  assert.equal(shiftCostMinor(shortShift, { ...source.employees[0], ratePerHourMinor: 90 }), 2);
});

test('every example has stable scenario references', () => {
  for (const option of EXAMPLES) {
    const example = createExample(option.id);
    const ids = new Set(example.source.shifts.map(shift => shift.id));
    for (const scenario of example.scenarios) {
      assert.deepEqual(new Set(Object.keys(scenario.assignments)), ids);
      assert.equal(scenario.sourceVersionId, example.source.id);
      assert.equal(scenario.taskSpecId, example.task.id);
    }
  }
});

test('inspectable CSV bundles match source rows, rates, availability, and versioned conditions', async () => {
  for (const option of EXAMPLES) {
    const { source, task } = createExample(option.id);
    const base = new URL(`../docs/examples/${option.id}/`, import.meta.url);
    const schedule = (await readFile(new URL(source.filename, base), 'utf8')).trimEnd().split('\n');
    assert.equal(schedule.length, 15);
    assert.equal(schedule[5], `s05,2026-11-04T09:00:00+03:00,2026-11-04T17:00:00+03:00,Specialist,anna,${option.id === 'conflict'}`);
    const people = (await readFile(new URL('employees.csv', base), 'utf8')).trimEnd().split('\n');
    assert.equal(people.length, 11);
    assert.equal(people[10], `sofia,Sofia Lee,Specialist,${option.id === 'missing-rate' ? '' : '32000'},960,RUB`);
    const availability = (await readFile(new URL('availability.csv', base), 'utf8')).trimEnd().split('\n');
    assert.equal(availability.length, 141);
    assert(availability.includes(`sofia,s05,${option.id === 'unknown-availability' ? 'unknown' : 'available'}`));
    const conditions = JSON.parse(await readFile(new URL('conditions.json', base), 'utf8'));
    assert.equal(conditions.sourceVersionId, source.id);
    assert.deepEqual(conditions.task, task);
  }
});
