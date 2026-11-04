import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { assignmentsOf, durationMinutes, money } from '../model/schedule.ts';
import type { SourceVersion, TaskSpec } from '../model/types.ts';
import ScheduleTable from './ScheduleTable';

interface SourcePaneProps {
  source: SourceVersion;
  task: TaskSpec;
  selectedShiftId: string | null;
  selectionSequence: number;
  onSelect: (shiftId: string) => void;
  children?: ReactNode;
}

export default function SourcePane({ source, task, selectedShiftId, selectionSequence, onSelect, children }: SourcePaneProps) {
  const [view, setView] = useState<'schedule' | 'team'>('schedule');
  const selected = source.shifts.find(shift => shift.id === selectedShiftId);
  useEffect(() => { if (selectionSequence > 0) setView('schedule'); }, [selectionSequence]);
  return (
    <>
      <div className="ws-pane-heading"><span className="ws-kicker ws-green">01 // SOURCE</span><div><h2 id="source-heading">Исходное состояние</h2><span className="ws-version">V{source.version}</span></div></div>
      <div className="ws-pane-scroll">
        {children}
        <div className="ws-file">
          <span className="ws-file-icon" aria-hidden="true">▤</span>
          <div><strong>{source.filename}</strong><span>{source.projectId ? 'Сохранённая версия · только чтение' : 'Исходник примера · только просмотр'}</span></div>
        </div>
        <div className="ws-source-summary"><span><b>{source.employees.length}</b> сотрудников</span><span><b>{source.shifts.length}</b> смен</span><span><b>{source.shifts.reduce((minutes, shift) => minutes + durationMinutes(shift), 0) / 60}</b> часов</span></div>
        <div className="ws-segmented" aria-label="Представление исходных данных">
          <button type="button" onClick={() => setView('schedule')} aria-pressed={view === 'schedule'}>Расписание</button>
          <button type="button" onClick={() => setView('team')} aria-pressed={view === 'team'}>Команда · {source.employees.length}</button>
        </div>
        {view === 'schedule' ? <ScheduleTable source={source} task={task} assignments={assignmentsOf(source)} selectedShiftId={selectedShiftId} selectionSequence={selectionSequence} onSelect={onSelect} view="source" /> : (
          <div className="ws-team-list">
            {source.employees.map(employee => (
              <div key={employee.id} className="ws-person">
                <span className="ws-avatar">{employee.initials}</span>
                <div><strong>{employee.name}</strong><small>{employee.roles.join(' / ')} · до {employee.maxWeeklyMinutes / 60} ч/нед.</small><small className={employee.ratePerHourMinor === null ? 'ws-orange' : ''}>{money(employee.ratePerHourMinor, source.currency)} / ч</small></div>
              </div>
            ))}
            <p className="ws-note">Доступность задана для каждой смены. Неуказанная доступность считается неизвестной.</p>
          </div>
        )}
        <div className="ws-source-footnote">
          <span>▣ Закреплённое назначение</span>
          <span>{source.timezone} · {source.currency}</span>
        </div>
        {selected && <div className="ws-source-reference" data-testid="source-reference"><span className="ws-kicker">ВЫБРАННЫЙ ИСТОЧНИК</span><strong>Строка {selected.sourceRow} · {selected.id}</strong><p>{source.projectId ? `${selected.sourceRefs?.employee_id?.filename ?? source.filename}${selected.sourceRefs?.employee_id?.sheet ? ` / ${selected.sourceRefs.employee_id.sheet}` : ''}. Назначение и время сохранены вместе с происхождением полей.` : 'Назначение и время взяты из таблицы. Доступность и ставки — из синтетических карточек команды.'}</p><button type="button" className="ws-text-button" onClick={() => setView(view === 'team' ? 'schedule' : 'team')}>{view === 'team' ? 'Открыть расписание ↗' : 'Открыть ставки команды ↗'}</button></div>}
      </div>
    </>
  );
}
