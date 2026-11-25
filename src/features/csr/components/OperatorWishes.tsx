import { useEffect, useMemo, useState } from 'react';
import ScanlineOverlay from '../../../components/ScanlineOverlay';
import { sendMyWish } from '../api/shared.ts';
import type { Accounts } from '../api/useAccount.ts';
import { addDays, departmentToday, mondayOf, weekRange } from '../model/time.ts';
import AccountBox from './AccountBox';
import WishForm from './WishForm';

/** What an operator sees after signing in: the wish form, already knowing who they are. */
export default function OperatorWishes({ auth }: { auth: Accounts }) {
  const weeks = useMemo(() => { const first = mondayOf(departmentToday()); return [0, 1, 2, 3].map(ahead => addDays(first, ahead * 7)); }, []);
  // Wishes are mostly about the week that is not built yet: the next one.
  const [weekStart, setWeekStart] = useState(weeks[1]);
  const [accountOpen, setAccountOpen] = useState(false);
  const name = auth.account?.operatorNick;

  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'Schedule wishes — Operators Division';
    return () => { document.title = previousTitle; };
  }, []);

  return (
    <div className="workspace csr csr-wish-page">
      <ScanlineOverlay />
      <main className="csr-wish">
        <p className="ws-kicker ws-green">OPERATORS DIVISION // SCHEDULE WISHES</p>
        <h1 className="font-display">YOUR WISHES<span className="ws-orange">_</span></h1>
        <p className="csr-hint csr-wish-who">Signed in as {auth.account?.nick}{name ? <>, in the schedule as <b>{name}</b></> : null}.
          <button type="button" className="ws-text-button" onClick={() => setAccountOpen(true)}>Account</button>
          <button type="button" className="ws-text-button" onClick={auth.signOut}>Sign out</button></p>
        {!name ? <p className="ws-notice" role="alert"><strong>There is nobody to send a wish for</strong>This account is no longer tied to anyone in the team. Ask the scheduler.</p> : (
          // A new week starts a clean form: marks made for one week are not carried into another.
          <WishForm key={weekStart} weekStart={weekStart} operators={null} send={wish => sendMyWish({ weekStart, days: wish.days, shifts: wish.shifts, comment: wish.comment })}
            weekLine={<label className="csr-field" htmlFor="wish-week"><span>Which week? All hours below are Pacific time.</span>
              <select id="wish-week" value={weekStart} onChange={event => setWeekStart(event.target.value)}>
                {weeks.map((week, index) => <option key={week} value={week}>{weekRange(week)}{index === 0 ? ' (this week)' : index === 1 ? ' (next week)' : ''}</option>)}
              </select></label>} />
        )}
      </main>
      {accountOpen && <AccountBox auth={auth} operators={[]} onClose={() => setAccountOpen(false)} />}
    </div>
  );
}
