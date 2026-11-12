import type { CheckStatus, DemoCheck, Employee, Scenario, ScenarioMetrics, Shift, SourceVersion, TaskSpec } from './types.ts';

export function durationMinutes(shift: Shift): number {
  return (Date.parse(shift.endsAt) - Date.parse(shift.startsAt)) / 60_000;
}

export function shiftCostMinor(shift: Shift, employee: Employee | undefined): number | null {
  if (employee?.ratePerHourMinor == null) return null;
  // Round each assignment to the nearest minor unit, half up, using bounded integers.
  return Math.floor((durationMinutes(shift) * employee.ratePerHourMinor + 30) / 60);
}

export function assignmentsOf(source: SourceVersion): Record<string, string> {
  return Object.fromEntries(source.shifts.map(shift => [shift.id, shift.employeeId]));
}

export function availabilityFor(employee: Employee, shiftId: string, task: TaskSpec, source?: SourceVersion): 'available' | 'unavailable' | 'unknown' {
  if (task.absence?.employeeId === employee.id && task.absence.shiftIds.includes(shiftId)) return 'unavailable';
  const selected = source?.shifts.find(shift => shift.id === shiftId);
  if (selected && task.absence?.employeeId === employee.id && source?.shifts.some(shift => task.absence!.shiftIds.includes(shift.id)
    && Date.parse(selected.startsAt) < Date.parse(shift.endsAt) && Date.parse(shift.startsAt) < Date.parse(selected.endsAt))) return 'unavailable';
  return employee.availability[shiftId] ?? 'unknown';
}

export function getMetrics(source: SourceVersion, scenario: Scenario): ScenarioMetrics {
  const employees = new Map(source.employees.map(employee => [employee.id, employee]));
  const unknownRateEmployeeIds = new Set<string>();
  let cost = 0;
  let baseline = 0;
  let baselineKnown = true;
  let costKnown = true;
  let totalMinutes = 0;
  let coveredShifts = 0;
  const changes = source.shifts.flatMap(shift => {
    const after = scenario.assignments[shift.id];
    const employee = employees.get(after);
    const originalCost = shiftCostMinor(shift, employees.get(shift.employeeId));
    if (originalCost === null) baselineKnown = false;
    else baseline += originalCost;
    if (employee) {
      coveredShifts += 1;
      totalMinutes += durationMinutes(shift);
      const assignmentCost = shiftCostMinor(shift, employee);
      if (assignmentCost === null) {
        costKnown = false;
        unknownRateEmployeeIds.add(employee.id);
      } else cost += assignmentCost;
    } else costKnown = false;
    return after && after !== shift.employeeId ? [{
      id: `${scenario.id}:${shift.id}`, shiftId: shift.id,
      beforeEmployeeId: shift.employeeId, afterEmployeeId: after, sourceRow: shift.sourceRow,
    }] : [];
  });
  return {
    changes,
    affectedEmployeeIds: [...new Set(changes.flatMap(change => [change.beforeEmployeeId, change.afterEmployeeId]))],
    coveredShifts, totalShifts: source.shifts.length, totalMinutes,
    costMinor: costKnown ? cost : null,
    baselineCostMinor: baselineKnown ? baseline : null,
    costDeltaMinor: costKnown && baselineKnown ? cost - baseline : null,
    unknownRateEmployeeIds: [...unknownRateEmployeeIds],
  };
}

