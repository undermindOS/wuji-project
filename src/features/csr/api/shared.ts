import type { Wish } from '../model/types.ts';

/** Why a call to shared storage did not give data. 'locked': nobody is signed in, or the account may not do this. */
export type Trouble = 'not_connected' | 'unavailable' | 'conflict' | 'not_found' | 'locked' | 'rejected';
export type Reply<T> = { ok: true; data: T } | { ok: false; trouble: Trouble; message: string; detail?: Record<string, unknown> };

export interface SharedState { revision: number; savedAt: string; state: unknown }
export interface SavedVersion { revision: number; savedAt: string; /** Who saved it; missing for saves made before accounts. */ savedBy?: string }
export interface WishForm { weekStart: string; operators: { id: string; nick: string }[] }
export type Role = 'owner' | 'scheduler' | 'operator';
/** An account as the site describes it. `operatorNick`: who in the saved team an operator account speaks for. */
export interface Account { nick: string; role: Role | null; status: 'pending' | 'active' | 'disabled'; operatorId: string | null; createdAt: string; operatorNick?: string | null }
export type AccountChange = { action: 'approve'; role: 'scheduler' } | { action: 'approve'; role: 'operator'; operatorId: string } | { action: 'disable' | 'enable' | 'remove' | 'reset' };

const ADDRESS = '/api/csr';

/** Before accounts, a browser kept the team key in the open. That key is now the owner key, so it is taken out. */
export function dropOldTeamKey(): void {
  try { window.localStorage.removeItem('wuji.csr.key.v1'); } catch { /* nothing was kept, then */ }
}

/**
 * One request to shared storage. Every way it can fail comes back as a value, never as an exception.
 * Who is asking is told by the session cookie, which the browser sends by itself and the page cannot read.
 */
export async function call<T>(method: 'GET' | 'POST', op: string, body?: unknown, send: typeof fetch = fetch): Promise<Reply<T>> {
  let response: Response;
  try {
    response = await send(`${ADDRESS}?op=${op}`, { method, cache: 'no-store', credentials: 'same-origin', headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    return { ok: false, trouble: 'unavailable', message: 'Shared storage could not be reached. Check the connection.' };
  }
  // Where the storage function is not deployed, the site answers with a page instead of JSON.
  if (!(response.headers.get('content-type') ?? '').includes('application/json')) return { ok: false, trouble: 'not_connected', message: 'Shared storage is not connected yet.' };
  let data: Record<string, unknown>;
  try { data = await response.json() as Record<string, unknown>; } catch { return { ok: false, trouble: 'unavailable', message: 'Shared storage sent an answer that could not be read.' }; }
  if (response.ok) return { ok: true, data: data as T };
  const message = typeof data.message === 'string' ? data.message : 'Shared storage refused the request.';
  const trouble: Trouble = data.error === 'storage_not_connected' ? 'not_connected' : response.status === 401 || response.status === 403 ? 'locked' : response.status === 409 && data.error === 'conflict' ? 'conflict' : response.status === 404 ? 'not_found' : response.status >= 500 ? 'unavailable' : 'rejected';
  return { ok: false, trouble, message, detail: data };
}

/** Whether the site has shared storage at all. Asked first, so a site without it is not sent requests that can only fail. */
export const checkStorage = () => call<{ ok: boolean; storage: boolean; locked?: boolean }>('GET', 'health');
export const loadShared = () => call<SharedState>('GET', 'state');
export const saveShared = (state: unknown, baseRevision: number, force = false) => call<SavedVersion>('POST', 'state', { state, baseRevision, force });
export const listVersions = () => call<{ versions: SavedVersion[] }>('GET', 'history');
export const loadVersion = (revision: number) => call<SharedState>('GET', `history&revision=${revision}`);
export const createWishLink = (weekStart: string, operators: { id: string; nick: string }[]) => call<{ token: string }>('POST', 'wishlink', { weekStart, operators });
export const loadWishForm = (token: string) => call<WishForm>('GET', `wishlink&token=${encodeURIComponent(token)}`);
export const sendWish = (wish: { token: string; operatorId: string; days: string[]; shifts: string[]; comment: string }) => call<{ id: string }>('POST', 'wish', wish);
export const listWishes = () => call<{ wishes: Wish[] }>('GET', 'wishes');
export const removeWish = (id: string) => call<{ removed: string }>('POST', 'wish-delete', { id });

/** Who is signed in here, and whether the site has accounts at all. */
export const loadMe = () => call<{ accounts: boolean; account: Account | null }>('GET', 'me');
export const signUp = (nick: string, password: string) => call<{ account: Account }>('POST', 'signup', { nick, password });
export const signIn = (nick: string, password: string) => call<{ account: Account }>('POST', 'login', { nick, password });
export const signOut = () => call<{ account: null }>('POST', 'logout', {});
export const changePassword = (current: string, next: string) => call<{ account: Account }>('POST', 'password', { current, next });
export const claimOwner = (key: string) => call<{ account: Account }>('POST', 'owner', { key });
export const listAccounts = () => call<{ accounts: Account[] }>('GET', 'accounts');
/** `password` comes back only for a reset: a one-time password for the owner to pass on. */
export const changeAccount = (nick: string, change: AccountChange) => call<{ nick: string; password?: string }>('POST', 'account', { nick, ...change });
export const sendMyWish = (wish: { weekStart: string; days: string[]; shifts: string[]; comment: string }) => call<{ id: string }>('POST', 'my-wish', wish);
