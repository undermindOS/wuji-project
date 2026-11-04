import type { Employee, ExampleId, Scenario, Shift, SourceVersion, TaskSpec, WorkspaceExample } from '../model/types.ts';

export const EXAMPLES: { id: ExampleId; label: string }[] = [
  { id: 'absence', label: 'Сотрудник отсутствует в среду' },
  { id: 'missing-rate', label: 'Ставка замены неизвестна' },
  { id: 'unknown-availability', label: 'Доступность замены не подтверждена' },
  { id: 'conflict', label: 'Отсутствие и закреплённая смена' },
  { id: 'unchanged', label: 'Неделя без изменений' },
];

const roster = [
  ['anna', 'Анна Волкова', 'АВ', 300, 24, ['s01', 's05', 's09']],
  ['roman', 'Роман Ким', 'РК', 280, 24, ['s02', 's06']],
  ['ilya', 'Илья Соколов', 'ИС', 260, 16, ['s03']],
  ['daria', 'Дарья Морозова', 'ДМ', 300, 24, ['s04', 's10']],
  ['marina', 'Марина Белова', 'МБ', 280, 24, ['s07', 's13']],
  ['denis', 'Денис Орлов', 'ДО', 250, 8, ['s05', 's08']],
  ['igor', 'Игорь Лебедев', 'ИЛ', 270, 16, ['s11']],
  ['elena', 'Елена Петрова', 'ЕП', 260, 16, ['s12']],
  ['oleg', 'Олег Миронов', 'ОМ', 240, 16, ['s08', 's14']],
  ['sofia', 'София Ли', 'СЛ', 320, 16, ['s05']],
] as const;

const assignees = ['anna', 'roman', 'ilya', 'daria', 'anna', 'roman', 'marina', 'denis', 'anna', 'daria', 'igor', 'elena', 'marina', 'oleg'];

function createSource(exampleId: ExampleId): SourceVersion {
  const shifts: Shift[] = assignees.map((employeeId, index) => {
    const day = String(2 + Math.floor(index / 2)).padStart(2, '0');
    const late = index % 2 === 1;
    return {
      id: `s${String(index + 1).padStart(2, '0')}`,
      startsAt: `2026-11-${day}T${late ? '13' : '09'}:00:00+03:00`,
      endsAt: `2026-11-${day}T${late ? '21' : '17'}:00:00+03:00`,
      role: ['s02', 's04', 's06', 's10'].includes(`s${String(index + 1).padStart(2, '0')}`) ? 'Старший специалист' : 'Специалист',
      employeeId,
      pinned: index === 1 || index === 8 || (exampleId === 'conflict' && index === 4),
      sourceRow: index + 2,
    };
  });
  const employees: Employee[] = roster.map(([id, name, initials, rate, maxHours, availableShifts]) => ({
    id, name, initials,
    roles: id === 'roman' || id === 'daria' ? ['Специалист', 'Старший специалист'] : ['Специалист'],
    ratePerHourMinor: exampleId === 'missing-rate' && id === 'sofia' ? null : rate * 100,
    maxWeeklyMinutes: maxHours * 60,
    availability: Object.fromEntries(shifts.map(shift => [shift.id,
      exampleId === 'unknown-availability' && id === 'sofia' && shift.id === 's05'
        ? 'unknown'
        : (availableShifts as readonly string[]).includes(shift.id) ? 'available' : 'unavailable',
    ])),
  }));
  return {
    id: `demo-source-${exampleId}-v1`, version: 1,
    filename: 'team_week_02-08_nov.csv', teamName: 'Студия «Север»',
    timezone: 'Europe/Moscow', currency: 'RUB', employees, shifts,
  };
}

export function createExample(id: ExampleId): WorkspaceExample {
  const source = createSource(id);
  const request = id === 'unchanged'
    ? 'Проверь исходную неделю. Все сотрудники доступны в своих сменах, перестановки не нужны.'
    : id === 'conflict'
      ? 'Анна не выйдет в среду, 4 ноября. Её смена закреплена и не может быть передана. Покажи конфликт условий.'
      : 'Анна не выйдет в среду, 4 ноября. Закрой её смену, сохрани закреплённые назначения и лимиты часов. Покажи вариант с меньшим числом перестановок и вариант с меньшими затратами.';
  const task: TaskSpec = {
    id: `demo-task-${id}-v1`, sourceVersionId: source.id, request,
    absence: id === 'unchanged' ? null : { employeeId: 'anna', shiftIds: ['s05'] },
    rules: [
      { id: 'availability', label: 'Подтверждённая доступность', detail: 'Учитывать отсутствие и доступность для каждой смены.' },
      { id: 'pinned', label: 'Закреплённые назначения', detail: 'Смены с отметкой «Закреплено» сохраняют своего сотрудника.' },
      { id: 'hours', label: 'Личные лимиты часов', detail: 'У Дениса — 8 ч в неделю; у остальных — лимит из карточки сотрудника.' },
      { id: 'coverage', label: 'Покрытие и квалификация', detail: 'Все 14 смен закрыты специалистом нужной роли, без пересечений.' },
    ],
  };
  const original = Object.fromEntries(source.shifts.map(shift => [shift.id, shift.employeeId]));
  const scenario = (suffix: string, label: string, description: string, assignments: Record<string, string>): Scenario => ({
    id: `demo-scenario-${id}-${suffix}`, sourceVersionId: source.id, taskSpecId: task.id,
    label, description, assignments,
  });
  const scenarios = id === 'conflict' ? [] : id === 'unchanged'
    ? [scenario('original', 'Сохранить неделю', 'Исходные назначения сохранены.', original)]
    : [
      scenario('minimal', 'Меньше перестановок', 'Передать одну смену Софии. Остальные назначения сохраняются.', { ...original, s05: 'sofia' }),
      scenario('economy', 'Меньше затрат', 'В среду выходит Денис. Его четверг передаётся Олегу, чтобы сохранить лимит 8 ч.', { ...original, s05: 'denis', s08: 'oleg' }),
    ];
  return {
    id, label: EXAMPLES.find(example => example.id === id)!.label, source, task, scenarios,
    conflict: id === 'conflict' ? {
      shiftId: 's05', title: 'Два обязательных условия противоречат друг другу',
      detail: 'Смена Анны 4 ноября закреплена за ней, но в это время Анна отсутствует. Сохранить назначение и одновременно исключить Анну невозможно. Нужно изменить одно из условий и заново проверить результат.',
    } : null,
  };
}
