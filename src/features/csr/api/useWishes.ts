import { useCallback, useEffect, useState } from 'react';
import type { Wish } from '../model/types.ts';
import { listWishes, removeWish } from './shared.ts';

const SEEN_KEY = 'wuji.csr.wishes.seen.v1';
const POLL_MS = 60_000;

export interface Wishes {
  /** False while shared storage is not connected: there is nowhere for wishes to arrive. */
  available: boolean;
  wishes: Wish[];
  unread: number;
  markSeen: () => void;
  remove: (id: string) => void;
  refresh: () => void;
}

/** Wishes sent through wish links, newest first, checked once a minute and whenever the tab gets focus. */
export function useWishes(connected: boolean): Wishes {
  const [wishes, setWishes] = useState<Wish[]>([]);
  const [available, setAvailable] = useState(false);
  const [seen, setSeen] = useState(() => { try { return window.localStorage.getItem(SEEN_KEY) ?? ''; } catch { return ''; } });

  const refresh = useCallback(async () => {
    const reply = await listWishes();
    setAvailable(reply.ok);
    if (reply.ok) setWishes(reply.data.wishes);
  }, []);

  useEffect(() => {
    if (!connected) { setAvailable(false); return; }
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, POLL_MS);
    const onFocus = () => { void refresh(); };
    window.addEventListener('focus', onFocus);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', onFocus); };
  }, [refresh, connected]);

  const markSeen = useCallback(() => {
    const newest = wishes[0]?.createdAt ?? '';
    if (newest <= seen) return;
    setSeen(newest);
    try { window.localStorage.setItem(SEEN_KEY, newest); } catch { /* the count simply comes back next visit */ }
  }, [wishes, seen]);

  const remove = useCallback(async (id: string) => {
    const reply = await removeWish(id);
    if (reply.ok) setWishes(current => current.filter(wish => wish.id !== id));
  }, []);

  return { available, wishes, unread: wishes.filter(wish => wish.createdAt > seen).length, markSeen, remove: (id: string) => { void remove(id); }, refresh: () => { void refresh(); } };
}
