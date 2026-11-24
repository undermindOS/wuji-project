import { useEffect, useRef, useState } from 'react';
import { DAY_NAMES } from '../model/defaults.ts';
import { MONTH_NAMES, addDays, departmentToday, mondayOf, monthWeeks, weekRange } from '../model/time.ts';

interface WeekPickerProps {
  weekStart: string;
  /** Mondays of the weeks that already have a schedule. */
  builtWeeks: string[];
  onOpenWeek: (weekStart: string) => void;
}

const monthOf = (date: string) => ({ year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)) });

/** The week button with its own calendar: every row is one week, picked as a whole. */
export default function WeekPicker({ weekStart, builtWeeks, onOpenWeek }: WeekPickerProps) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => monthOf(weekStart));
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const rows = useRef<HTMLDivElement>(null);
  const today = departmentToday();

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    (rows.current?.querySelector<HTMLButtonElement>('[data-selected="true"]') ?? rows.current?.querySelector<HTMLButtonElement>('button'))?.focus();
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);

  const pick = (monday: string) => { onOpenWeek(monday); setOpen(false); trigger.current?.focus(); };
  const shiftMonth = (by: number) => setView(current => {
    const index = current.year * 12 + current.month - 1 + by;
    return { year: Math.floor(index / 12), month: index % 12 + 1 };
  });
  const moveFocus = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const buttons = [...(rows.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
    buttons[buttons.indexOf(event.currentTarget) + (event.key === 'ArrowDown' ? 1 : -1)]?.focus();
  };

  return (
    <div className="csr-week" ref={root}>
      <button type="button" className="csr-week-step" onClick={() => onOpenWeek(addDays(weekStart, -7))} aria-label="Previous week">←</button>
      <button type="button" ref={trigger} className="csr-week-trigger" aria-haspopup="dialog" aria-expanded={open}
        onClick={() => { if (!open) setView(monthOf(weekStart)); setOpen(!open); }}>
        <span className="ws-kicker">Week</span><strong>{weekRange(weekStart)}</strong><span aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>
      <button type="button" className="csr-week-step" onClick={() => onOpenWeek(addDays(weekStart, 7))} aria-label="Next week">→</button>
      {open && (
        <div className="csr-calendar" role="dialog" aria-label="Choose a week">
          <div className="csr-calendar-head">
            <button type="button" onClick={() => shiftMonth(-1)} aria-label="Previous month">←</button>
            <strong aria-live="polite">{MONTH_NAMES[view.month - 1]} {view.year}</strong>
            <button type="button" onClick={() => shiftMonth(1)} aria-label="Next month">→</button>
          </div>
          <div className="csr-calendar-days" aria-hidden="true">{DAY_NAMES.map(day => <span key={day}>{day}</span>)}</div>
          <div className="csr-calendar-rows" ref={rows}>
            {monthWeeks(view.year, view.month).map(monday => {
              const built = builtWeeks.includes(monday);
              return (
                <button type="button" key={monday} data-selected={monday === weekStart} data-built={built} onKeyDown={moveFocus} onClick={() => pick(monday)}
                  aria-label={`Week of ${weekRange(monday)}${monday === weekStart ? ', open now' : ''}${built ? ', has a schedule' : ''}`}>
                  {DAY_NAMES.map((day, index) => {
                    const date = addDays(monday, index);
                    return <span key={day} data-outside={Number(date.slice(5, 7)) !== view.month} data-today={date === today}>{Number(date.slice(8, 10))}</span>;
                  })}
                </button>
              );
            })}
          </div>
          <div className="csr-calendar-foot">
            <button type="button" className="ws-text-button" onClick={() => pick(mondayOf(today))}>Go to the current week</button>
            <span><i aria-hidden="true" /> week has a schedule</span>
          </div>
        </div>
      )}
    </div>
  );
}
