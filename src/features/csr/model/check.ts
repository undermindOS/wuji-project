import { CLOSE, DAY_NAMES, LUNCH_MARGIN, OPEN, SLOT, TEMPLATES, kindName, paidMinutes, templateById } from './defaults.ts';
import { clock } from './time.ts';
import type { Assignment, Cell, CellRef, Check, CheckStatus, Line, Load, Operator, Plan, Request, WeekInput } from './types.ts';

export const isShift = (cell: Cell | Request | undefined): cell is Assignment => typeof cell === 'object' && cell !== null;
export const coversLine = (assignment: Assignment, line: Line): boolean => line === 'voice' || assignment.kind === 'nv';
export const sameCell = (a: Cell | Request, b: Cell | Request): boolean =>
  isShift(a) && isShift(b) ? a.templateId === b.templateId && a.kind === b.kind : a === b;

/** Shifts an operator owes this week: the personal norm, less days already blocked as off or vacation. */
export function requiredShifts(operator: Operator, requests: Request[] | undefined): number {
  const blocked = (requests ?? []).filter(request => request === 'off' || request === 'vacation').length;
  return Math.max(0, Math.min(operator.shiftsPerWeek, 7 - blocked));
}

export interface SlotCoverage { start: number; voice: string[]; nonvoice: string[] }

/** Who is on each line in every 30-minute slot of the department day. */
export function dayCoverage(plan: Plan, operators: Operator[], day: number): SlotCoverage[] {
  const slots: SlotCoverage[] = [];
  for (let start = OPEN; start < CLOSE; start += SLOT) {
    const slot: SlotCoverage = { start, voice: [], nonvoice: [] };
    for (const operator of operators) {
      const cell = plan[operator.id]?.[day];
      const template = isShift(cell) ? templateById(cell.templateId) : undefined;
      if (!isShift(cell) || !template || template.start > start || template.end < start + SLOT) continue;
      slot.voice.push(operator.id);
      if (cell.kind === 'nv') slot.nonvoice.push(operator.id);
    }
    slots.push(slot);
  }
  return slots;
}

/** Operators on `day` who cannot take lunch one at a time without leaving a line empty. */
export function lunchless(plan: Plan, operators: Operator[], day: number): string[] {
  const coverage = dayCoverage(plan, operators, day);
  const options = new Map<string, number[]>();
  for (const operator of operators) {
    const cell = plan[operator.id]?.[day];
    const template = isShift(cell) ? templateById(cell.templateId) : undefined;
    if (!isShift(cell) || !template?.lunch) continue;
    options.set(operator.id, coverage.flatMap((slot, index) =>
      slot.start >= template.start + LUNCH_MARGIN && slot.start + SLOT <= template.end - LUNCH_MARGIN
      && slot.voice.length - 1 >= 1 && slot.nonvoice.length - (cell.kind === 'nv' ? 1 : 0) >= 1 ? [index] : []));
  }
  // Lunch is taken one at a time, so each operator needs a slot of their own: bipartite matching.
  const takenBy = new Map<number, string>();
  const place = (operatorId: string, seen: Set<number>): boolean => {
    for (const slot of options.get(operatorId) ?? []) {
      if (seen.has(slot)) continue;
      seen.add(slot);
      const holder = takenBy.get(slot);
      if (holder === undefined || place(holder, seen)) { takenBy.set(slot, operatorId); return true; }
    }
    return false;
  };
  return [...options.keys()].filter(operatorId => !place(operatorId, new Set()));
}

function gaps(plan: Plan, operators: Operator[], line: Line): { day: number; from: number; to: number }[] {
  const found: { day: number; from: number; to: number }[] = [];
  for (let day = 0; day < 7; day += 1) {
    for (const slot of dayCoverage(plan, operators, day)) {
      if (slot[line].length) continue;
      const last = found[found.length - 1];
      if (last && last.day === day && last.to === slot.start) last.to = slot.start + SLOT;
      else found.push({ day, from: slot.start, to: slot.start + SLOT });
    }
  }
  return found;
}

const listed = (items: string[], limit = 6): string => items.length > limit ? `${items.slice(0, limit).join('; ')}; and ${items.length - limit} more` : items.join('; ');

