import { mkdir, writeFile } from 'node:fs/promises';
import { createExample, EXAMPLES } from '../src/features/workspace/data/examples.ts';

function csv(rows) {
  return rows.map(row => row.map(value => {
    const text = String(value ?? '');
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  }).join(',')).join('\n') + '\n';
}

for (const option of EXAMPLES) {
  const { source, task } = createExample(option.id);
  const directory = new URL(`../docs/examples/${option.id}/`, import.meta.url);
  await mkdir(directory, { recursive: true });
  await writeFile(new URL(source.filename, directory), csv([
    ['shift_id', 'starts_at', 'ends_at', 'role', 'employee_id', 'pinned'],
    ...source.shifts.map(shift => [shift.id, shift.startsAt, shift.endsAt, shift.role, shift.employeeId, shift.pinned]),
  ]));
  await writeFile(new URL('employees.csv', directory), csv([
    ['employee_id', 'name', 'roles', 'rate_per_hour_minor', 'max_weekly_minutes', 'currency'],
    ...source.employees.map(employee => [employee.id, employee.name, employee.roles.join('|'), employee.ratePerHourMinor, employee.maxWeeklyMinutes, source.currency]),
  ]));
  await writeFile(new URL('availability.csv', directory), csv([
    ['employee_id', 'shift_id', 'availability'],
    ...source.employees.flatMap(employee => source.shifts.map(shift => [employee.id, shift.id, employee.availability[shift.id]])),
  ]));
  await writeFile(new URL('conditions.json', directory), JSON.stringify({
    exampleId: option.id, sourceVersionId: source.id, timezone: source.timezone,
    currency: source.currency, task,
  }, null, 2) + '\n');
}
console.log(`Generated ${EXAMPLES.length} synthetic example bundles in docs/examples/.`);
