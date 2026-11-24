import assert from 'node:assert/strict';
import test from 'node:test';
import highsLoader from 'highs';
import { solveWeek } from '../src/features/csr/model/build.ts';
import type { LpSolver } from '../src/features/csr/model/build.ts';
import { checkWeek, dayCounts, isShift, lunchless, overall, workloads } from '../src/features/csr/model/check.ts';
import { TEMPLATES, defaultState, emptyRequests, weekInput } from '../src/features/csr/model/defaults.ts';
import { toCsv, toHtml } from '../src/features/csr/model/export.ts';
import { parseState, serializeState } from '../src/features/csr/model/storage.ts';
import { clock, instantOf, isMonday, localRange, mondayOf, offsetLabel, weekDates } from '../src/features/csr/model/time.ts';
import type { Cell, Plan, WeekInput } from '../src/features/csr/model/types.ts';

const solver = await highsLoader() as unknown as LpSolver;
const sample = () => { const state = defaultState(); return { input: weekInput(state), plan: state.weeks[state.weekStart].plan! }; };
const status = (input: WeekInput, plan: Plan, id: string) => checkWeek(input, plan).find(check => check.id === id)!;
const off = (): Cell[] => Array<Cell>(7).fill('off');

test('the team’s own published week passes every rule', () => {
  const { input, plan } = sample();
  assert.deepEqual(checkWeek(input, plan).map(check => [check.id, check.status]), [
    ['coverage-voice', 'pass'], ['coverage-nonvoice', 'pass'], ['lunch', 'pass'], ['norm', 'pass'], ['strengths', 'pass'], ['short', 'pass'], ['requests', 'pass'],
  ]);
  assert.deepEqual(dayCounts(plan, input.operators).map(day => day.headcount), [9, 8, 8, 8, 8, 4, 5]);
  const loads = workloads(input, plan);
  assert.deepEqual([loads.sam.shifts, loads.sam.paidMinutes, loads.may.paidMinutes, loads.rachel.required], [5, 34 * 60, 40 * 60, 5]);
  assert.deepEqual([loads.amy.weekend, loads.mia.templates, loads.jane.voice, loads.jane.nonvoice], [2, 2, 3, 2]);
});

test('an n/v+v operator covers both lines; a voice-only operator does not cover non-voice', () => {
  const { input, plan } = sample();
  // Saturday morning in the sample: Rachel on n/v+v and Sofia on voice.
  plan.sofia[5] = 'off';
  assert.equal(status(input, plan, 'coverage-voice').status, 'pass');
  plan.rachel[5] = { templateId: 'e0600', kind: 'v' };
  const nonvoice = status(input, plan, 'coverage-nonvoice');
  assert.equal(nonvoice.status, 'fail');
  assert.match(nonvoice.detail, /Sa 6 AM–11:30 AM/);
});

test('lunch needs a slot inside the shift where both lines stay covered without the operator', () => {
  const { input } = sample();
  const plan: Plan = Object.fromEntries(input.operators.map(operator => [operator.id, off()]));
  // Two n/v+v operators who overlap only 2:00-2:30 PM, the last hour of the early shift.
  plan.rachel[0] = { templateId: 'e0600', kind: 'nv' };
  plan.sam[0] = { templateId: 's1400', kind: 'nv' };
  assert.deepEqual(lunchless(plan, input.operators, 0), ['rachel']);
  // A second early operator on voice lets them eat in turn only if non-voice also stays covered.
  plan.sofia[0] = { templateId: 'e0600', kind: 'v' };
  assert.deepEqual(lunchless(plan, input.operators, 0), ['rachel']);
  plan.sofia[0] = { templateId: 'e0600', kind: 'nv' };
  assert.deepEqual(lunchless(plan, input.operators, 0), []);
  assert.match(status(input, { ...plan, sofia: off() }, 'lunch').detail, /Rachel Mo/);
});

