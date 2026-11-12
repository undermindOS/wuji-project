import type { Employee, ExampleId, Scenario, Shift, SourceVersion, TaskSpec, WorkspaceExample } from '../model/types.ts';

export const EXAMPLES: { id: ExampleId; label: string }[] = [
  { id: 'absence', label: 'Employee absent on Wednesday' },
  { id: 'missing-rate', label: 'Replacement rate unknown' },
  { id: 'unknown-availability', label: 'Replacement availability unconfirmed' },
  { id: 'conflict', label: 'Absence and a pinned shift' },
  { id: 'unchanged', label: 'Unchanged week' },
];

const roster = [
  ['emily', 'Emily Johnson', 'EJ', 30, 24, ['s01', 's05', 's09']],
  ['michael', 'Michael Davis', 'MD', 28, 24, ['s02', 's06']],
  ['james', 'James Wilson', 'JW', 26, 16, ['s03']],
  ['sarah', 'Sarah Miller', 'SM', 30, 24, ['s04', 's10']],
  ['jessica', 'Jessica Brown', 'JB', 28, 24, ['s07', 's13']],
  ['daniel', 'Daniel Taylor', 'DT', 25, 8, ['s05', 's08']],
  ['david', 'David Anderson', 'DA', 27, 16, ['s11']],
  ['ashley', 'Ashley Thomas', 'AT', 26, 16, ['s12']],
  ['christopher', 'Christopher Moore', 'CM', 24, 16, ['s08', 's14']],
  ['sophia', 'Sophia Lee', 'SL', 32, 16, ['s05']],
] as const;

const assignees = ['emily', 'michael', 'james', 'sarah', 'emily', 'michael', 'jessica', 'daniel', 'emily', 'sarah', 'david', 'ashley', 'jessica', 'christopher'];

function createSource(exampleId: ExampleId): SourceVersion {
  const shifts: Shift[] = assignees.map((employeeId, index) => {
    const day = String(2 + Math.floor(index / 2)).padStart(2, '0');
    const late = index % 2 === 1;
    return {
      id: `s${String(index + 1).padStart(2, '0')}`,
      startsAt: `2026-11-${day}T${late ? '13' : '09'}:00:00-05:00`,
      endsAt: `2026-11-${day}T${late ? '21' : '17'}:00:00-05:00`,
      role: ['s02', 's04', 's06', 's10'].includes(`s${String(index + 1).padStart(2, '0')}`) ? 'Senior specialist' : 'Specialist',
      employeeId,
      pinned: index === 1 || index === 8 || (exampleId === 'conflict' && index === 4),
      sourceRow: index + 2,
    };
  });
  const employees: Employee[] = roster.map(([id, name, initials, rate, maxHours, availableShifts]) => ({
    id, name, initials,
    roles: id === 'michael' || id === 'sarah' ? ['Specialist', 'Senior specialist'] : ['Specialist'],
    ratePerHourMinor: exampleId === 'missing-rate' && id === 'sophia' ? null : rate * 100,
    maxWeeklyMinutes: maxHours * 60,
    availability: Object.fromEntries(shifts.map(shift => [shift.id,
      exampleId === 'unknown-availability' && id === 'sophia' && shift.id === 's05'
        ? 'unknown'
        : (availableShifts as readonly string[]).includes(shift.id) ? 'available' : 'unavailable',
    ])),
  }));
  return {
    id: `demo-source-${exampleId}-v1`, version: 1,
    filename: 'team_week_02-08_nov.csv', teamName: 'North Studio',
    timezone: 'America/New_York', currency: 'USD', employees, shifts,
  };
}

export function createExample(id: ExampleId): WorkspaceExample {
  const source = createSource(id);
  const request = id === 'unchanged'
    ? 'Check the original week. All employees are available for their shifts; no reassignments are needed.'
    : id === 'conflict'
      ? 'Emily will be absent on Wednesday, November 4. Her shift is pinned and cannot be reassigned. Show the constraint conflict.'
      : 'Emily will be absent on Wednesday, November 4. Cover her shift while preserving pinned assignments and hour limits. Show an option with fewer reassignments and an option with lower costs.';
  const task: TaskSpec = {
    id: `demo-task-${id}-v1`, sourceVersionId: source.id, request,
    absence: id === 'unchanged' ? null : { employeeId: 'emily', shiftIds: ['s05'] },
    rules: [
      { id: 'availability', label: 'Confirmed availability', detail: 'Respect absence and availability for each shift.' },
      { id: 'pinned', label: 'Pinned assignments', detail: 'Shifts marked “Pinned” keep their assigned employee.' },
      { id: 'hours', label: 'Individual hour limits', detail: 'Daniel has an 8-hour weekly limit; other limits come from employee profiles.' },
      { id: 'coverage', label: 'Coverage and qualifications', detail: 'All 14 shifts must be covered by a qualified employee, without overlaps.' },
    ],
  };
  const original = Object.fromEntries(source.shifts.map(shift => [shift.id, shift.employeeId]));
  const scenario = (suffix: string, label: string, description: string, assignments: Record<string, string>): Scenario => ({
    id: `demo-scenario-${id}-${suffix}`, sourceVersionId: source.id, taskSpecId: task.id,
    label, description, assignments,
  });
  const scenarios = id === 'conflict' ? [] : id === 'unchanged'
    ? [scenario('original', 'Keep the week', 'Original assignments preserved.', original)]
    : [
      scenario('minimal', 'Fewer reassignments', 'Reassign one shift to Sophia. Preserve all other assignments.', { ...original, s05: 'sophia' }),
      scenario('economy', 'Lower costs', 'Daniel works on Wednesday. His Thursday shift goes to Christopher to preserve the 8-hour limit.', { ...original, s05: 'daniel', s08: 'christopher' }),
    ];
  return {
    id, label: EXAMPLES.find(example => example.id === id)!.label, source, task, scenarios,
    conflict: id === 'conflict' ? {
      shiftId: 's05', title: 'Two required constraints conflict',
      detail: 'Emily’s November 4 shift is pinned to her, but she is absent at that time. Keeping the assignment and excluding Emily are incompatible. Change one of the constraints and check the result again.',
    } : null,
  };
}
