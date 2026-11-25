import { useCallback, useEffect, useRef, useState } from 'react';
import { changeAccount, listAccounts } from '../api/shared.ts';
import type { Account, AccountChange } from '../api/shared.ts';
import type { Accounts } from '../api/useAccount.ts';
import type { Operator } from '../model/types.ts';
import { whenLabel } from '../model/wishes.ts';

const ROLE: Record<string, string> = { owner: 'owner', scheduler: 'scheduler', operator: 'operator' };

/** One line of the owner's list: an account and what can be done with it. */
function Row({ item, operators, busy, onChange }: { item: Account; operators: Operator[]; busy: boolean; onChange: (change: AccountChange) => void }) {
  const [purpose, setPurpose] = useState('');
  const [asking, setAsking] = useState<'remove' | 'reset' | null>(null);
  const tiedTo = operators.find(operator => operator.id === item.operatorId)?.nick;
  const approve = () => onChange(purpose === 'scheduler' ? { action: 'approve', role: 'scheduler' } : { action: 'approve', role: 'operator', operatorId: purpose.slice(9) });
  return (
    <li>
      <div>
        <strong>{item.nick}</strong>
        <p>{item.status === 'pending' ? `Asked for an account on ${whenLabel(item.createdAt)}` : `${ROLE[item.role ?? ''] ?? 'no role'}${item.role === 'operator' ? ` · sends wishes as ${tiedTo ?? 'someone no longer in the team'}` : ''}${item.status === 'disabled' ? ' · switched off' : ''}`}</p>
        {item.status === 'pending' && (
          <p className="csr-account-approve">
            <label className="ws-sr-only" htmlFor={`purpose-${item.nick}`}>What {item.nick} will do</label>
            <select id={`purpose-${item.nick}`} value={purpose} onChange={event => setPurpose(event.target.value)}>
              <option value="">Let in as…</option>
              <option value="scheduler">Scheduler: builds and saves the schedule</option>
              {operators.map(operator => <option key={operator.id} value={`operator:${operator.id}`}>Operator: sends wishes as {operator.nick}</option>)}
            </select>
            <button type="button" className="ws-outline" disabled={busy || !purpose} onClick={approve}>Let in</button>
          </p>
        )}
        {asking ? (
          <p className="csr-history-ask" role="alert">{asking === 'remove' ? `Remove ${item.nick}? The account is deleted and the nickname is free again.` : `Give ${item.nick} a new one-time password? The current password stops working at once.`}
            <button type="button" className="ws-text-button ws-red" disabled={busy} onClick={() => { onChange({ action: asking }); setAsking(null); }}>{asking === 'remove' ? 'Remove' : 'Reset the password'}</button>
            <button type="button" className="ws-text-button" onClick={() => setAsking(null)}>Cancel</button></p>
        ) : item.role !== 'owner' && (
          <p>
            {item.status === 'active' && <button type="button" className="ws-text-button" disabled={busy} onClick={() => onChange({ action: 'disable' })}>Switch off</button>}
            {item.status === 'disabled' && <button type="button" className="ws-text-button" disabled={busy} onClick={() => onChange({ action: 'enable' })}>Switch back on</button>}
            {item.status !== 'pending' && <button type="button" className="ws-text-button" onClick={() => setAsking('reset')}>Reset the password</button>}
            <button type="button" className="ws-text-button" onClick={() => setAsking('remove')}>{item.status === 'pending' ? 'Decline' : 'Remove'}</button>
          </p>
        )}
      </div>
    </li>
  );
}