test('norm, strengths, short shifts and requests are checked against the team settings', () => {
  const { input, plan } = sample();
  input.operators.find(operator => operator.id === 'logan')!.lines.nonvoice = 'weak';
  input.operators.find(operator => operator.id === 'kate')!.bands.early = 'never';
  input.operators.find(operator => operator.id === 'sam')!.shortShifts = 2;
  input.requests.may[0] = 'off';
  input.requests.amy[0] = { templateId: 'l1130', kind: 'nv' };
  plan.lola[5] = { templateId: 'd0930', kind: 'v' };
  const checks = Object.fromEntries(checkWeek(input, plan).map(check => [check.id, check]));
  assert.equal(checks.norm.status, 'warn');
  assert.match(checks.norm.detail, /Lola 6\/5/);
  assert.equal(checks.strengths.status, 'fail');
  assert.match(checks.strengths.detail, /Kate Mo \(early\)/);
  assert.equal(checks.short.status, 'fail');
  assert.match(checks.short.detail, /Sam 3\/2/);
  assert.equal(checks.requests.status, 'fail');
  assert.match(checks.requests.detail, /May Mo \(day off\)/);
  assert.match(checks.requests.detail, /Amy Mo \(pinned shift\)/);
  assert.equal(overall(Object.values(checks)), 'fail');
  input.operators.find(operator => operator.id === 'kate')!.bands.early = 'normal';
  assert.equal(status(input, plan, 'strengths').status, 'warn');
  assert.match(status(input, plan, 'strengths').detail, /Logan Mo \(n\/v\+v\)/);
});

test('the solver builds a week from scratch that the independent checks accept', () => {
  const { input } = sample();
  input.requests = emptyRequests(input.operators);
  input.requests.rachel[0] = 'vacation';
  input.requests.kate[2] = 'off';
  input.requests.amy[4] = { templateId: 'e0600', kind: 'v' };
  input.operators.find(operator => operator.id === 'may')!.lines.nonvoice = 'never';
  input.operators.find(operator => operator.id === 'lola')!.bands.late = 'never';
  const result = solveWeek(input, solver);
  assert.equal(result.rulesProven, true);
  assert.deepEqual(result.relaxed, { coverage: 0, lunch: 0, norm: 0 });
  const plan = result.plan!;
  assert.deepEqual(checkWeek(input, plan).filter(check => check.status === 'fail'), []);
  assert.equal(status(input, plan, 'norm').status, 'pass');
  assert.equal(plan.rachel[0], 'vacation');
  assert.equal(plan.kate[2], 'off');
  assert.deepEqual(plan.amy[4], { templateId: 'e0600', kind: 'v' });
  assert.ok(plan.may.every(cell => !isShift(cell) || cell.kind === 'v'));
  assert.ok(plan.lola.every(cell => !isShift(cell) || TEMPLATES.find(template => template.id === cell.templateId)!.band !== 'late'));
  assert.ok(plan.sam.filter(cell => isShift(cell) && cell.templateId === 's1400').length <= 3);
  assert.ok(input.operators.every(operator => operator.id === 'sam' || plan[operator.id].every(cell => !isShift(cell) || cell.templateId !== 's1400')));
});

test('when no week can satisfy the rules, the solver says so and returns the closest week', () => {
  const { input } = sample();
  input.requests = emptyRequests(input.operators);
  // Everyone is on vacation on Saturday except one operator, who cannot cover 6 AM-8 PM alone.
  for (const operator of input.operators) if (operator.id !== 'kate') input.requests[operator.id][5] = 'vacation';
  const result = solveWeek(input, solver);
  assert.equal(result.rulesProven, true);
  assert.ok(result.relaxed.coverage > 0);
  const plan = result.plan!;
  assert.deepEqual(plan.kate[5], { templateId: 'e0600', kind: 'nv' });
  assert.match(status(input, plan, 'coverage-nonvoice').detail, /Sa 2:30 PM–8 PM/);
  assert.equal(status(input, plan, 'coverage-voice').status, 'fail');
  assert.equal(status(input, plan, 'lunch').status, 'fail');
  // The rest of the week is untouched by the impossible Saturday.
  assert.equal(status(input, plan, 'norm').status, 'pass');
  assert.equal(status(input, plan, 'requests').status, 'pass');
  assert.ok(checkWeek(input, plan).filter(check => check.status === 'fail').every(check => check.cells.every(ref => ref.day === 5)));
});

