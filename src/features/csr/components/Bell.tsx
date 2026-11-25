import { useEffect, useRef, useState } from 'react';
import { createWishLink } from '../api/shared.ts';
import type { Wishes } from '../api/useWishes.ts';
import { weekRange } from '../model/time.ts';
import type { Operator } from '../model/types.ts';
import { whenLabel, wishLines } from '../model/wishes.ts';

interface BellProps {
  wishes: Wishes;
  operators: Operator[];
  weekStart: string;
  /** The wish list is behind a team key this browser does not have. */
  locked: boolean;
  open: boolean;
  onToggle: (open: boolean) => void;
}

/** The bell in the header: wishes that arrived through wish links, and the button that makes such a link. */
export default function Bell({ wishes, operators, weekStart, locked, open, onToggle }: BellProps) {
  const root = useRef<HTMLDivElement>(null);
  const [link, setLink] = useState<{ weekStart: string; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) onToggle(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') onToggle(false); };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open, onToggle]);
  // Opening the list is what marks the wishes as seen.
  useEffect(() => { if (open) wishes.markSeen(); }, [open, wishes]);

  const create = async () => {
    setBusy(true); setNote(null);
    const reply = await createWishLink(weekStart, operators.map(({ id, nick }) => ({ id, nick })));
    setBusy(false);
    if (reply.ok) setLink({ weekStart, url: `${window.location.origin}/fs_csr_schedule/wish/${reply.data.token}` });
    else setNote(reply.message);
  };
  const copy = async () => {
    if (!link) return;
    try { await navigator.clipboard.writeText(link.url); setNote('Link copied. Send it to the operators.'); }
    catch { setNote('Select the link and copy it by hand.'); }
  };

  return (
    <div className="csr-bell" ref={root}>
      <button type="button" className="csr-bell-button" aria-haspopup="dialog" aria-expanded={open} onClick={() => onToggle(!open)}
        aria-label={wishes.unread ? `Wishes: ${wishes.unread} new` : 'Wishes'} data-unread={wishes.unread > 0}>
        <svg viewBox="0 0 16 16" width="17" height="17" aria-hidden="true"><path d="M8 1.5c-2.5 0-4 1.8-4 4.3v2.4L2.5 11v1h11v-1L12 8.2V5.8c0-2.5-1.5-4.3-4-4.3zM6.4 13.3a1.7 1.7 0 0 0 3.2 0z" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" /></svg>
        <span>Wishes</span>{wishes.unread > 0 && <b>{wishes.unread}</b>}
      </button>
      {open && (
        <div className="csr-bell-panel" role="dialog" aria-label="Wishes from operators">
          <div className="csr-bell-head"><strong>Wishes from operators</strong><span className="ws-kicker">{wishes.wishes.length} in all</span></div>
          {!wishes.available ? <p className="ws-notice">{locked ? 'Wishes are behind the team key. Enter it under the toolbar, and the link and this list start working.' : 'Wishes travel through shared storage, which is not connected yet. Once it is, the link and this list start working.'}</p> : (
            <>
              <div className="csr-bell-link">
                <button type="button" className="ws-outline" disabled={busy} onClick={() => void create()}>{busy ? 'Making the link…' : `Make a wish link for ${weekRange(weekStart)}`}</button>
                {link && (
                  <>
                    <label className="csr-field" htmlFor="csr-wish-link"><span>Link for the week of {weekRange(link.weekStart)}</span>
                      <input id="csr-wish-link" type="text" readOnly value={link.url} onFocus={event => event.target.select()} />
                    </label>
                    <button type="button" className="ws-text-button" onClick={() => void copy()}>Copy the link</button>
                  </>
                )}
                {note && <p className="csr-hint" role="status">{note}</p>}
                <p className="csr-hint">Anyone with the link can pick their name, mark preferred days and hours, and add a comment. What they send shows up here and in their card on the left.</p>
              </div>
              {wishes.wishes.length ? (
                <ul className="csr-wish-list">
                  {wishes.wishes.map(wish => (
                    <li key={wish.id}>
                      <strong>{wish.nick}<small>week of {weekRange(wish.weekStart)}</small></strong>
                      {wishLines(wish).map(line => <p key={line}>{line}</p>)}
                      <small>{whenLabel(wish.createdAt)} · <button type="button" className="ws-text-button" onClick={() => wishes.remove(wish.id)}>Remove</button></small>
                    </li>
                  ))}
                </ul>
              ) : <p className="csr-hint">No wishes yet.</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
