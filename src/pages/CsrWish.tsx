import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import ScanlineOverlay from '../components/ScanlineOverlay';
import { loadWishForm, sendWish } from '../features/csr/api/shared.ts';
import type { WishForm } from '../features/csr/api/shared.ts';
import { DAY_NAMES, TEMPLATES } from '../features/csr/model/defaults.ts';
import { clock, shortDate, weekDates, weekRange } from '../features/csr/model/time.ts';
import '../features/workspace/workspace.css';
import '../features/csr/csr.css';

type DayWish = '' | 'work' | 'off';
const CHOICES: [DayWish, string][] = [['', 'No preference'], ['work', 'I want to work'], ['off', 'I want the day off']];

/** The page a wish link opens: an operator says which days and hours they would like, in their own words too. */
export default function CsrWish() {
  const { token = '' } = useParams();
  const [form, setForm] = useState<WishForm | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [operatorId, setOperatorId] = useState('');
  const [days, setDays] = useState<DayWish[]>(() => Array<DayWish>(7).fill(''));
  const [shifts, setShifts] = useState<string[]>([]);
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'Schedule wishes — Operators Division';
    let alive = true;
    void loadWishForm(token).then(reply => {
      if (!alive) return;
      if (reply.ok) setForm(reply.data);
      else setProblem(reply.trouble === 'not_found' ? 'This link does not exist or was removed. Ask the scheduler for a new one.' : reply.trouble === 'not_connected' ? 'Wishes are not switched on yet. Ask the scheduler to try again later.' : reply.message);
    });
    return () => { alive = false; document.title = previousTitle; };
  }, [token]);

  const submit = async () => {
    if (!form) return;
    if (!operatorId) return setError('Choose your name first.');
    if (!days.some(Boolean) && !shifts.length && !comment.trim()) return setError('Mark a day or a shift, or write a comment.');
    setSending(true); setError(null);
    const reply = await sendWish({ token, operatorId, days, shifts, comment });
    setSending(false);
    if (reply.ok) setSent(form.operators.find(operator => operator.id === operatorId)?.nick ?? '');
    else setError(reply.message);
  };
  const again = () => { setSent(null); setOperatorId(''); setDays(Array<DayWish>(7).fill('')); setShifts([]); setComment(''); };
  const dates = form ? weekDates(form.weekStart) : [];

  return (
    <div className="workspace csr csr-wish-page">
      <ScanlineOverlay />
      <main className="csr-wish">
        <p className="ws-kicker ws-green">OPERATORS DIVISION // SCHEDULE WISHES</p>
        <h1 className="font-display">YOUR WISHES<span className="ws-orange">_</span></h1>
        {problem ? <p className="ws-notice" role="alert"><strong>The form could not be opened</strong>{problem}</p>
          : !form ? <p className="csr-hint" role="status">Opening the form…</p>
          : sent !== null ? (
            <div className="csr-wish-done" role="status">
              <strong className="ws-green">✓ Sent{sent ? `, ${sent}` : ''}</strong>
              <p>The scheduler will see your wish for the week of {weekRange(form.weekStart)}. A wish is a request, not a promise: the schedule still has to cover both lines.</p>
              <button type="button" className="ws-outline" onClick={again}>Send another wish</button>
            </div>
          ) : (
            <form onSubmit={event => { event.preventDefault(); void submit(); }}>
              <p className="csr-wish-week">Week of <b>{weekRange(form.weekStart)}</b>. All hours below are Pacific time.</p>
              <label className="csr-field" htmlFor="wish-operator"><span>Who are you?</span>
                <select id="wish-operator" value={operatorId} onChange={event => setOperatorId(event.target.value)}>
                  <option value="">Choose your name</option>
                  {form.operators.map(operator => <option key={operator.id} value={operator.id}>{operator.nick}</option>)}
                </select>
              </label>

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
          )}
      </main>
    </div>
  );
}
