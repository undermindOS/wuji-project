export type Rating = 'strong' | 'normal' | 'weak' | 'never';
// 'v' answers calls only. 'nv' is the team's "n/v+v": non-voice work plus calls, so it covers both lines.
export type ShiftKind = 'v' | 'nv';
export type Line = 'voice' | 'nonvoice';
export type Band = 'early' | 'day' | 'late';

export interface ShiftTemplate {
  id: string;
  label: string;
  /** Minutes from midnight, department time. */
  start: number;
  end: number;
  band: Band;
  /** 8.5-hour shifts carry a mandatory unpaid 30-minute lunch; the 6-hour shift does not. */
  lunch: boolean;
}

export interface Operator {
  id: string;
  nick: string;
  /** IANA zone, or null when the team sheet does not say. */
  timeZone: string | null;
  shiftsPerWeek: number;
  /** How many 6-hour 2-8 shifts a week this operator may be given; 0 means none. */
  shortShifts: number;
  lines: Record<Line, Rating>;
  bands: Record<Band, Rating>;
}

export interface Assignment { templateId: string; kind: ShiftKind }
export type Request = 'auto' | 'off' | 'vacation' | Assignment;
export type Cell = 'off' | 'vacation' | Assignment;
export type Plan = Record<string, Cell[]>;
export interface DayTarget { headcount: number; nonvoice: number }

export interface WeekInput {
  /** ISO date of the Monday the week starts on. */
  weekStart: string;
  operators: Operator[];
  /** Seven entries, Monday first. */
  targets: DayTarget[];
  /** Seven entries per operator id, Monday first. */
  requests: Record<string, Request[]>;
}

export interface PlanStatus {
  /** Where the plan came from: the team's own sheet, the solver, or cells set by hand on an empty week. */
  source: 'sample' | 'solver' | 'manual';
  /** Solver only: the rule violations left in the plan are proven to be the fewest possible. */
  rulesProven: boolean | null;
  /** Solver only: preferences were optimised to within 3%; false when that search ran out of time. */
  tuned: boolean | null;
  /** Solver only: how many hard rules had to give way (0 means every rule holds). */
  relaxed: number | null;
  edited: boolean;
  /** Team or week settings changed after the plan was produced. */
  stale: boolean;
}

/** A non-voice channel that someone has to hold at every moment of the day. */
export interface Channel { id: string; name: string }
/** Seven days; for each, channel id -> who holds the channel in each half hour of the department day (or null). */
export type Rollout = Record<string, (string | null)[]>[];

export interface WeekData {
  targets: DayTarget[];
  requests: Record<string, Request[]>;
  plan: Plan | null;
  planStatus: PlanStatus | null;
  rollout: Rollout;
}

/** What an operator asked for through a wish link. */
export interface Wish {
  id: string;
  weekStart: string;
  operatorId: string;
  nick: string;
  /** Seven entries, Monday first: wants to work, wants the day off, or no preference. */
  days: ('work' | 'off' | '')[];
  /** Ids of the shifts the operator prefers. */
  shifts: string[];
  comment: string;
  createdAt: string;
}

/** Everything the tool keeps: the team, and every week worked on, keyed by its Monday. */
export interface CsrState {
  version: 1;
  operators: Operator[];
  channels: Channel[];
  weekStart: string;
  weeks: Record<string, WeekData>;
}

export type CheckStatus = 'pass' | 'warn' | 'fail';
export interface CellRef { operatorId: string; day: number }
export interface Check {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  cells: CellRef[];
}

export interface Load {
  shifts: number;
  required: number;
  paidMinutes: number;
  voice: number;
  nonvoice: number;
  bands: Record<Band, number>;
  weekend: number;
  /** Distinct shift templates worked this week. */
  templates: number;
}
