import type { Band, Cell, CsrState, DayTarget, Operator, Plan, Request, ShiftKind, ShiftTemplate, WeekData, WeekInput } from './types.ts';

export const DEPARTMENT_ZONE = 'America/Los_Angeles';
export const OPEN = 6 * 60;
export const CLOSE = 20 * 60;
export const SLOT = 30;
/** Lunch is not taken in the first or the last hour of a shift. */
export const LUNCH_MARGIN = 60;
/** Two-letter days, as the team writes them in its sheet; used in exports only. */
export const DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'] as const;
export const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

export const TEMPLATES: ShiftTemplate[] = [
  { id: 'e0600', label: '6-2.30', start: 6 * 60, end: 14 * 60 + 30, band: 'early', lunch: true },
  { id: 'd0800', label: '8-4.30', start: 8 * 60, end: 16 * 60 + 30, band: 'day', lunch: true },
  { id: 'd0930', label: '9.30-6', start: 9 * 60 + 30, end: 18 * 60, band: 'day', lunch: true },
  { id: 'l1130', label: '11.30-8', start: 11 * 60 + 30, end: 20 * 60, band: 'late', lunch: true },
  { id: 's1400', label: '2-8', start: 14 * 60, end: 20 * 60, band: 'late', lunch: false },
];

export const templateById = (id: string): ShiftTemplate | undefined => TEMPLATES.find(template => template.id === id);
export const paidMinutes = (template: ShiftTemplate): number => template.end - template.start - (template.lunch ? 30 : 0);
/** The team's own notation, for exports into its sheet. */
export const kindLabel = (kind: ShiftKind): string => kind === 'v' ? 'v' : 'n/v+v';
/** The same in words, for the screen and the PDF. */
export const kindName = (kind: ShiftKind): string => kind === 'v' ? 'Voice' : 'Non-voice';

// Work nicknames only. Zones are generic (no city): fixed offsets, or CET/EET where clocks change.
// `usual` is the band each operator worked in the sample week; it seeds the time-of-day ratings.
const team: [id: string, nick: string, zone: string | null, usual: Band[], short: number][] = [
  ['sam', 'Sam', 'Etc/GMT-5', ['day', 'late'], 3],
  ['may', 'May', 'EET', ['late'], 0],
  ['rachel', 'Rachel', 'Etc/GMT-5', ['early'], 0],
  ['jane', 'Jane', 'Etc/GMT-4', ['day'], 0],
  ['mia', 'Mia', null, ['early', 'late'], 0],
  ['lola', 'Lola', 'Etc/GMT-6', ['day'], 0],
  ['kate', 'Kate', 'Etc/GMT+6', ['early'], 0],
  ['logan', 'Logan', 'CET', ['day'], 0],
  ['amy', 'Amy', 'Etc/GMT-5', ['late'], 0],
  ['sofia', 'Sofia', null, ['early'], 0],
];

export function defaultOperators(): Operator[] {
  return team.map(([id, nick, timeZone, usual, shortShifts]) => ({
    id, nick, timeZone, shiftsPerWeek: 5, shortShifts,
    lines: { voice: 'normal', nonvoice: 'normal' },
    bands: { early: usual.includes('early') ? 'strong' : 'normal', day: usual.includes('day') ? 'strong' : 'normal', late: usual.includes('late') ? 'strong' : 'normal' },
  }));
}

export function defaultTargets(): DayTarget[] {
  return [8, 8, 8, 8, 8, 4, 5].map((headcount, day) => ({ headcount, nonvoice: day === 5 ? 2 : day === 6 ? 3 : 4 }));
}

// The team's own week of Nov 23-29, 2026, as published in their sheet. Cells: template/kind, '-' off, 'vac'.
const SAMPLE_WEEK_START = '2026-11-23';
const sample: Record<string, string> = {
  sam: 's1400/nv d0800/nv s1400/v s1400/v - - d0800/nv',
  may: 'l1130/nv l1130/v l1130/nv l1130/nv l1130/v - -',
  rachel: 'vac - e0600/nv e0600/v e0600/v e0600/nv e0600/nv',
  jane: 'd0800/v d0800/v d0800/v d0800/nv d0800/nv - -',
  mia: 'e0600/v - - e0600/nv e0600/v l1130/nv l1130/v',
  lola: 'd0930/v d0930/nv d0930/nv d0930/v d0930/v - -',
  kate: 'e0600/v e0600/nv e0600/v e0600/v e0600/nv - -',
  logan: 'd0930/nv d0930/v d0930/v d0930/nv d0930/nv - -',
  amy: 'l1130/v l1130/nv - - l1130/nv l1130/v l1130/nv',
  sofia: 'e0600/nv e0600/v e0600/nv - - e0600/v e0600/v',
};

function parseCell(text: string): Cell {
  if (text === '-') return 'off';
  if (text === 'vac') return 'vacation';
  const [templateId, kind] = text.split('/');
  return { templateId, kind: kind as ShiftKind };
}

export function samplePlan(): Plan {
  return Object.fromEntries(Object.entries(sample).map(([id, row]) => [id, row.split(' ').map(parseCell)]));
}

export function emptyRequests(operators: Operator[]): Record<string, Request[]> {
  return Object.fromEntries(operators.map(operator => [operator.id, Array<Request>(7).fill('auto')]));
}

export function emptyWeek(operators: Operator[], targets: DayTarget[] = defaultTargets()): WeekData {
  return { targets: targets.map(target => ({ ...target })), requests: emptyRequests(operators), plan: null, planStatus: null };
}

/** Opens on the team's own published week, so the checks can be read against a schedule they know. */
export function defaultState(): CsrState {
  const operators = defaultOperators();
  const week = emptyWeek(operators);
  week.plan = samplePlan();
  for (const operator of operators) week.plan[operator.id].forEach((cell, day) => { if (cell === 'vacation') week.requests[operator.id][day] = 'vacation'; });
  week.planStatus = { source: 'sample', rulesProven: null, tuned: null, relaxed: null, edited: false, stale: false };
  return { version: 1, operators, weekStart: SAMPLE_WEEK_START, weeks: { [SAMPLE_WEEK_START]: week } };
}

export function weekInput(state: CsrState): WeekInput {
  const week = state.weeks[state.weekStart];
  return { weekStart: state.weekStart, operators: state.operators, targets: week.targets, requests: week.requests };
}
