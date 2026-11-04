import { useEffect, useRef } from 'react';
import { dayLabel, timeLabel } from '../model/schedule.ts';
import type { SourceVersion, TaskSpec } from '../model/types.ts';

interface ScheduleTableProps {
  source: SourceVersion;
  task: TaskSpec;
  assignments: Record<string, string>;
  selectedShiftId: string | null;
  onSelect: (id: string) => void;
  view: 'source' | 'scenario';
  selectionSequence?: number;
}

export default function ScheduleTable({ source, task, assignments, selectedShiftId, onSelect, view, selectionSequence = 0 }: ScheduleTableProps) {
  const selectedRow = useRef<HTMLTableRowElement>(null);
  useEffect(() => {
    if (selectionSequence > 0) selectedRow.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [selectedShiftId, selectionSequence]);
  return (
    <div className="ws-table-wrap">
      <table className="ws-schedule" aria-label={view === 'source' ? 'Исходное расписание' : 'Расписание выбранного варианта'}>
        <thead><tr><th scope="col">День / смена</th><th scope="col">Сотрудник</th><th scope="col"><span className="ws-sr-only">Состояние</span></th></tr></thead>
        <tbody>
          {source.shifts.map(shift => {
            const employee = source.employees.find(person => person.id === assignments[shift.id]);
            const changed = assignments[shift.id] !== shift.employeeId;
            const absent = view === 'source' && task.absence?.employeeId === shift.employeeId && task.absence.shiftIds.includes(shift.id);
            const selected = selectedShiftId === shift.id;
            return (
              <tr key={shift.id} ref={selected ? selectedRow : undefined} data-selected={selected} data-changed={view === 'scenario' && changed} data-absent={absent} data-shift-id={shift.id}>
                <td><span className="ws-day">{dayLabel(shift, source.timezone)}</span><span className="ws-time">{timeLabel(shift, source.timezone)}</span></td>
                <td>
                  <button type="button" className="ws-cell-button" onClick={() => onSelect(shift.id)} aria-pressed={selected} aria-label={`${view === 'source' ? 'Исходное назначение' : 'Назначение варианта'}: ${shift.id}, ${employee?.name ?? 'Не назначен'}`}>
                    <span>{employee?.name ?? 'Не назначен'}</span>
                    {absent ? <small className="ws-red">Отсутствует</small> : <small>{shift.role}</small>}
                  </button>
                </td>
                <td className="ws-row-state">
                  {shift.pinned ? <span title="Закреплённое назначение" aria-label="Закреплено">▣</span> : changed && view === 'scenario' ? <span className="ws-green" title="Назначение изменено" aria-label="Изменено">↗</span> : <span aria-hidden="true">·</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
