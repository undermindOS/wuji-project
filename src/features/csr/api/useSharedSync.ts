import { useCallback, useEffect, useRef, useState } from 'react';
import { parseState, serializeState } from '../model/storage.ts';
import type { CsrState } from '../model/types.ts';
import { checkStorage, listVersions, loadShared, loadVersion, saveShared } from './shared.ts';
import type { SavedVersion } from './shared.ts';

const META_KEY = 'wuji.csr.shared.v1';
const POLL_MS = 60_000;

/** What this browser last had in common with shared storage. */
interface Meta { revision: number; savedAt: string; hash: string }
export type SyncStatus = 'checking' | 'not_connected' | 'unavailable' | 'ready';
export interface SharedSync {
  status: SyncStatus;
  /** Revision this browser's copy is based on; 0 when nothing was ever saved for everyone. */
  revision: number;
  savedAt: string;
  /** This browser has changes that are not saved for everyone. */
  dirty: boolean;
  saving: boolean;
  /** Someone saved a newer version while this browser has changes of its own. */
  incoming: SavedVersion | null;
  message: { tone: 'ok' | 'error'; text: string } | null;
  versions: SavedVersion[] | null;
  save: (force?: boolean) => void;
  loadIncoming: () => void;
  keepMine: () => void;
  showVersions: () => void;
  restore: (revision: number) => void;
}

/** FNV-1a over the saved text: enough to tell "same as the shared copy" from "changed since". */
export function fingerprint(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) { hash ^= text.charCodeAt(index); hash = Math.imul(hash, 0x01000193); }
  return (hash >>> 0).toString(16);
}

function readMeta(): Meta {
  try {
    const value = JSON.parse(window.localStorage.getItem(META_KEY) ?? 'null') as Partial<Meta> | null;
    if (value && Number.isInteger(value.revision) && typeof value.savedAt === 'string' && typeof value.hash === 'string') return value as Meta;
  } catch { /* fall through to "never synced" */ }
  return { revision: 0, savedAt: '', hash: '' };
}

/**
 * Keeps this browser's copy and the copy saved for everyone apart on purpose: edits are autosaved here,
 * and go to everyone only when Save is pressed. A newer shared version is loaded on its own only when
 * this browser has nothing unsaved; otherwise the scheduler is asked.
 */