// Checks for the supported CSV/XLSX scheduling contract, not a solver or labor law.
export function checkSchedule(source: SourceVersion, task: TaskSpec, scenario: Scenario): DemoCheck[] {
  const employees = new Map(source.employees.map(employee => [employee.id, employee]));
  const shiftIds = new Set(source.shifts.map(shift => shift.id));
  const checks: DemoCheck[] = [];
  const add = (id: string, label: string, failed: string[], detail: string, unknown: string[] = []) => {
    checks.push({ id, label, status: failed.length ? 'fail' : unknown.length ? 'unknown' : 'pass', detail, shiftIds: [...new Set([...failed, ...unknown])] });
  };
  const badReferences = source.shifts.filter(shift => !employees.has(shift.employeeId)
    || (scenario.assignments[shift.id] !== undefined && !employees.has(scenario.assignments[shift.id]))).map(shift => shift.id);
  const wrongVersion = task.sourceVersionId !== source.id || scenario.sourceVersionId !== source.id || scenario.taskSpecId !== task.id;
  const badKeys = Object.keys(scenario.assignments).filter(id => !shiftIds.has(id));
  const duplicateIds = employees.size !== source.employees.length || shiftIds.size !== source.shifts.length;
  add('references', 'Versions and records', [...badReferences, ...badKeys, ...(wrongVersion || duplicateIds ? ['version-or-id'] : [])],
    wrongVersion || duplicateIds || badReferences.length || badKeys.length ? 'Mismatched versions or unknown/duplicate records found.' : 'Versions match; assignments reference existing employees.');
  const uncovered = source.shifts.filter(shift => !employees.has(scenario.assignments[shift.id])).map(shift => shift.id);
  add('coverage', 'Shift coverage', uncovered, uncovered.length ? `Uncovered shifts: ${uncovered.length}.` : `All ${source.shifts.length} shifts are assigned.`);
  const unavailable: string[] = [];
  const unknownAvailability: string[] = [];
  const wrongRole: string[] = [];
  const changedPins: string[] = [];
  const minutes = new Map<string, number>();
  for (const shift of source.shifts) {
    const employee = employees.get(scenario.assignments[shift.id]);
    if (!employee) continue;
    const availability = availabilityFor(employee, shift.id, task, source);
    if (availability === 'unavailable') unavailable.push(shift.id);
    if (availability === 'unknown') unknownAvailability.push(shift.id);
    if (!employee.roles.includes(shift.role)) wrongRole.push(shift.id);
    if (shift.pinned && employee.id !== shift.employeeId) changedPins.push(shift.id);
    if (task.fixedAssignments?.[shift.id] && employee.id !== task.fixedAssignments[shift.id]) changedPins.push(shift.id);
    minutes.set(employee.id, (minutes.get(employee.id) ?? 0) + durationMinutes(shift));
  }
  add('availability', 'Availability', unavailable,
    unavailable.length ? 'An assignment falls within a confirmed absence.' : unknownAvailability.length ? 'Replacement availability is unconfirmed. Clarification is required.' : 'Availability is confirmed for every assigned employee.', unknownAvailability);
  add('roles', 'Employee roles', wrongRole, wrongRole.length ? 'An employee’s role does not match the shift.' : 'Qualifications match every shift.');
  add('pinned', 'Pinned shifts', changedPins, changedPins.length ? 'A pinned assignment was changed.' : 'All pinned assignments are preserved.');
  const overHours = source.employees.filter(employee => (minutes.get(employee.id) ?? 0) > employee.maxWeeklyMinutes);
  add('hours', 'Hour limits', overHours.flatMap(employee => source.shifts.filter(shift => scenario.assignments[shift.id] === employee.id).map(shift => shift.id)),
    overHours.length ? `Limit exceeded: ${overHours.map(employee => employee.name).join(', ')}.` : 'Individual weekly limits are respected.');
  const overlapping = new Set<string>();
  source.shifts.forEach((a, index) => {
    for (const b of source.shifts.slice(index + 1)) {
      if (scenario.assignments[a.id] && scenario.assignments[a.id] === scenario.assignments[b.id]
        && Date.parse(a.startsAt) < Date.parse(b.endsAt) && Date.parse(b.startsAt) < Date.parse(a.endsAt)) {
        overlapping.add(a.id); overlapping.add(b.id);
      }
    }
  });
  add('overlap', 'Overlaps', [...overlapping], overlapping.size ? 'An employee is assigned to overlapping shifts.' : 'No employee has overlapping shifts.');
  return checks;
}

export const checkDemoSchedule = checkSchedule;

export function overallStatus(checks: DemoCheck[]): CheckStatus {
  return checks.some(check => check.status === 'fail') ? 'fail' : checks.some(check => check.status === 'unknown') ? 'unknown' : 'pass';
}

export function money(minor: number | null, currency = 'RUB', signed = false): string {
  if (minor === null) return 'Unknown';
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency, maximumFractionDigits: minor % 100 === 0 ? 0 : 2, signDisplay: signed ? 'exceptZero' : 'auto' }).format(minor / 100);
}

export function dayLabel(shift: Shift, timezone: string): string {
  return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: '2-digit', timeZone: timezone }).format(new Date(shift.startsAt));
}

export function timeLabel(shift: Shift, timezone: string): string {
  const formatter = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: timezone });
  return `${formatter.format(new Date(shift.startsAt))}–${formatter.format(new Date(shift.endsAt))}`;
}