export function checkWeek(input: WeekInput, plan: Plan): Check[] {
  const { operators, requests } = input;
  const checks: Check[] = [];
  const add = (id: string, label: string, status: CheckStatus, detail: string, cells: CellRef[] = []) => { checks.push({ id, label, status, detail, cells }); };
  const working = (day: number) => operators.filter(operator => isShift(plan[operator.id]?.[day]));

  for (const [line, name, verb] of [['voice', 'Voice line', 'takes calls'], ['nonvoice', 'Non-voice line', 'works the non-voice channels']] as const) {
    const found = gaps(plan, operators, line);
    add(`coverage-${line}`, `${name} covered 6 AM–8 PM`, found.length ? 'fail' : 'pass',
      found.length ? `Nobody ${verb}: ${listed(found.map(gap => `${DAY_NAMES[gap.day]} ${clock(gap.from)}–${clock(gap.to)}`))}.` : `At least one operator ${verb} at every moment of all seven days.`,
      [...new Set(found.map(gap => gap.day))].flatMap(day => working(day).map(operator => ({ operatorId: operator.id, day }))));
  }

  const noLunch = Array.from({ length: 7 }, (_, day) => lunchless(plan, operators, day).map(operatorId => ({ operatorId, day }))).flat();
  add('lunch', 'Lunch possible on every 8.5-hour shift', noLunch.length ? 'fail' : 'pass',
    noLunch.length ? `No 30-minute slot where both lines stay covered: ${listed(noLunch.map(ref => `${operators.find(operator => operator.id === ref.operatorId)!.nick} ${DAY_NAMES[ref.day]}`))}.`
      : 'Every operator can take the mandatory lunch, one at a time, while both lines stay covered.', noLunch);

  const loads = workloads(input, plan);
  const offNorm = operators.filter(operator => loads[operator.id].shifts !== loads[operator.id].required);
  add('norm', 'Weekly norm', offNorm.length ? 'warn' : 'pass',
    offNorm.length ? `Shifts differ from the norm: ${listed(offNorm.map(operator => `${operator.nick} ${loads[operator.id].shifts}/${loads[operator.id].required}`))}.` : 'Every operator has exactly their number of shifts.',
    offNorm.flatMap(operator => Array.from({ length: 7 }, (_, day) => ({ operatorId: operator.id, day })).filter(ref => isShift(plan[operator.id]?.[ref.day]))));

  const excluded: CellRef[] = [], weak: CellRef[] = [], noShort: CellRef[] = [], broken: CellRef[] = [], unknown: CellRef[] = [];
  const names: Record<string, string[]> = { excluded: [], weak: [], noShort: [], broken: [], unknown: [] };
  for (const operator of operators) {
    const shortDays: number[] = [];
    for (let day = 0; day < 7; day += 1) {
      const cell = plan[operator.id]?.[day] ?? 'off';
      const request = requests[operator.id]?.[day] ?? 'auto';
      const ref = { operatorId: operator.id, day };
      const where = `${operator.nick} ${DAY_NAMES[day]}`;
      if (request !== 'auto' && !sameCell(request, cell)) {
        broken.push(ref);
        names.broken.push(`${where} (${isShift(request) ? 'pinned shift' : request === 'off' ? 'day off' : 'vacation'})`);
      }
      if (!isShift(cell)) continue;
      const template = templateById(cell.templateId);
      if (!template) { unknown.push(ref); names.unknown.push(where); continue; }
      const line = operator.lines[cell.kind === 'v' ? 'voice' : 'nonvoice'];
      const band = operator.bands[template.band];
      if (line === 'never' || band === 'never') { excluded.push(ref); names.excluded.push(`${where} (${line === 'never' ? kindName(cell.kind).toLowerCase() : `${template.band} shifts`})`); }
      else if (line === 'weak' || band === 'weak') { weak.push(ref); names.weak.push(`${where} (${line === 'weak' ? kindName(cell.kind).toLowerCase() : `${template.band} shifts`})`); }
      if (!template.lunch) shortDays.push(day);
    }
    if (shortDays.length > operator.shortShifts) {
      noShort.push(...shortDays.map(day => ({ operatorId: operator.id, day })));
      names.noShort.push(`${operator.nick} ${shortDays.length}/${operator.shortShifts}`);
    }
  }
  add('strengths', 'Strengths and weak sides', excluded.length || unknown.length ? 'fail' : weak.length ? 'warn' : 'pass',
    excluded.length ? `Assigned where the operator is marked “never”: ${listed(names.excluded)}.` : unknown.length ? `Unknown shift: ${listed(names.unknown)}.`
      : weak.length ? `Assigned on a weak side: ${listed(names.weak)}.` : 'Nobody works a line or a time of day marked weak or “never”.',
    [...excluded, ...unknown, ...weak]);
  add('short', 'Short 2-8 shifts', noShort.length ? 'fail' : 'pass',
    noShort.length ? `More 6-hour shifts than the operator allows: ${listed(names.noShort)}.` : 'Nobody has more 6-hour shifts than their weekly allowance.', noShort);
  add('requests', 'Days off, vacations and pinned shifts', broken.length ? 'fail' : 'pass',
    broken.length ? `The week differs from a request: ${listed(names.broken)}.` : 'Every requested day off, vacation and pinned shift is kept.', broken);
  return checks;
}

export function overall(checks: Check[]): CheckStatus {
  return checks.some(check => check.status === 'fail') ? 'fail' : checks.some(check => check.status === 'warn') ? 'warn' : 'pass';
}

export function workloads(input: WeekInput, plan: Plan): Record<string, Load> {
  return Object.fromEntries(input.operators.map(operator => {
    const load: Load = { shifts: 0, required: requiredShifts(operator, input.requests[operator.id]), paidMinutes: 0, voice: 0, nonvoice: 0, bands: { early: 0, day: 0, late: 0 }, weekend: 0, templates: 0 };
    const used = new Set<string>();
    (plan[operator.id] ?? []).forEach((cell, day) => {
      const template = isShift(cell) ? templateById(cell.templateId) : undefined;
      if (!isShift(cell) || !template) return;
      load.shifts += 1;
      load.paidMinutes += paidMinutes(template);
      load[cell.kind === 'v' ? 'voice' : 'nonvoice'] += 1;
      load.bands[template.band] += 1;
      if (day >= 5) load.weekend += 1;
      used.add(template.id);
    });
    load.templates = used.size;
    return [operator.id, load];
  }));
}

/** Per-day headcount and how many of them are on a non-voice (n/v+v) shift. */
export function dayCounts(plan: Plan, operators: Operator[]): { headcount: number; nonvoice: number }[] {
  return Array.from({ length: 7 }, (_, day) => {
    const cells = operators.map(operator => plan[operator.id]?.[day]).filter(isShift);
    return { headcount: cells.length, nonvoice: cells.filter(cell => cell.kind === 'nv').length };
  });
}

export const ALL_OPTIONS: Assignment[] = TEMPLATES.flatMap(template => (['v', 'nv'] as const).map(kind => ({ templateId: template.id, kind })));
