import { useCallback, useEffect, useState } from 'react';
import { changePassword, claimOwner, dropOldTeamKey, listAccounts, loadMe, signIn, signOut, signUp } from './shared.ts';
import type { Account, Reply } from './shared.ts';

const POLL_MS = 60_000;

export interface Accounts {
  /** False until the site has said who is signed in here; the page waits for that before it draws. */
  loaded: boolean;
  /** The site has accounts at all: the owner key is set and shared storage is connected. */
  enabled: boolean;
  account: Account | null;
  /** Accounts waiting for approval. Counted only for an owner. */
  waiting: number;
  /** Each of these answers null when it worked, or says in words why it did not. */
  signIn: (nick: string, password: string) => Promise<string | null>;
  signUp: (nick: string, password: string) => Promise<string | null>;
  changePassword: (current: string, next: string) => Promise<string | null>;
  claimOwner: (key: string) => Promise<string | null>;
  signOut: () => void;
  refresh: () => void;
}

/**
 * Who is signed in. The session itself is a cookie the page cannot read, so the site is asked:
 * on opening, once a minute, and when the tab gets focus. That is how an approval shows up without a reload.
 */
export function useAccount(): Accounts {
  const [loaded, setLoaded] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [account, setAccount] = useState<Account | null>(null);
  const [waiting, setWaiting] = useState(0);

  const refresh = useCallback(async () => {
    const reply = await loadMe();
    if (reply.ok) {
      setEnabled(reply.data.accounts); setAccount(reply.data.account);
      const list = reply.data.account?.role === 'owner' ? await listAccounts() : null;
      setWaiting(list?.ok ? list.data.accounts.filter(item => item.status === 'pending').length : 0);
    }
    // A site that could not be asked is drawn as it was last known; the builder still works on this browser's copy.
    setLoaded(true);
  }, []);

  useEffect(() => {
    dropOldTeamKey();
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, POLL_MS);
    const onFocus = () => { void refresh(); };
    window.addEventListener('focus', onFocus);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', onFocus); };
  }, [refresh]);

  const settle = useCallback(async (reply: Reply<{ account: Account }>): Promise<string | null> => {
    if (!reply.ok) return reply.message;
    setAccount(reply.data.account);
    await refresh();
    return null;
  }, [refresh]);

  return {
    loaded, enabled, account, waiting,
    signIn: async (nick, password) => settle(await signIn(nick, password)),
    signUp: async (nick, password) => settle(await signUp(nick, password)),
    changePassword: async (current, next) => settle(await changePassword(current, next)),
    claimOwner: async key => settle(await claimOwner(key)),
    signOut: () => { void signOut().then(refresh); },
    refresh: () => { void refresh(); },
  };
}
