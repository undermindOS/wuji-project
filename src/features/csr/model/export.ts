import { DAYS, kindLabel, templateById } from './defaults.ts';
import { isShift } from './check.ts';
import { dateLabel, weekDates } from './time.ts';
import type { Cell, Operator, Plan } from './types.ts';

/** A cell as the team writes it in their sheet: hours on the first line, shift kind on the second. */
export function cellLines(cell: Cell | undefined): string[] {
  if (!isShift(cell)) return [cell === 'vacation' ? 'vacation' : 'off'];
  return [templateById(cell.templateId)?.label ?? cell.templateId, kindLabel(cell.kind)];
}

function table(weekStart: string, operators: Operator[], plan: Plan): string[][] {
  const dates = weekDates(weekStart);
  return [
    ['Work Nick Name', ...dates.map((date, day) => `${dateLabel(date)} ${DAYS[day]}`)],
    ...operators.map(operator => [operator.nick, ...dates.map((_, day) => cellLines(plan[operator.id]?.[day]).join('\n'))]),
  ];
}

// A leading =, +, - or @ would be read as a formula by a spreadsheet; a nickname must stay text.
const safe = (value: string): string => /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
const quoted = (value: string): string => /[",\n\t]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

export function toCsv(weekStart: string, operators: Operator[], plan: Plan): string {
  return table(weekStart, operators, plan).map(row => row.map(value => quoted(safe(value))).join(',')).join('\r\n') + '\r\n';
}

export function toTsv(weekStart: string, operators: Operator[], plan: Plan): string {
  return table(weekStart, operators, plan).map(row => row.map(value => quoted(safe(value))).join('\t')).join('\n');
}

const escapeHtml = (value: string): string => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** An HTML table for the clipboard: spreadsheets keep the two-line cells when pasting it. */
export function toHtml(weekStart: string, operators: Operator[], plan: Plan): string {
  return `<table>${table(weekStart, operators, plan).map(row => `<tr>${row.map(value => `<td>${escapeHtml(safe(value)).replace(/\n/g, '<br>')}</td>`).join('')}</tr>`).join('')}</table>`;
}
