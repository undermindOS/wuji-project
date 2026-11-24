import { CLOSE, LUNCH_MARGIN, OPEN, SLOT, TEMPLATES } from './defaults.ts';
import { isShift, requiredShifts } from './check.ts';
import type { Assignment, Cell, Operator, Plan, Rating, ShiftKind, ShiftTemplate, WeekInput } from './types.ts';

/** The part of a HiGHS result this module reads. */
export interface LpSolver {
  solve(lp: string, options?: Record<string, string | number | boolean>): { Status: string; Columns: Record<string, { Primal?: number }> };
}

export interface BuildResult {
  /** Null when the solver produced no week at all. */
  plan: Plan | null;
  solverStatus: string;
  /** Hard rules that had to give way, in units of the rule. All zero means every rule holds. */
  relaxed: { coverage: number; lunch: number; norm: number };
  /** The first search finished: the rule violations above are proven to be the fewest possible. */
  rulesProven: boolean;
  /** The second search finished: preferences are within 3% of the best possible. */
  tuned: boolean;
  elapsedMs: number;
}

// Hard rules are elastic, so the solver always returns a week. It searches twice: first for the
// least total violation of the rules, weighted as below; then, without giving any of that back,
// for the best preferences.
const GAP = 10, NO_LUNCH = 2, OFF_NORM = 3;
const RATING_COST: Record<Exclude<Rating, 'never'>, number> = { strong: 0, normal: 2, weak: 12 };
const TARGET = 6, EXTRA_TEMPLATE = 3, SPLIT_DAYS_OFF = 4;

interface Interval { start: number; end: number }

/** Stretches of the day within which shift coverage and lunch windows do not change. */
export function intervals(templates: ShiftTemplate[] = TEMPLATES): Interval[] {
  const points = new Set([OPEN, CLOSE]);
  for (const template of templates) {
    points.add(template.start); points.add(template.end);
    if (template.lunch) { points.add(template.start + LUNCH_MARGIN); points.add(template.end - LUNCH_MARGIN); }
  }
  const sorted = [...points].filter(point => point >= OPEN && point <= CLOSE).sort((a, b) => a - b);
  return sorted.slice(1).map((end, index) => ({ start: sorted[index], end }));
}

function options(operator: Operator, request: WeekInput['requests'][string][number] | undefined): Assignment[] {
  if (request === 'off' || request === 'vacation') return [];
  if (isShift(request)) return TEMPLATES.some(template => template.id === request.templateId) ? [request] : [];
  return TEMPLATES.filter(template => operator.bands[template.band] !== 'never' && (template.lunch || operator.shortShifts > 0))
    .flatMap(template => (['v', 'nv'] as ShiftKind[]).filter(kind => operator.lines[kind === 'v' ? 'voice' : 'nonvoice'] !== 'never').map(kind => ({ templateId: template.id, kind })));
}

type Columns = Record<string, { Primal?: number }>;

