import assert from 'node:assert/strict';
import test from 'node:test';
import { fingerprint } from '../src/features/csr/api/useSharedSync.ts';
import { addChannel, clearWeek, openWeek, removeChannel, removeOperator, renameChannel, setChannelHolder, setDayRollout, setRequest } from '../src/features/csr/model/actions.ts';
import { checkWeek, isShift } from '../src/features/csr/model/check.ts';
import { SLOTS, defaultState, weekInput } from '../src/features/csr/model/defaults.ts';
import { autoFill, channelLoad, nonvoiceSegments, rangeLabel, rolloutIssues, segmentHolder, shiftLabel } from '../src/features/csr/model/rollout.ts';
import { parseState, serializeState } from '../src/features/csr/model/storage.ts';
import { wishLines } from '../src/features/csr/model/wishes.ts';
import type { Wish } from '../src/features/csr/model/types.ts';

const week = (state: ReturnType<typeof defaultState>) => state.weeks[state.weekStart];

test('a week can be put together by hand, cell by cell, with the checks running from the first cell', () => {
  let state = openWeek(defaultState(), '2026-11-30');
  assert.equal(week(state).plan, null);
  // A request made before any schedule exists is carried into the plan when the first cell starts one.
  state = setRequest(state, 'rachel', 0, 'vacation');
  assert.deepEqual([week(state).planStatus?.source, week(state).plan!.rachel[0], week(state).plan!.sam[0]], ['manual', 'vacation', 'off']);
  state = setRequest(state, 'sam', 0, { templateId: 'e0600', kind: 'nv' });
  state = setRequest(state, 'may', 0, { templateId: 'l1130', kind: 'v' });
  const plan = week(state).plan!;
  assert.deepEqual(plan.sam[0], { templateId: 'e0600', kind: 'nv' });
  assert.ok(state.operators.every(operator => plan[operator.id].length === 7));
  assert.equal(week(state).planStatus?.edited, false);
  const checks = Object.fromEntries(checkWeek(weekInput(state), plan).map(check => [check.id, check.status]));
  // Monday 6-8 PM has voice only, the other days have nobody: both gaps are reported, nothing is assumed.
  assert.deepEqual([checks['coverage-voice'], checks['coverage-nonvoice'], checks.requests], ['fail', 'fail', 'pass']);
  // Unpinning hands the cell back to the solver without changing what is in the week now.
  state = setRequest(state, 'may', 0, 'auto');
  assert.deepEqual([week(state).requests.may[0], isShift(week(state).plan!.may[0])], ['auto', true]);
  state = clearWeek(state);
  assert.deepEqual([week(state).plan, week(state).planStatus, week(state).requests.rachel[0]], [null, null, 'auto']);
  assert.deepEqual(week(state).targets, week(defaultState()).targets);
});

test('editing a solver or sample week by hand marks it as edited and pins the cell', () => {
  let state = defaultState();
  state = setRequest(state, 'kate', 5, { templateId: 'e0600', kind: 'v' });
  assert.deepEqual([week(state).planStatus?.source, week(state).planStatus?.edited], ['sample', true]);
  assert.deepEqual(week(state).requests.kate[5], { templateId: 'e0600', kind: 'v' });
  assert.deepEqual(week(state).plan!.kate[5], { templateId: 'e0600', kind: 'v' });
});

test('the channel table is cut where non-voice shifts start and end, as in the team’s own sheet', () => {
  const state = defaultState();
  const segments = nonvoiceSegments(week(state).plan!, state.operators, 0);
  assert.deepEqual(segments.map(segment => [rangeLabel(segment.from, segment.to), segment.operatorIds.join('+')]), [
    ['6:00–9:30 AM', 'sofia'], ['9:30–11:30 AM', 'logan+sofia'], ['11:30 AM–2:00 PM', 'may+logan+sofia'],
    ['2:00–2:30 PM', 'sam+may+logan+sofia'], ['2:30–6:00 PM', 'sam+may+logan'], ['6:00–8:00 PM', 'sam+may'],
  ]);
  assert.equal(segments.reduce((sum, segment) => sum + segment.slots.length, 0), SLOTS);
  assert.equal(shiftLabel(6 * 60, 14 * 60 + 30), '6:00 AM – 2:30 PM');
  const empty = rolloutIssues(segments, state.channels, {});
  assert.deepEqual(empty, { cells: 18, unassigned: 18, invalid: 0, uncovered: 0 });

  const filled = autoFill(segments, state.channels);
  assert.deepEqual(rolloutIssues(segments, state.channels, filled), { cells: 18, unassigned: 0, invalid: 0, uncovered: 0 });
  // Alone in the morning, one operator holds everything; once two are on, nobody holds all three.
  assert.deepEqual(state.channels.map(channel => filled[channel.id][0]), ['sofia', 'sofia', 'sofia']);
  for (const segment of segments.slice(1)) {
    const counts = new Map<string, number>();
    for (const channel of state.channels) counts.set(filled[channel.id][segment.slots[0]]!, (counts.get(filled[channel.id][segment.slots[0]]!) ?? 0) + 1);
    assert.ok(Math.max(...counts.values()) <= Math.ceil(state.channels.length / segment.operatorIds.length));
  }
  assert.equal(Object.values(channelLoad(state.channels, filled)).reduce((sum, value) => sum + value, 0), SLOTS * state.channels.length);
});

