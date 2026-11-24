import { DAY_NAMES } from '../model/defaults.ts';
import { shortDate, weekDates } from '../model/time.ts';
import type { DayTarget } from '../model/types.ts';

const RULES: [string, string][] = [
  ['Department hours', 'Every day, 6 AM to 8 PM Pacific time.'],
  ['Both lines, every moment', 'At least one operator on voice and one on non-voice. A non-voice shift also takes calls, so it covers both lines; a voice shift covers voice only.'],
  ['Mandatory lunch', 'Every 8.5-hour shift needs a 30-minute lunch: one operator at a time, not in the first or last hour, and never while alone on a line.'],
  ['Personal norm', 'Each operator gets their own number of shifts a week, less requested days off and vacation, and no more short shifts than allowed.'],
  ['Strong and weak sides', '“Never” is a ban. Strong sides are preferred and weak ones avoided, by shift type and by time of day.'],
  ['Preferences', 'The day targets above, one start time through the week, and days off together. These give way to the rules.'],
];

interface WeekPaneProps {
  weekStart: string;
  targets: DayTarget[];
  teamSize: number;
  onTarget: (day: number, field: 'headcount' | 'nonvoice', value: number) => void;
}

/** What the solver aims for on each day, and the rules it works under. */
export default function WeekPane({ weekStart, targets, teamSize, onTarget }: WeekPaneProps) {
  const dates = weekDates(weekStart);
  const target = (day: number, field: 'headcount' | 'nonvoice', label: string) => (
    <input type="number" inputMode="numeric" min={0} max={teamSize} value={targets[day][field]} aria-label={`${label}, ${DAY_NAMES[day]} ${shortDate(dates[day])}`}
      onChange={event => { const next = Number(event.target.value); if (event.target.value !== '' && Number.isInteger(next) && next >= 0 && next <= 99) onTarget(day, field, next); }} />
  );
  return (
    <div className="csr-settings">
      <h3>How many people each day</h3>
      <p className="csr-hint">The solver aims for these numbers; they are preferred, not required.</p>
      <table className="csr-targets">
        <thead><tr><th scope="col"><span className="ws-sr-only">Target</span></th>{DAY_NAMES.map(day => <th scope="col" key={day}>{day}</th>)}</tr></thead>
        <tbody>
          <tr><th scope="row">On shift</th>{DAY_NAMES.map((day, index) => <td key={day}>{target(index, 'headcount', 'People on shift')}</td>)}</tr>
          <tr><th scope="row">Non-voice</th>{DAY_NAMES.map((day, index) => <td key={day}>{target(index, 'nonvoice', 'Of them on non-voice')}</td>)}</tr>
        </tbody>
      </table>
      <p className="csr-hint">“Non-voice” is how many of the people on shift should be on a non-voice shift. A new week starts with the numbers of the week it was opened from.</p>

      <h3>Rules the week is built on</h3>
      <ul className="ws-rules">
        {RULES.map(([label, detail], index) => <li key={label}><span>{String(index + 1).padStart(2, '0')}</span><div><strong>{label}</strong><small>{detail}</small></div></li>)}
      </ul>
    </div>
  );
}