test('shift hours are shown on each operator’s own clock', () => {
  const late = TEMPLATES.find(template => template.id === 'l1130')!;
  const early = TEMPLATES.find(template => template.id === 'e0600')!;
  assert.equal(localRange('2026-11-23', late, 'Etc/GMT-5'), '00:30 +1–09:00 +1');
  assert.equal(localRange('2026-11-23', early, 'Etc/GMT+6'), '08:00–16:30');
  // Europe is back on winter time a week before the US in autumn, and a week later in spring.
  assert.equal(localRange('2026-10-26', early, 'CET'), '14:00–22:30');
  assert.equal(localRange('2026-11-23', early, 'CET'), '15:00–23:30');
  assert.equal(offsetLabel('CET', instantOf('2026-11-23', 360)), 'UTC+1');
  assert.equal(offsetLabel('Etc/GMT+6', instantOf('2026-11-23', 360)), 'UTC−6');
  assert.equal(new Date(instantOf('2026-11-23', 360)).toISOString(), '2026-11-23T14:00:00.000Z');
  assert.equal(new Date(instantOf('2026-07-06', 360)).toISOString(), '2026-07-06T13:00:00.000Z');
  assert.deepEqual([clock(360), clock(870), clock(720), clock(1200)], ['6 AM', '2:30 PM', '12 PM', '8 PM']);
  assert.deepEqual([mondayOf('2026-11-29'), mondayOf('2026-11-23'), mondayOf('2026-11-25')], ['2026-11-23', '2026-11-23', '2026-11-23']);
  assert.deepEqual([isMonday('2026-11-23'), isMonday('2026-11-24'), isMonday('2026-02-30'), isMonday('x')], [true, false, false, false]);
  assert.equal(weekDates('2026-11-23')[6], '2026-11-29');
});

test('a saved file round-trips, and a damaged one is refused with a reason', () => {
  const state = defaultState();
  const parsed = parseState(serializeState(state));
  assert.deepEqual('state' in parsed && parsed.state, state);
  const broken = (change: (raw: any) => void) => { const raw = JSON.parse(serializeState(state)); change(raw); const result = parseState(JSON.stringify(raw)); return 'error' in result ? result.error : 'accepted'; };
  assert.match(broken(raw => { raw.version = 2; }), /not a WUJI schedule file/);
  assert.match(broken(raw => { raw.operators[0].timeZone = 'Mars/Olympus'; }), /Sam: unknown time zone/);
  assert.match(broken(raw => { raw.operators[1].lines.voice = 'great'; }), /May: line ratings/);
  assert.match(broken(raw => { raw.operators[1].id = 'sam'; }), /appears twice/);
  assert.match(broken(raw => { raw.weekStart = '2026-11-24'; }), /Monday/);
  assert.match(broken(raw => { raw.weeks['2026-11-23'].plan.sam[0] = { templateId: 'nope', kind: 'v' }; }), /unknown shift for Sam/);
  assert.match(broken(raw => { raw.weeks['2026-11-23'].targets.pop(); }), /seven day targets/);
  assert.match('error' in parseState('{') ? 'not valid JSON' : '', /not valid JSON/);
});

test('the export keeps the team’s two-line cells and never emits a formula', () => {
  const { input, plan } = sample();
  input.operators[0].nick = '=SUM(A1)';
  const csv = toCsv(input.weekStart, input.operators, plan);
  const lines = csv.split('\r\n');
  assert.equal(lines[0], 'Work Nick Name,11/23 Mo,11/24 Tu,11/25 We,11/26 Th,11/27 Fr,11/28 Sa,11/29 Su');
  assert.ok(csv.includes('\'=SUM(A1),"2-8\nn/v+v","8-4.30\nn/v+v","2-8\nv","2-8\nv",off,off,"8-4.30\nn/v+v"'));
  assert.ok(csv.includes('Rachel,vacation,off,"6-2.30\nn/v+v"'));
  assert.ok(toHtml(input.weekStart, [{ ...input.operators[0], nick: '<b>' }], plan).includes('<td>&lt;b&gt;</td><td>2-8<br>n/v+v</td>'));
});
