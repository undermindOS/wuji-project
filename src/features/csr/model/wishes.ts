import { DAY_NAMES, templateById } from './defaults.ts';
import type { Wish } from './types.ts';

/** A wish in a few plain lines: days off, days to work, preferred hours, then the comment as written. */
export function wishLines(wish: Wish): string[] {
  const days = (kind: 'work' | 'off') => wish.days.flatMap((value, day) => value === kind ? [DAY_NAMES[day]] : []);
  const off = days('off'), work = days('work');
  const shifts = wish.shifts.map(id => templateById(id)?.label ?? id);
  return [
    ...(off.length ? [`Wants the day off: ${off.join(', ')}`] : []),
    ...(work.length ? [`Wants to work: ${work.join(', ')}`] : []),
    ...(shifts.length ? [`Preferred hours: ${shifts.join(', ')}`] : []),
    ...(wish.comment ? [`“${wish.comment}”`] : []),
  ];
}

/** "Nov 24, 3:05 PM" on the reader's own clock. */
export function whenLabel(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
