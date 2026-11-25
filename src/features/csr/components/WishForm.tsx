import { useState } from 'react';
import type { ReactNode } from 'react';
import type { Reply } from '../api/shared.ts';
import { DAY_NAMES, TEMPLATES } from '../model/defaults.ts';
import { clock, shortDate, weekDates, weekRange } from '../model/time.ts';

type DayWish = '' | 'work' | 'off';
const CHOICES: [DayWish, string][] = [['', 'No preference'], ['work', 'I want to work'], ['off', 'I want the day off']];

interface WishFormProps {
  weekStart: string;
  /** Who to choose from when a wish link was opened; null when the account already says who is writing. */
  operators: { id: string; nick: string }[] | null;
  send: (wish: { operatorId: string; days: string[]; shifts: string[]; comment: string }) => Promise<Reply<{ id: string }>>;
  /** Stands in for the line that names the week, for a form where the week can be chosen. */
  weekLine?: ReactNode;
}

/** Which days and hours an operator would like, in their own words too. */
export default function WishForm({ weekStart, operators, send, weekLine }: WishFormProps) {
  const [operatorId, setOperatorId] = useState('');
  const [days, setDays] = useState<DayWish[]>(() => Array<DayWish>(7).fill(''));
  const [shifts, setShifts] = useState<string[]>([]);
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  const submit = async () => {
    if (operators && !operatorId) return setError('Choose your name first.');
    if (!days.some(Boolean) && !shifts.length && !comment.trim()) return setError('Mark a day or a shift, or write a comment.');
    setSending(true); setError(null);
    const reply = await send({ operatorId, days, shifts, comment });
    setSending(false);
    if (reply.ok) setSent(operators?.find(operator => operator.id === operatorId)?.nick ?? '');
    else setError(reply.message);
  };
  const again = () => { setSent(null); setOperatorId(''); setDays(Array<DayWish>(7).fill('')); setShifts([]); setComment(''); };
  const dates = weekDates(weekStart);

  if (sent !== null) return (
    <div className="csr-wish-done" role="status">
      <strong className="ws-green">✓ Sent{sent ? `, ${sent}` : ''}</strong>
      <p>The scheduler will see your wish for the week of {weekRange(weekStart)}. A wish is a request, not a promise: the schedule still has to cover both lines.</p>
      <button type="button" className="ws-outline" onClick={again}>Send another wish</button>
    </div>
  );
  return (
    <form onSubmit={event => { event.preventDefault(); void submit(); }}>
      {weekLine ?? <p className="csr-wish-week">Week of <b>{weekRange(weekStart)}</b>. All hours below are Pacific time.</p>}
      {operators && (
        <label className="csr-field" htmlFor="wish-operator"><span>Who are you?</span>
          <select id="wish-operator" value={operatorId} onChange={event => setOperatorId(event.target.value)}>
            <option value="">Choose your name</option>
            {operators.map(operator => <option key={operator.id} value={operator.id}>{operator.nick}</option>)}
          </select>
        </label>
      )}

      <fieldset>
        <legend>Days</legend>
        <div className="csr-wish-days">
          {DAY_NAMES.map((name, day) => (
            <div key={name} role="group" aria-label={`${name}, ${shortDate(dates[day])}`}>
              <span>{name}<small>{shortDate(dates[day])}</small></span>
              {CHOICES.map(([value, label]) => (
                <label key={value} data-choice={value || 'none'} data-on={days[day] === value}>
                  <input type="radio" name={`day-${day}`} checked={days[day] === value} onChange={() => setDays(current => current.map((item, index) => index === day ? value : item))} />{label}
                </label>
              ))}
            </div>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend>Preferred hours</legend>
        <div className="csr-wish-shifts">
          {TEMPLATES.map(template => (
            <label key={template.id} data-on={shifts.includes(template.id)}>
              <input type="checkbox" checked={shifts.includes(template.id)} onChange={event => setShifts(current => event.target.checked ? [...current, template.id] : current.filter(id => id !== template.id))} />
              {clock(template.start)} – {clock(template.end)}
            </label>
          ))}
        </div>
        <p className="csr-hint">Tick every shift that suits you, or none if any will do.</p>
      </fieldset>

      <label className="csr-field" htmlFor="wish-comment"><span>Anything else the scheduler should know</span>
        <textarea id="wish-comment" maxLength={1000} rows={4} value={comment} onChange={event => setComment(event.target.value)} />
      </label>
      {error && <p className="ws-notice" role="alert">{error}</p>}
      <button type="submit" className="ws-primary" disabled={sending}><span>{sending ? 'Sending…' : 'Send the wish'}</span><span aria-hidden="true">→</span></button>
    </form>
  );
}
