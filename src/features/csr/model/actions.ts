import { emptyWeek } from './defaults.ts';
import { isShift, sameCell } from './check.ts';
import type { BuildResult } from './build.ts';
import type { Cell, CsrState, Operator, Request, WeekData, WeekInput } from './types.ts';

const mapWeeks = (state: CsrState, change: (week: WeekData) => WeekData): Record<string, WeekData> =>
  Object.fromEntries(Object.entries(state.weeks).map(([start, week]) => [start, change(week)]));
const stale = (week: WeekData): WeekData => week.planStatus ? { ...week, planStatus: { ...week.planStatus, stale: true } } : week;
const currentWeek = (state: CsrState, change: (week: WeekData) => WeekData): CsrState =>
  ({ ...state, weeks: { ...state.weeks, [state.weekStart]: change(state.weeks[state.weekStart]) } });

/** Team settings feed every week's checks, so every existing plan is marked as built on older settings. */
export function updateOperator(state: CsrState, id: string, patch: Partial<Operator>): CsrState {
  return { ...state, operators: state.operators.map(operator => operator.id === id ? { ...operator, ...patch } : operator), weeks: mapWeeks(state, stale) };
}

export function addOperator(state: CsrState): CsrState {
  let index = state.operators.length + 1;
  while (state.operators.some(operator => operator.id === `op-${index}`)) index += 1;
  const operator: Operator = { id: `op-${index}`, nick: `Operator ${index}`, timeZone: null, shiftsPerWeek: 5, shortShifts: 0,
    lines: { voice: 'normal', nonvoice: 'normal' }, bands: { early: 'normal', day: 'normal', late: 'normal' } };
  return { ...state, operators: [...state.operators, operator], weeks: mapWeeks(state, week => stale({ ...week,
    requests: { ...week.requests, [operator.id]: Array<Request>(7).fill('auto') },
    plan: week.plan ? { ...week.plan, [operator.id]: Array<Cell>(7).fill('off') } : null })) };
}

export function removeOperator(state: CsrState, id: string): CsrState {
  if (state.operators.length <= 1) return state;
  const without = <T,>(rows: Record<string, T>) => Object.fromEntries(Object.entries(rows).filter(([key]) => key !== id));
  return { ...state, operators: state.operators.filter(operator => operator.id !== id),
    weeks: mapWeeks(state, week => stale({ ...week, requests: without(week.requests), plan: week.plan ? without(week.plan) : null })) };
}

export function setTarget(state: CsrState, day: number, field: 'headcount' | 'nonvoice', value: number): CsrState {
  return currentWeek(state, week => stale({ ...week, targets: week.targets.map((target, index) => index === day ? { ...target, [field]: value } : target) }));
}

/** A request pins the cell for the next build; anything but "auto" is also written into the current plan. */
export function setRequest(state: CsrState, operatorId: string, day: number, request: Request): CsrState {
  return currentWeek(state, week => {
    const requests = { ...week.requests, [operatorId]: (week.requests[operatorId] ?? Array<Request>(7).fill('auto')).map((item, index) => index === day ? request : item) };
    if (!week.plan || request === 'auto') return { ...week, requests };
    const before = week.plan[operatorId]?.[day] ?? 'off';
    if (sameCell(before, request)) return { ...week, requests };
    const cell: Cell = isShift(request) ? { ...request } : request;
    const row = (week.plan[operatorId] ?? Array<Cell>(7).fill('off')).map((item, index) => index === day ? cell : item);
    return { ...week, requests, plan: { ...week.plan, [operatorId]: row }, planStatus: week.planStatus ? { ...week.planStatus, edited: true } : week.planStatus };
  });
}

/** Opens a week; a new one starts empty with the day targets of the week it was opened from. */
export function openWeek(state: CsrState, weekStart: string): CsrState {
  if (state.weeks[weekStart]) return { ...state, weekStart };
  return { ...state, weekStart, weeks: { ...state.weeks, [weekStart]: emptyWeek(state.operators, state.weeks[state.weekStart].targets) } };
}

/** Stores a solver result for the week it was started on; `builtFrom` is the input the solver saw. */
export function applyBuild(state: CsrState, weekStart: string, result: BuildResult, builtFrom: WeekInput): CsrState {
  const week = state.weeks[weekStart];
  if (!week || !result.plan) return state;
  const now: WeekInput = { weekStart, operators: state.operators, targets: week.targets, requests: week.requests };
  return { ...state, weeks: { ...state.weeks, [weekStart]: { ...week, plan: result.plan, planStatus: {
    source: 'solver', rulesProven: result.rulesProven, tuned: result.tuned, relaxed: result.relaxed.coverage + result.relaxed.lunch + result.relaxed.norm,
    edited: false, stale: JSON.stringify(now) !== JSON.stringify(builtFrom),
  } } } };
}
