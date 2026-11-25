import { SLOTS, defaultChannels, emptyWeek, templateById } from './defaults.ts';
import { isMonday, isValidZone } from './time.ts';
import type { Cell, Channel, CsrState, DayTarget, Operator, PlanStatus, Rating, Request, Rollout, WeekData } from './types.ts';

export const STORAGE_KEY = 'wuji.csr.v1';
const RATINGS: Rating[] = ['strong', 'normal', 'weak', 'never'];
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isCount = (value: unknown, max: number): value is number => Number.isInteger(value) && (value as number) >= 0 && (value as number) <= max;
const isRating = (value: unknown): value is Rating => RATINGS.includes(value as Rating);

function parseAssignment(value: unknown): Request | null {
  if (!isObject(value) || typeof value.templateId !== 'string' || !templateById(value.templateId) || (value.kind !== 'v' && value.kind !== 'nv')) return null;
  return { templateId: value.templateId, kind: value.kind };
}

function parseOperator(value: unknown): Operator | string {
  if (!isObject(value)) return 'an operator is not an object';
  const { id, nick, timeZone, shiftsPerWeek, shortShifts, lines, bands } = value;
  if (typeof id !== 'string' || !/^[a-z0-9-]{1,40}$/.test(id)) return 'an operator id is missing or malformed';
  if (typeof nick !== 'string' || !nick.trim() || nick.length > 40) return `operator ${id}: the nickname is empty or too long`;
  if (timeZone !== null && (typeof timeZone !== 'string' || !isValidZone(timeZone))) return `operator ${nick}: unknown time zone`;
  if (!isCount(shiftsPerWeek, 7) || !isCount(shortShifts, 7)) return `operator ${nick}: shifts per week must be 0–7`;
  if (!isObject(lines) || !isRating(lines.voice) || !isRating(lines.nonvoice)) return `operator ${nick}: line ratings are missing`;
  if (!isObject(bands) || !isRating(bands.early) || !isRating(bands.day) || !isRating(bands.late)) return `operator ${nick}: time-of-day ratings are missing`;
  return { id, nick, timeZone, shiftsPerWeek, shortShifts, lines: { voice: lines.voice, nonvoice: lines.nonvoice }, bands: { early: bands.early, day: bands.day, late: bands.late } };
}

function parseWeek(value: unknown, operators: Operator[], label: string): WeekData | string {
  if (!isObject(value)) return `week ${label} is not an object`;
  const week = emptyWeek(operators);
  if (!Array.isArray(value.targets) || value.targets.length !== 7) return `week ${label}: seven day targets are required`;
  const targets: DayTarget[] = [];
  for (const target of value.targets) {
    if (!isObject(target) || !isCount(target.headcount, 99) || !isCount(target.nonvoice, 99)) return `week ${label}: a day target is not a number`;
    targets.push({ headcount: target.headcount, nonvoice: target.nonvoice });
  }
  week.targets = targets;
  const requests = isObject(value.requests) ? value.requests : {};
  const plan = value.plan === null || value.plan === undefined ? null : value.plan;
  if (plan !== null && !isObject(plan)) return `week ${label}: the schedule is malformed`;
  if (plan) week.plan = {};
  for (const operator of operators) {
    const row = requests[operator.id];
    if (row !== undefined) {
      if (!Array.isArray(row) || row.length !== 7) return `week ${label}: requests for ${operator.nick} need seven days`;
      const parsed = row.map(item => item === 'auto' || item === 'off' || item === 'vacation' ? item : parseAssignment(item));
      if (parsed.some(item => item === null)) return `week ${label}: an unknown request for ${operator.nick}`;
      week.requests[operator.id] = parsed as Request[];
    }
    if (plan && week.plan) {
      const cells = plan[operator.id];
      // An operator added after the week was built simply has no shifts in it yet.
      if (cells === undefined) { week.plan[operator.id] = Array<Cell>(7).fill('off'); continue; }
      if (!Array.isArray(cells) || cells.length !== 7) return `week ${label}: the schedule row for ${operator.nick} needs seven days`;
      const parsed = cells.map(item => item === 'off' || item === 'vacation' ? item : parseAssignment(item));
      if (parsed.some(item => item === null)) return `week ${label}: an unknown shift for ${operator.nick}`;
      week.plan[operator.id] = parsed as Cell[];
    }
  }
  if (week.plan) {
    const status = value.planStatus;
    const fallback: PlanStatus = { source: 'solver', rulesProven: null, tuned: null, relaxed: null, edited: true, stale: true };
    week.planStatus = isObject(status) && (status.source === 'sample' || status.source === 'solver' || status.source === 'manual') ? {
      source: status.source,
      rulesProven: typeof status.rulesProven === 'boolean' ? status.rulesProven : null,
      tuned: typeof status.tuned === 'boolean' ? status.tuned : null,
      relaxed: isCount(status.relaxed, 10_000) ? status.relaxed : null,
      edited: status.edited === true, stale: status.stale === true,
    } : fallback;
  }
  // Weeks saved before channels existed simply have none assigned.
  if (value.rollout !== undefined) {
    const rollout = parseRollout(value.rollout);
    if (!rollout) return `week ${label}: the non-voice channel table is malformed`;
    week.rollout = rollout;
  }
  return week;
}

