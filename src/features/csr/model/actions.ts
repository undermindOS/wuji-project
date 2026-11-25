import { SLOTS, emptyRollout, emptyWeek } from './defaults.ts';
import { isShift, sameCell } from './check.ts';
import type { BuildResult } from './build.ts';
import type { Cell, Channel, CsrState, Operator, Request, Rollout, WeekData, WeekInput } from './types.ts';

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
  const released = (rollout: Rollout): Rollout => rollout.map(day => Object.fromEntries(Object.entries(day).map(([channelId, slots]) => [channelId, slots.map(holder => holder === id ? null : holder)])));
  return { ...state, operators: state.operators.filter(operator => operator.id !== id),
    weeks: mapWeeks(state, week => stale({ ...week, requests: without(week.requests), plan: week.plan ? without(week.plan) : null, rollout: released(week.rollout) })) };
}

export function setTarget(state: CsrState, day: number, field: 'headcount' | 'nonvoice', value: number): CsrState {
  return currentWeek(state, week => stale({ ...week, targets: week.targets.map((target, index) => index === day ? { ...target, [field]: value } : target) }));
}

/**
 * Sets one cell by hand. Anything but "auto" is written into the week at once and kept on every rebuild.
 * On a week with no schedule yet, the first hand-set cell starts one: every other cell is a day off
 * until it is set, so a whole week can be put together without the solver.
 */
export function setRequest(state: CsrState, operatorId: string, day: number, request: Request): CsrState {
  return currentWeek(state, week => {
    const requests = { ...week.requests, [operatorId]: (week.requests[operatorId] ?? Array<Request>(7).fill('auto')).map((item, index) => index === day ? request : item) };
    if (request === 'auto') return { ...week, requests };
    const cell: Cell = isShift(request) ? { ...request } : request;
    if (!week.plan) {
      const plan = Object.fromEntries(state.operators.map(operator => [operator.id, Array.from({ length: 7 }, (_, index): Cell => {
        const wanted = requests[operator.id]?.[index] ?? 'auto';
        return wanted === 'auto' ? 'off' : isShift(wanted) ? { ...wanted } : wanted;
      })]));
      return { ...week, requests, plan, planStatus: { source: 'manual', rulesProven: null, tuned: null, relaxed: null, edited: false, stale: false } };
    }
    const before = week.plan[operatorId]?.[day] ?? 'off';
    if (sameCell(before, request)) return { ...week, requests };
    const row = (week.plan[operatorId] ?? Array<Cell>(7).fill('off')).map((item, index) => index === day ? cell : item);
    return { ...week, requests, plan: { ...week.plan, [operatorId]: row }, planStatus: week.planStatus ? { ...week.planStatus, edited: week.planStatus.source !== 'manual' } : week.planStatus };
  });
}

/** Empties the open week: no schedule, no pinned cells, no channel table. Day targets stay. */
export function clearWeek(state: CsrState): CsrState {
  return currentWeek(state, week => ({ ...emptyWeek(state.operators, week.targets) }));
}

/** Puts one operator (or nobody) on a channel for the given half hours of a day. */
export function setChannelHolder(state: CsrState, day: number, channelId: string, slots: number[], operatorId: string | null): CsrState {
  return currentWeek(state, week => {
    const row = [...(week.rollout[day]?.[channelId] ?? Array<string | null>(SLOTS).fill(null))];
    for (const slot of slots) row[slot] = operatorId;
    return { ...week, rollout: week.rollout.map((item, index) => index === day ? { ...item, [channelId]: row } : item) };
  });
}

/** Replaces the whole channel table of a day, e.g. with an automatic draft or with nothing. */
export function setDayRollout(state: CsrState, day: number, table: Record<string, (string | null)[]>): CsrState {
  return currentWeek(state, week => ({ ...week, rollout: (week.rollout.length === 7 ? week.rollout : emptyRollout()).map((item, index) => index === day ? table : item) }));
}

export function addChannel(state: CsrState): CsrState {
  if (state.channels.length >= 12) return state;
  let index = state.channels.length + 1;
  while (state.channels.some(channel => channel.id === `channel-${index}`)) index += 1;
  return { ...state, channels: [...state.channels, { id: `channel-${index}`, name: `Channel ${index}` }] };
}

export function renameChannel(state: CsrState, id: string, name: string): CsrState {
  const next = name.trim().slice(0, 40);
  return next ? { ...state, channels: state.channels.map((channel): Channel => channel.id === id ? { ...channel, name: next } : channel) } : state;
}

/** Removes a channel from the list and from every week's table. */
export function removeChannel(state: CsrState, id: string): CsrState {
  if (state.channels.length <= 1) return state;
  return { ...state, channels: state.channels.filter(channel => channel.id !== id),
    weeks: mapWeeks(state, week => ({ ...week, rollout: week.rollout.map(day => Object.fromEntries(Object.entries(day).filter(([channelId]) => channelId !== id))) })) };
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