export function useSharedSync(state: CsrState, adopt: (next: CsrState) => void, hadLocalCopy: boolean): SharedSync {
  const [meta, setMetaState] = useState<Meta>(readMeta);
  const [status, setStatus] = useState<SyncStatus>('checking');
  const [saving, setSaving] = useState(false);
  const [incoming, setIncoming] = useState<SavedVersion | null>(null);
  const [message, setMessage] = useState<SharedSync['message']>(null);
  const [versions, setVersions] = useState<SavedVersion[] | null>(null);
  const text = serializeState(state);
  const dirty = fingerprint(text) !== meta.hash;
  const latest = useRef({ meta, dirty, text, hadLocalCopy, dismissed: 0 });
  latest.current = { ...latest.current, meta, dirty, text };

  // A note about the last save or load is news for a moment, not a standing fact.
  useEffect(() => {
    if (!message || message.tone === 'error') return;
    const timer = window.setTimeout(() => setMessage(null), 8000);
    return () => window.clearTimeout(timer);
  }, [message]);

  const setMeta = useCallback((next: Meta) => {
    setMetaState(next);
    try { window.localStorage.setItem(META_KEY, JSON.stringify(next)); } catch { /* the copy still works for this visit */ }
  }, []);

  const take = useCallback((shared: { revision: number; savedAt: string; state: unknown }, note: string): boolean => {
    const parsed = parseState(JSON.stringify(shared.state));
    if ('error' in parsed) { setMessage({ tone: 'error', text: `The version saved for everyone could not be read (${parsed.error}) Your copy was left as it is.` }); return false; }
    adopt(parsed.state);
    setMeta({ revision: shared.revision, savedAt: shared.savedAt, hash: fingerprint(serializeState(parsed.state)) });
    setIncoming(null); setMessage({ tone: 'ok', text: note });
    return true;
  }, [adopt, setMeta]);

  const pull = useCallback(async () => {
    const health = await checkStorage();
    if (!health.ok || !health.data.storage) { setStatus(health.ok || health.trouble === 'not_connected' ? 'not_connected' : 'unavailable'); return; }
    const reply = await loadShared();
    if (!reply.ok) { setStatus(reply.trouble === 'not_connected' ? 'not_connected' : 'unavailable'); return; }
    setStatus('ready');
    const shared = reply.data, now = latest.current;
    if (shared.revision <= now.meta.revision) return;
    // A browser that never held a copy of its own, or holds an unchanged one, simply follows the shared copy.
    if (!now.hadLocalCopy || !now.dirty) { latest.current.hadLocalCopy = true; take(shared, 'Loaded the latest version saved for everyone.'); return; }
    if (shared.revision !== now.dismissed) setIncoming({ revision: shared.revision, savedAt: shared.savedAt });
  }, [take]);

  useEffect(() => {
    void pull();
    const timer = window.setInterval(() => { void pull(); }, POLL_MS);
    const onFocus = () => { void pull(); };
    window.addEventListener('focus', onFocus);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', onFocus); };
  }, [pull]);

  const save = useCallback(async (force = false) => {
    setSaving(true); setMessage(null);
    const sent = latest.current.text;
    const reply = await saveShared(JSON.parse(sent), latest.current.meta.revision, force);
    setSaving(false);
    if (reply.ok) {
      latest.current.hadLocalCopy = true;
      setMeta({ revision: reply.data.revision, savedAt: reply.data.savedAt, hash: fingerprint(sent) });
      setIncoming(null); setStatus('ready'); setVersions(null);
      setMessage({ tone: 'ok', text: 'Saved for everyone.' });
    } else if (reply.trouble === 'conflict') {
      setIncoming({ revision: Number(reply.detail?.revision ?? 0), savedAt: String(reply.detail?.savedAt ?? '') });
    } else {
      if (reply.trouble === 'not_connected') setStatus('not_connected');
      setMessage({ tone: 'error', text: `Not saved for everyone: ${reply.message}` });
    }
  }, [setMeta]);

  const loadIncoming = useCallback(async () => {
    const reply = await loadShared();
    if (reply.ok) take(reply.data, 'Loaded the version saved for everyone. Your unsaved changes were replaced.');
    else setMessage({ tone: 'error', text: reply.message });
  }, [take]);

  const keepMine = useCallback(() => { latest.current.dismissed = incoming?.revision ?? 0; setIncoming(null); }, [incoming]);

  const showVersions = useCallback(async () => {
    if (versions) { setVersions(null); return; }
    const reply = await listVersions();
    if (reply.ok) setVersions(reply.data.versions); else setMessage({ tone: 'error', text: reply.message });
  }, [versions]);

  // An earlier version becomes this browser's copy only; it reaches everyone when Save is pressed.
  const restore = useCallback(async (revision: number) => {
    const reply = await loadVersion(revision);
    if (!reply.ok) { setMessage({ tone: 'error', text: reply.message }); return; }
    const parsed = parseState(JSON.stringify(reply.data.state));
    if ('error' in parsed) { setMessage({ tone: 'error', text: `That version could not be read (${parsed.error})` }); return; }
    adopt(parsed.state); setVersions(null);
    setMessage({ tone: 'ok', text: 'Loaded the earlier version into this browser. Press “Save for everyone” to make it the shared one.' });
  }, [adopt]);

  return { status, revision: meta.revision, savedAt: meta.savedAt, dirty, saving, incoming, message, versions,
    save: (force?: boolean) => { void save(force === true); }, loadIncoming: () => { void loadIncoming(); }, keepMine, showVersions: () => { void showVersions(); }, restore: (revision: number) => { void restore(revision); } };
}
