import { DEPARTMENT_ZONE } from './defaults.ts';
import type { ShiftTemplate } from './types.ts';

export function isValidZone(zone: string): boolean {
  try { new Intl.DateTimeFormat('en-US', { timeZone: zone }); return true; } catch { return false; }
}

/** Offset of `zone` from UTC at `instant`, in minutes (east is positive). */
export function offsetMinutes(zone: string, instant: number): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' }).formatToParts(new Date(instant));
  const value = (type: string) => Number(parts.find(part => part.type === type)!.value);
  const wall = Date.UTC(value('year'), value('month') - 1, value('day'), value('hour'), value('minute'));
  return Math.round((wall - Math.floor(instant / 60_000) * 60_000) / 60_000);
}

export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export function weekDates(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, day) => addDays(weekStart, day));
}

export function isMonday(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date && parsed.getUTCDay() === 1;
}

/** The Monday of the week `date` falls in. */
export function mondayOf(date: string): string {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDays(date, weekday === 0 ? -6 : 1 - weekday);
}

/** UTC instant of a wall-clock time (minutes from midnight on `date`) in `zone`. */
export function instantOf(date: string, minutes: number, zone = DEPARTMENT_ZONE): number {
  const [year, month, day] = date.split('-').map(Number);
  const wall = Date.UTC(year, month - 1, day, 0, minutes);
  let instant = wall - offsetMinutes(zone, wall) * 60_000;
  instant = wall - offsetMinutes(zone, instant) * 60_000;
  return instant;
}

export function offsetLabel(zone: string, instant: number): string {
  const offset = offsetMinutes(zone, instant);
  const hours = Math.floor(Math.abs(offset) / 60);
  const minutes = Math.abs(offset) % 60;
  return `UTC${offset < 0 ? '−' : '+'}${hours}${minutes ? `:${String(minutes).padStart(2, '0')}` : ''}`;
}

/** 24-hour wall-clock time of `instant` in `zone`, with the day shift relative to `date`. */
function localClock(instant: number, zone: string, date: string): { text: string; dayShift: number } {
  const local = instant + offsetMinutes(zone, instant) * 60_000;
  const stamp = new Date(local);
  const [year, month, day] = date.split('-').map(Number);
  const dayShift = Math.round((Date.UTC(stamp.getUTCFullYear(), stamp.getUTCMonth(), stamp.getUTCDate()) - Date.UTC(year, month - 1, day)) / 86_400_000);
  return { text: `${String(stamp.getUTCHours()).padStart(2, '0')}:${String(stamp.getUTCMinutes()).padStart(2, '0')}`, dayShift };
}

/** A shift's hours on the operator's own clock, e.g. "19:00–03:30 +1". */
export function localRange(date: string, template: ShiftTemplate, zone: string): string {
  const start = localClock(instantOf(date, template.start), zone, date);
  const end = localClock(instantOf(date, template.end), zone, date);
  const shift = (value: number) => value === 0 ? '' : ` ${value > 0 ? '+' : '−'}${Math.abs(value)}`;
  return `${start.text}${shift(start.dayShift)}–${end.text}${shift(end.dayShift)}`;
}

/** Department clock, e.g. 870 -> "2:30 PM". */
export function clock(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${hour % 12 === 0 ? 12 : hour % 12}${minute ? `:${String(minute).padStart(2, '0')}` : ''} ${hour < 12 || hour === 24 ? 'AM' : 'PM'}`;
}

export function dateLabel(date: string): string {
  const [, month, day] = date.split('-').map(Number);
  return `${month}/${day}`;
}