export function buildModel(input: WeekInput): {
  lp: (phase: 'rules' | 'preferences', violationCap?: number) => string;
  decode: (columns: Columns) => { plan: Plan; relaxed: BuildResult['relaxed'] };
  violation: (columns: Columns) => number;
  consistent: (columns: Columns) => boolean;
} {
  const { operators, requests, targets } = input;
  const spans = intervals();
  const preferences: string[] = [], rows: string[] = [], binaries: string[] = [], integers: string[] = [];
  const penalties: { weight: number; name: string }[] = [], norms: { names: string[]; operator: number; required: number }[] = [];
  const row = (terms: string[], relation: string, bound: number) => { rows.push(` c${rows.length}: ${terms.join(' ')} ${relation} ${bound}`); };
  const minus = (names: string[]) => names.map(name => `- ${name}`);
  const plus = (names: string[]) => names.map(name => `+ ${name}`);
  const cost = (weight: number, name: string) => { if (weight) preferences.push(`+ ${weight} ${name}`); };
  const penalty = (weight: number, name: string) => { penalties.push({ weight, name }); };
  const assigned: { name: string; operator: number; day: number; template: ShiftTemplate; kind: ShiftKind }[] = [];
  const worked: string[][][] = operators.map(() => Array.from({ length: 7 }, () => []));

  operators.forEach((operator, o) => {
    for (let day = 0; day < 7; day += 1) {
      const request = requests[operator.id]?.[day];
      for (const option of options(operator, request)) {
        const template = TEMPLATES.find(item => item.id === option.templateId)!;
        const name = `x_${o}_${day}_${TEMPLATES.indexOf(template)}_${option.kind}`;
        binaries.push(name); worked[o][day].push(name);
        assigned.push({ name, operator: o, day, template, kind: option.kind });
        if (isShift(request)) row([`+ ${name}`], '=', 1);
        else {
          const line = operator.lines[option.kind === 'v' ? 'voice' : 'nonvoice'], band = operator.bands[template.band];
          cost(RATING_COST[line as Exclude<Rating, 'never'>] + RATING_COST[band as Exclude<Rating, 'never'>], name);
        }
      }
      if (worked[o][day].length > 1) row(plus(worked[o][day]), '<=', 1);
    }
    // Weekly norm, elastic in both directions (pins can push an operator over).
    const all = worked[o].flat();
    const required = requiredShifts(operator, requests[operator.id]);
    row([...plus(all), `+ un_${o}`, `- ov_${o}`], '=', required);
    norms.push({ names: all, operator: o, required });
    penalty(OFF_NORM, `un_${o}`); penalty(OFF_NORM, `ov_${o}`);
    // The 6-hour shift is capped per operator; pinned ones are the scheduler's own decision.
    const pinnedShort = (requests[operator.id] ?? []).filter(request => isShift(request) && TEMPLATES.find(template => template.id === request.templateId)?.lunch === false).length;
    const freeShort = assigned.filter(item => item.operator === o && !item.template.lunch && !isShift(requests[operator.id]?.[item.day])).map(item => item.name);
    if (freeShort.length) row(plus(freeShort), '<=', Math.max(0, operator.shortShifts - pinnedShort));
    // One start time through the week is preferred.
    TEMPLATES.forEach((template, t) => {
      const uses = assigned.filter(item => item.operator === o && item.template === template);
      if (!uses.length) return;
      for (const use of uses) row([`+ u_${o}_${t}`, `- ${use.name}`], '>=', 0);
      cost(EXTRA_TEMPLATE, `u_${o}_${t}`);
    });
    // Days off together are preferred: count the starts of working stretches around the week.
    for (let day = 0; day < 7; day += 1) {
      row([`+ s_${o}_${day}`, ...minus(worked[o][day]), ...plus(worked[o][(day + 6) % 7])], '>=', 0);
      cost(SPLIT_DAYS_OFF, `s_${o}_${day}`);
    }
  });

  for (let day = 0; day < 7; day += 1) {
    const today = assigned.filter(item => item.day === day);
    spans.forEach((span, j) => {
      const on = today.filter(item => item.template.start <= span.start && item.template.end >= span.end);
      const voice = on.map(item => item.name), nonvoice = on.filter(item => item.kind === 'nv').map(item => item.name);
      const halfHours = (span.end - span.start) / SLOT;
      // At least one operator on each line at every moment.
      row([...plus(voice), `+ gv_${day}_${j}`], '>=', 1); penalty(GAP * halfHours, `gv_${day}_${j}`);
      row([...plus(nonvoice), `+ gn_${day}_${j}`], '>=', 1); penalty(GAP * halfHours, `gn_${day}_${j}`);
      // av / an: the line would still be covered with one operator away at lunch.
      binaries.push(`av_${day}_${j}`, `an_${day}_${j}`);
      row([...plus(voice), `- 2 av_${day}_${j}`], '>=', 0);
      row([...plus(nonvoice), `- 2 an_${day}_${j}`], '>=', 0);
      // Operators on the same shift and kind are interchangeable at lunch, so lunches are counted
      // per shift and kind: y = how many of them eat during this stretch, one at a time.
      const eating: string[] = [];
      TEMPLATES.forEach((template, t) => {
        if (!template.lunch || span.start < template.start + LUNCH_MARGIN || span.end > template.end - LUNCH_MARGIN) return;
        for (const kind of ['v', 'nv'] as ShiftKind[]) {
          if (!today.some(item => item.template === template && item.kind === kind)) continue;
          const name = `y${kind}_${day}_${t}_${j}`;
          integers.push(name); eating.push(name);
          row([`+ ${name}`, `- ${halfHours} av_${day}_${j}`], '<=', 0);
          if (kind === 'nv') row([`+ ${name}`, `- ${halfHours} an_${day}_${j}`], '<=', 0);
          else row([`+ ${name}`, ...nonvoice.map(item => `- ${halfHours} ${item}`)], '<=', 0);
        }
      });
      if (eating.length) row(plus(eating), '<=', halfHours);
    });
    TEMPLATES.forEach((template, t) => {
      if (!template.lunch) return;
      for (const kind of ['v', 'nv'] as ShiftKind[]) {
        const people = today.filter(item => item.template === template && item.kind === kind).map(item => item.name);
        if (!people.length) continue;
        const slots = integers.filter(name => name.startsWith(`y${kind}_${day}_${t}_`));
        row([...plus(slots), `+ nl${kind}_${day}_${t}`, ...minus(people)], '=', 0);
        penalty(NO_LUNCH, `nl${kind}_${day}_${t}`);
      }
    });
    // Preferred headcount and non-voice headcount for the day.
    const everyone = today.map(item => item.name), nv = today.filter(item => item.kind === 'nv').map(item => item.name);
    row([...plus(everyone), `+ hu_${day}`, `- ho_${day}`], '=', targets[day]?.headcount ?? 0);
    row([...plus(nv), `+ nu_${day}`, `- no_${day}`], '=', targets[day]?.nonvoice ?? 0);
    for (const name of [`hu_${day}`, `ho_${day}`, `nu_${day}`, `no_${day}`]) cost(TARGET, name);
  }

  const wrap = (terms: string[]) => terms.reduce<string[]>((lines, term, index) => {
    if (index % 6 === 0) lines.push(' ' + term); else lines[lines.length - 1] += ' ' + term;
    return lines;
  }, []).join('\n');
  const body = rows.map(line => line.length > 200 ? line.replace(/ (?=[+-] )/g, '\n ') : line);
  const violationTerms = penalties.map(item => `+ ${item.weight} ${item.name}`);
  const lp = (phase: 'rules' | 'preferences', violationCap = 0) => ['Minimize', ' obj:', wrap(phase === 'rules' ? violationTerms : preferences), 'Subject To', ...body,
    ...(phase === 'preferences' ? [' cap:', wrap(violationTerms), ` <= ${violationCap}`] : []),
    'Binary', wrap(binaries), ...(integers.length ? ['General', wrap(integers)] : []), 'End'].join('\n');

  const value = (columns: Columns, name: string) => columns[name]?.Primal ?? 0;
  const decode = (columns: Columns) => {
    const plan: Plan = Object.fromEntries(operators.map((operator, o) => [operator.id, Array.from({ length: 7 }, (_, day): Cell => {
      const chosen = assigned.find(item => item.operator === o && item.day === day && value(columns, item.name) > 0.5);
      return chosen ? { templateId: chosen.template.id, kind: chosen.kind } : requests[operator.id]?.[day] === 'vacation' ? 'vacation' : 'off';
    })]));
    const total = (prefix: string) => Math.round(Object.keys(columns).filter(name => name.startsWith(prefix)).reduce((sum, name) => sum + value(columns, name), 0));
    return { plan, relaxed: { coverage: total('gv_') + total('gn_'), lunch: total('nlv_') + total('nlnv_'), norm: total('un_') + total('ov_') } };
  };
  const violation = (columns: Columns) => penalties.reduce((sum, item) => sum + item.weight * value(columns, item.name), 0);
  // A result without an incumbent comes back as zeros; the norm equations tell the two apart.
  const consistent = (columns: Columns) => norms.every(norm =>
    Math.abs(norm.names.reduce((sum, name) => sum + value(columns, name), 0) + value(columns, `un_${norm.operator}`) - value(columns, `ov_${norm.operator}`) - norm.required) < 1e-6);
  return { lp, decode, violation, consistent };
}

