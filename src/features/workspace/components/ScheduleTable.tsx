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
      <table className="ws-schedule" aria-label={view === 'source' ? 'Original schedule' : 'Selected option schedule'}>
        <thead><tr><th scope="col">Day / shift</th><th scope="col">Employee</th><th scope="col"><span className="ws-sr-only">Status</span></th></tr></thead>
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
                  <button type="button" className="ws-cell-button" onClick={() => onSelect(shift.id)} aria-pressed={selected} aria-label={`${view === 'source' ? 'Original assignment' : 'Option assignment'}: ${shift.id}, ${employee?.name ?? 'Unassigned'}`}>
                    <span>{employee?.name ?? 'Unassigned'}</span>
                    {absent ? <small className="ws-red">Absent</small> : <small>{shift.role}</small>}
                  </button>
                </td>
                <td className="ws-row-state">
                  {shift.pinned ? <span title="Pinned assignment" aria-label="Pinned">▣</span> : changed && view === 'scenario' ? <span className="ws-green" title="Assignment changed" aria-label="Changed">↗</span> : <span aria-hidden="true">·</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