function parseRollout(value: unknown): Rollout | null {
  if (!Array.isArray(value) || value.length !== 7) return null;
  const rollout: Rollout = [];
  for (const day of value) {
    if (!isObject(day) || Object.keys(day).length > 24) return null;
    const channels: Record<string, (string | null)[]> = {};
    for (const [channelId, slots] of Object.entries(day)) {
      if (!Array.isArray(slots) || slots.length !== SLOTS || !slots.every(slot => slot === null || (typeof slot === 'string' && slot.length <= 40))) return null;
      channels[channelId] = slots as (string | null)[];
    }
    rollout.push(channels);
  }
  return rollout;
}

function parseChannels(value: unknown): Channel[] | string {
  if (value === undefined) return defaultChannels();
  if (!Array.isArray(value) || value.length > 12) return 'the list of non-voice channels is malformed';
  const channels: Channel[] = [];
  for (const item of value) {
    if (!isObject(item) || typeof item.id !== 'string' || !/^[a-z0-9-]{1,40}$/.test(item.id) || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 40) return 'a non-voice channel has no id or name';
    if (channels.some(channel => channel.id === item.id)) return `channel id ${item.id} appears twice`;
    channels.push({ id: item.id, name: item.name });
  }
  return channels;
}

/** Reads a saved or imported state. Anything unexpected is refused with a reason, never patched silently. */
export function parseState(text: string): { state: CsrState } | { error: string } {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return { error: 'The file is not valid JSON.' }; }
  if (!isObject(raw) || raw.version !== 1) return { error: 'This is not a WUJI schedule file (version 1).' };
  if (!Array.isArray(raw.operators) || !raw.operators.length || raw.operators.length > 60) return { error: 'The file needs between 1 and 60 operators.' };
  const operators: Operator[] = [];
  for (const item of raw.operators) {
    const operator = parseOperator(item);
    if (typeof operator === 'string') return { error: `Cannot read the team: ${operator}.` };
    if (operators.some(existing => existing.id === operator.id)) return { error: `Cannot read the team: operator id ${operator.id} appears twice.` };
    operators.push(operator);
  }
  const channels = parseChannels(raw.channels);
  if (typeof channels === 'string') return { error: `Cannot read the file: ${channels}.` };
  if (typeof raw.weekStart !== 'string' || !isMonday(raw.weekStart)) return { error: 'The current week must start on a Monday.' };
  if (!isObject(raw.weeks) || Object.keys(raw.weeks).length > 520) return { error: 'The list of weeks is missing.' };
  const weeks: Record<string, WeekData> = {};
  for (const [start, value] of Object.entries(raw.weeks)) {
    if (!isMonday(start)) return { error: `Week ${start} does not start on a Monday.` };
    const week = parseWeek(value, operators, start);
    if (typeof week === 'string') return { error: `Cannot read ${week}.` };
    weeks[start] = week;
  }
  if (!weeks[raw.weekStart]) weeks[raw.weekStart] = emptyWeek(operators);
  return { state: { version: 1, operators, channels, weekStart: raw.weekStart, weeks } };
}

export const serializeState = (state: CsrState): string => JSON.stringify(state, null, 2);