const usable = (status: string) => status === 'Optimal' || status === 'Time limit reached';

export function solveWeek(input: WeekInput, solver: LpSolver, timeLimitSeconds = 15): BuildResult {
  const started = Date.now();
  const model = buildModel(input);
  const rules = solver.solve(model.lp('rules'), { time_limit: timeLimitSeconds * 0.4, output_flag: false });
  if (!usable(rules.Status) || !model.consistent(rules.Columns)) {
    return { plan: null, solverStatus: rules.Status, relaxed: { coverage: 0, lunch: 0, norm: 0 }, rulesProven: false, tuned: false, elapsedMs: Date.now() - started };
  }
  const cap = Math.ceil(model.violation(rules.Columns) - 1e-6);
  const remaining = Math.max(1, timeLimitSeconds - (Date.now() - started) / 1000);
  const tuned = solver.solve(model.lp('preferences', cap), { time_limit: remaining, mip_rel_gap: 0.03, output_flag: false });
  const better = usable(tuned.Status) && model.consistent(tuned.Columns) && model.violation(tuned.Columns) <= cap + 1e-6;
  return { ...model.decode(better ? tuned.Columns : rules.Columns), solverStatus: better ? tuned.Status : rules.Status,
    rulesProven: rules.Status === 'Optimal', tuned: better && tuned.Status === 'Optimal', elapsedMs: Date.now() - started };
}
