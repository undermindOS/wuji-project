import { useEffect, useRef, useState } from 'react';
import { listVersions } from '../api/shared.ts';
import type { SavedVersion } from '../api/shared.ts';
import type { SharedSync } from '../api/useSharedSync.ts';
import { whenLabel } from '../model/wishes.ts';

/** Every "Save for everyone" that is still kept, newest first, and the way back to any of them. */
export default function SaveHistory({ sync, onClose }: { sync: SharedSync; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const [versions, setVersions] = useState<SavedVersion[] | null>(null);
  const [trouble, setTrouble] = useState<string | null>(null);
  const [asking, setAsking] = useState<number | null>(null);
  const ready = sync.status === 'ready';

  useEffect(() => {
    if (!ready) return;
    let open = true;
    void listVersions().then(reply => { if (!open) return; if (reply.ok) setVersions(reply.data.versions); else setTrouble(reply.message); });
    return () => { open = false; };
  }, [ready]);

  // Focus moves into the dialog once, when it opens; later redraws of the page leave it where the reader put it.
  useEffect(() => { close.current?.focus(); }, []);
  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab' || !box.current) return;
      // Focus stays inside the dialog and goes round.
      const stops = [...box.current.querySelectorAll<HTMLElement>('button')];
      const first = stops[0], last = stops[stops.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keys);
    return () => document.removeEventListener('keydown', keys);
  }, [onClose]);

  const unavailable = sync.status === 'checking' ? 'Checking the copy saved for everyone…'
    : sync.status === 'locked' ? 'The save history opens after you sign in with an account the owner has let in.'
    : sync.status === 'not_connected' ? 'Shared storage is not connected, so no saves are kept.'
    : sync.status === 'unavailable' ? 'Shared storage cannot be reached right now. Try again in a minute.'
    : trouble;

  return (
    <div className="csr-guide-backdrop" onPointerDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="csr-guide csr-history" role="dialog" aria-modal="true" aria-labelledby="csr-history-title" ref={box}>
        <p className="ws-kicker ws-green">SAVED FOR EVERYONE</p>
        <h2 id="csr-history-title">Save history</h2>
        <p className="csr-guide-note">Each press of “Save for everyone” is kept here, the last thirty of them. Loading one changes this browser only; it reaches everyone when you save again.</p>
        {unavailable ? <p className="ws-notice" role="status">{unavailable}</p>
          : !versions ? <p className="csr-hint" role="status">Loading the saves…</p>
          : !versions.length ? <p className="csr-hint">Nothing has been saved for everyone yet.</p> : (
            <ol>
              {versions.map(version => {
                const mine = version.revision === sync.revision;
                return (
                  <li key={version.revision}>
                    <span aria-hidden="true">{String(version.revision).padStart(2, '0')}</span>
                    <div>
                      <strong>{whenLabel(version.savedAt)}</strong>
                      <p>Save {version.revision}{version.savedBy ? ` by ${version.savedBy}` : ''}{mine ? sync.dirty ? ' · your copy started from this one' : ' · this is the copy in this browser' : ''}
                        {asking !== version.revision && (!mine || sync.dirty) && <button type="button" className="ws-text-button" onClick={() => setAsking(version.revision)}>Load into this browser</button>}</p>
                      {asking === version.revision && (
                        <p className="csr-history-ask" role="alert">This replaces everything in this browser{sync.dirty ? ', and your changes that are not saved for everyone will be lost' : ''}.
                          <button type="button" className="ws-text-button ws-red" onClick={() => { sync.restore(version.revision); onClose(); }}>Load save {version.revision}</button>
                          <button type="button" className="ws-text-button" onClick={() => setAsking(null)}>Keep mine</button></p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        <button type="button" ref={close} className="ws-outline" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