/** The signed-in person's own account, and for an owner everyone else's: who waits, who is in, who is switched off. */
export default function AccountBox({ auth, operators, onClose }: { auth: Accounts; operators: Operator[]; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const me = auth.account;
  const owner = me?.role === 'owner';
  const [list, setList] = useState<Account[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [oneTime, setOneTime] = useState<{ nick: string; password: string } | null>(null);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [key, setKey] = useState('');
  const refreshAuth = auth.refresh;

  const load = useCallback(async () => {
    const reply = await listAccounts();
    if (reply.ok) setList(reply.data.accounts); else setNote({ tone: 'error', text: reply.message });
  }, []);
  useEffect(() => { if (owner) void load(); }, [owner, load]);

  // Focus moves into the dialog once, when it opens, then stays inside and goes round.
  useEffect(() => { close.current?.focus(); }, []);
  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab' || !box.current) return;
      const stops = [...box.current.querySelectorAll<HTMLElement>('button:not(:disabled), input, select')];
      const first = stops[0], last = stops[stops.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keys);
    return () => document.removeEventListener('keydown', keys);
  }, [onClose]);

  const change = async (nick: string, what: AccountChange) => {
    setBusy(true); setNote(null); setOneTime(null);
    const reply = await changeAccount(nick, what);
    setBusy(false);
    if (!reply.ok) return setNote({ tone: 'error', text: reply.message });
    if (reply.data.password) setOneTime({ nick: reply.data.nick, password: reply.data.password });
    await load(); refreshAuth();
  };
  const newPassword = async () => {
    setBusy(true); setNote(null);
    const problem = await auth.changePassword(current, next);
    setBusy(false);
    if (problem) return setNote({ tone: 'error', text: problem });
    setCurrent(''); setNext('');
    setNote({ tone: 'ok', text: 'The password was changed. Other browsers signed in to this account were signed out.' });
  };
  const becomeOwner = async () => {
    setBusy(true); setNote(null);
    const problem = await auth.claimOwner(key);
    setBusy(false); setKey('');
    setNote(problem ? { tone: 'error', text: problem } : { tone: 'ok', text: 'This account is now an owner: it lets other accounts in.' });
  };

  const group = (status: Account['status']) => (list ?? []).filter(item => item.status === status);
  const section = (title: string, items: Account[], empty: string) => (
    <>
      <h3>{title}</h3>
      {items.length ? <ol>{items.map(item => <Row key={item.nick} item={item} operators={operators} busy={busy || item.nick === me?.nick} onChange={what => void change(item.nick, what)} />)}</ol> : <p className="csr-hint">{empty}</p>}
    </>
  );

  return (
    <div className="csr-guide-backdrop" onPointerDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="csr-guide csr-history csr-accounts" role="dialog" aria-modal="true" aria-labelledby="csr-account-title" ref={box}>
        <p className="ws-kicker ws-green">ACCOUNT</p>
        <h2 id="csr-account-title">{me ? me.nick : 'Not signed in'}</h2>
        {me && <p className="csr-guide-note">{me.status === 'pending' ? 'Waiting for the owner to let this account in.' : `Signed in as ${ROLE[me.role ?? ''] ?? 'a member'}.`}
          <button type="button" className="ws-text-button" onClick={() => { auth.signOut(); onClose(); }}>Sign out</button></p>}
        {note && <p className="ws-notice" role="status" data-tone={note.tone}>{note.text}</p>}

        {me && (
          <form className="csr-account-form" onSubmit={event => { event.preventDefault(); void newPassword(); }}>
            <h3>Change the password</h3>
            <label className="csr-field" htmlFor="csr-current-password"><span>Current password</span><input id="csr-current-password" type="password" autoComplete="current-password" maxLength={200} value={current} onChange={event => setCurrent(event.target.value)} /></label>
            <label className="csr-field" htmlFor="csr-new-password"><span>New password, 8 characters or more</span><input id="csr-new-password" type="password" autoComplete="new-password" maxLength={200} value={next} onChange={event => setNext(event.target.value)} /></label>
            <button type="submit" className="ws-outline" disabled={busy || !current || next.length < 8}>Change</button>
          </form>
        )}
        {me && !owner && (
          <form className="csr-account-form" onSubmit={event => { event.preventDefault(); void becomeOwner(); }}>
            <h3>Owner of the site?</h3>
            <label className="csr-field" htmlFor="csr-owner-key"><span>Owner key, the one set for the site in its hosting settings</span><input id="csr-owner-key" type="password" autoComplete="off" value={key} onChange={event => setKey(event.target.value)} /></label>
            <button type="submit" className="ws-outline" disabled={busy || !key.trim()}>Make this account an owner</button>
          </form>
        )}

        {owner && (
          <>
            {oneTime && <p className="ws-notice csr-one-time" role="alert"><strong>One-time password for {oneTime.nick}</strong><code>{oneTime.password}</code> It is shown only now. Pass it on privately; they set their own under Account after signing in.</p>}
            {!list ? <p className="csr-hint" role="status">Loading the accounts…</p> : (
              <>
                {section('Waiting to be let in', group('pending'), 'Nobody is waiting.')}
                {section('Let in', group('active'), 'Nobody yet.')}
                {group('disabled').length > 0 && section('Switched off', group('disabled'), '')}
              </>
            )}
          </>
        )}
        <button type="button" ref={close} className="ws-outline" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