test('channel cells follow the schedule: a holder who leaves non-voice is flagged, not silently replaced', () => {
  let state = defaultState();
  const segments = nonvoiceSegments(week(state).plan!, state.operators, 0);
  state = setDayRollout(state, 0, autoFill(segments, state.channels));
  state = setChannelHolder(state, 0, 'slack-tags', segments[1].slots, 'logan');
  assert.equal(segmentHolder(week(state).rollout[0], 'slack-tags', segments[1]), 'logan');
  // Logan moves to voice: the table now names someone who is not on non-voice.
  state = setRequest(state, 'logan', 0, { templateId: 'd0930', kind: 'v' });
  const after = nonvoiceSegments(week(state).plan!, state.operators, 0);
  const issues = rolloutIssues(after, state.channels, week(state).rollout[0]);
  assert.ok(issues.invalid > 0);
  assert.equal(issues.unassigned, 0);
  // Removing the operator empties the cells they held; removing a channel removes its column everywhere.
  state = removeOperator(state, 'logan');
  assert.ok(Object.values(week(state).rollout[0]).every(slots => !slots.includes('logan')));
  state = renameChannel(addChannel(state), 'channel-4', '  SMS 2530  ');
  assert.deepEqual(state.channels.map(channel => channel.name), ['Broccoli', 'All Slack Tags', 'Email + ST Chats', 'SMS 2530']);
  state = removeChannel(state, 'broccoli');
  assert.deepEqual([state.channels.length, 'broccoli' in week(state).rollout[0]], [3, false]);
  assert.equal(renameChannel(state, 'slack-tags', '   ').channels[0].name, 'All Slack Tags');
  // The whole thing still round-trips through the saved form.
  const parsed = parseState(serializeState(state));
  assert.deepEqual('state' in parsed && parsed.state, state);
});

test('data saved before channels and hand-built weeks existed still opens', () => {
  const old = JSON.parse(serializeState(defaultState()));
  delete old.channels;
  for (const item of Object.values(old.weeks) as any[]) delete item.rollout;
  const parsed = parseState(JSON.stringify(old));
  assert.ok('state' in parsed);
  assert.deepEqual('state' in parsed && [parsed.state.channels.length, parsed.state.weeks['2026-11-23'].rollout.length, Object.keys(parsed.state.weeks['2026-11-23'].rollout[0]).length], [3, 7, 0]);
  const broken = (change: (raw: any) => void) => { const raw = JSON.parse(serializeState(defaultState())); change(raw); const result = parseState(JSON.stringify(raw)); return 'error' in result ? result.error : 'accepted'; };
  assert.match(broken(raw => { raw.weeks['2026-11-23'].rollout = [{}]; }), /channel table is malformed/);
  assert.match(broken(raw => { raw.weeks['2026-11-23'].rollout[0].broccoli = ['sam']; }), /channel table is malformed/);
  assert.match(broken(raw => { raw.channels = [{ id: 'a', name: '' }]; }), /channel has no id or name/);
  assert.match(broken(raw => { raw.channels.push({ id: 'broccoli', name: 'Again' }); }), /appears twice/);
  assert.equal(broken(raw => { raw.weeks['2026-11-23'].planStatus.source = 'manual'; }), 'accepted');
});

test('a wish reads as plain lines, and the save fingerprint changes with the content', () => {
  const wish: Wish = { id: 'a', weekStart: '2026-11-23', operatorId: 'kate', nick: 'Kate', days: ['', '', 'off', '', 'off', 'work', ''], shifts: ['e0600', 'd0800'], comment: 'Dentist', createdAt: '2026-11-24T10:00:00.000Z' };
  assert.deepEqual(wishLines(wish), ['Wants the day off: Wed, Fri', 'Wants to work: Sat', 'Preferred hours: 6-2.30, 8-4.30', '“Dentist”']);
  assert.deepEqual(wishLines({ ...wish, days: ['', '', '', '', '', '', ''], shifts: [], comment: '' }), []);
  const text = serializeState(defaultState());
  assert.equal(fingerprint(text), fingerprint(serializeState(defaultState())));
  assert.notEqual(fingerprint(text), fingerprint(text.replace('"Sam"', '"Sami"')));
});
