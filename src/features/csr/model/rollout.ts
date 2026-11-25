import { OPEN, SLOT, SLOTS, templateById } from './defaults.ts';
import { isShift } from './check.ts';
import type { Channel, Operator, Plan } from './types.ts';

/** A stretch of the day during which the same operators are on a non-voice shift. */
export interface Segment { from: number; to: number; slots: number[]; operatorIds: string[] }

/** Who is on a non-voice shift in each half hour of `day`, in team order. */
function nonvoiceBySlot(plan: Plan, operators: Operator[], day: number): string[][] {
  return Array.from({ length: SLOTS }, (_, slot) => {
    const start = OPEN + slot * SLOT;
    return operators.filter(operator => {
      const cell = plan[operator.id]?.[day];
      const template = isShift(cell) && cell.kind === 'nv' ? templateById(cell.templateId) : undefined;
      return !!template && template.start <= start && template.end >= start + SLOT;
    }).map(operator => operator.id);
  });
}

/** The rows of the channel table: the day cut wherever someone on non-voice starts or ends. */
export function nonvoiceSegments(plan: Plan, operators: Operator[], day: number): Segment[] {
  const segments: Segment[] = [];
  nonvoiceBySlot(plan, operators, day).forEach((operatorIds, slot) => {
    const last = segments[segments.length - 1];
    if (last && last.operatorIds.join('/') === operatorIds.join('/')) { last.slots.push(slot); last.to += SLOT; }
    else segments.push({ from: OPEN + slot * SLOT, to: OPEN + (slot + 1) * SLOT, slots: [slot], operatorIds });
  });
  return segments;
}

/** Who holds `channelId` through a segment: one operator, nobody, or 'mixed' when the half hours disagree. */
export function segmentHolder(dayRollout: Record<string, (string | null)[]>, channelId: string, segment: Segment): string | null | 'mixed' {
  const values = segment.slots.map(slot => dayRollout[channelId]?.[slot] ?? null);
  return values.every(value => value === values[0]) ? values[0] : 'mixed';
}

/**
 * A first draft of the table. Channels are spread evenly over the operators on non-voice, and a channel
 * stays with whoever held it in the previous stretch while that keeps the spread even.
 */
export function autoFill(segments: Segment[], channels: Channel[]): Record<string, (string | null)[]> {
  const filled: Record<string, (string | null)[]> = Object.fromEntries(channels.map(channel => [channel.id, Array<string | null>(SLOTS).fill(null)]));
  const halfHours = new Map<string, number>();
  let previous: Record<string, string | null> = {};
  for (const segment of segments) {
    const here: Record<string, string | null> = {};
    const held = new Map<string, number>(segment.operatorIds.map(id => [id, 0]));
    const most = segment.operatorIds.length ? Math.ceil(channels.length / segment.operatorIds.length) : 0;
    for (const channel of channels) {
      const before = previous[channel.id];
      const keeps = before && held.has(before) && held.get(before)! < most ? before : null;
      const holder = keeps ?? [...segment.operatorIds].sort((a, b) => held.get(a)! - held.get(b)! || (halfHours.get(a) ?? 0) - (halfHours.get(b) ?? 0))[0] ?? null;
      here[channel.id] = holder;
      if (!holder) continue;
      held.set(holder, held.get(holder)! + 1);
      halfHours.set(holder, (halfHours.get(holder) ?? 0) + segment.slots.length);
      for (const slot of segment.slots) filled[channel.id][slot] = holder;
    }
    previous = here;
  }
  return filled;
}

/** Cells of the table that still need attention. */
export function rolloutIssues(segments: Segment[], channels: Channel[], dayRollout: Record<string, (string | null)[]>): { cells: number; unassigned: number; invalid: number; uncovered: number } {
  let unassigned = 0, invalid = 0, uncovered = 0;
  for (const segment of segments) {
    if (!segment.operatorIds.length) { uncovered += 1; continue; }
    for (const channel of channels) {
      const holder = segmentHolder(dayRollout, channel.id, segment);
      if (holder === null) unassigned += 1;
      else if (holder === 'mixed' || !segment.operatorIds.includes(holder)) invalid += 1;
    }
  }
  return { cells: segments.filter(segment => segment.operatorIds.length).length * channels.length, unassigned, invalid, uncovered };
}

/** Half hours each operator spends on each channel that day, for the load line under the table. */
export function channelLoad(channels: Channel[], dayRollout: Record<string, (string | null)[]>): Record<string, number> {
  const load: Record<string, number> = {};
  for (const channel of channels) for (const holder of dayRollout[channel.id] ?? []) if (holder) load[holder] = (load[holder] ?? 0) + 1;
  return load;
}

const clockParts = (minutes: number) => ({ text: `${Math.floor(minutes / 60) % 12 || 12}:${String(minutes % 60).padStart(2, '0')}`, half: minutes < 12 * 60 ? 'AM' : 'PM' });

/** "6:00–9:30 AM", or "11:30 AM–2:00 PM" when the stretch crosses noon. */
export function rangeLabel(from: number, to: number): string {
  const start = clockParts(from), end = clockParts(to);
  return start.half === end.half ? `${start.text}–${end.text} ${end.half}` : `${start.text} ${start.half}–${end.text} ${end.half}`;
}

/** "6:00 AM – 2:30 PM" */
export function shiftLabel(from: number, to: number): string {
  const start = clockParts(from), end = clockParts(to);
  return `${start.text} ${start.half} – ${end.text} ${end.half}`;
}
