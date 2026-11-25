import { useState } from 'react';
import type { Accounts } from '../api/useAccount.ts';

/** Sign in, or ask for an account. A new account opens nothing until the owner lets it in. */
export default function SignIn({ auth }: { auth: Accounts }) {
  const [fresh, setFresh] = useState(false);
  const [nick, setNick] = useState('');
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (fresh && password !== again) return setError('The two passwords are not the same.');
    setBusy(true); setError(null);
    const problem = await (fresh ? auth.signUp(nick, password) : auth.signIn(nick, password));
    setBusy(false);
    if (problem) setError(problem);
  };

  return (
    <form className="csr-unlock" onSubmit={event => { event.preventDefault(); void submit(); }}>
      <label htmlFor="csr-nick">Nickname</label>
      <input id="csr-nick" type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={24} value={nick} onChange={event => setNick(event.target.value)} />
      <label htmlFor="csr-password">Password</label>
      <input id="csr-password" type="password" autoComplete={fresh ? 'new-password' : 'current-password'} maxLength={200} value={password} onChange={event => setPassword(event.target.value)} />
      {fresh && <>
        <label htmlFor="csr-password-again">Password again</label>
        <input id="csr-password-again" type="password" autoComplete="new-password" maxLength={200} value={again} onChange={event => setAgain(event.target.value)} />
      </>}
      <button type="submit" className="ws-outline" disabled={busy || !nick.trim() || !password}>{busy ? 'One moment…' : fresh ? 'Create the account' : 'Sign in'}</button>
      <button type="button" className="ws-text-button" onClick={() => { setFresh(!fresh); setError(null); }}>{fresh ? 'I already have an account' : 'Create an account'}</button>
      <span>{fresh ? 'Use your work nickname and a password of 8 characters or more. The owner lets a new account in before it opens anything.' : 'Forgot the password? The owner can reset it.'}</span>
      {error && <b data-tone="error" role="alert">{error}</b>}
    </form>
  );
}
