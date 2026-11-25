import type { Wish } from '../model/types.ts';

/** Why a call to shared storage did not give data. */
export type Trouble = 'not_connected' | 'unavailable' | 'conflict' | 'not_found' | 'rejected';
export type Reply<T> = { ok: true; data: T } | { ok: false; trouble: Trouble; message: string; detail?: Record<string, unknown> };

export interface SharedState { revision: number; savedAt: string; state: unknown }
export interface SavedVersion { revision: number; savedAt: string }
export interface WishForm { weekStart: string; operators: { id: string; nick: string }[] }

const ADDRESS = '/api/csr';

/** One request to shared storage. Every way it can fail comes back as a value, never as an exception. */
export async function call<T>(method: 'GET' | 'POST', op: string, body?: unknown, send: typeof fetch = fetch): Promise<Reply<T>> {
  let response: Response;
  try {
    response = await send(`${ADDRESS}?op=${op}`, { method, cache: 'no-store', headers: body === undefined ? undefined : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    return { ok: false, trouble: 'unavailable', message: 'Shared storage could not be reached. Check the connection.' };
  }
  // Where the storage function is not deployed, the site answers with a page instead of JSON.
  if (!(response.headers.get('content-type') ?? '').includes('application/json')) return { ok: false, trouble: 'not_connected', message: 'Shared storage is not connected yet.' };
  let data: Record<string, unknown>;
  try { data = await response.json() as Record<string, unknown>; } catch { return { ok: false, trouble: 'unavailable', message: 'Shared storage sent an answer that could not be read.' }; }
  if (response.ok) return { ok: true, data: data as T };
  const message = typeof data.message === 'string' ? data.message : 'Shared storage refused the request.';
  const trouble: Trouble = data.error === 'storage_not_connected' ? 'not_connected' : response.status === 409 && data.error === 'conflict' ? 'conflict' : response.status === 404 ? 'not_found' : response.status >= 500 ? 'unavailable' : 'rejected';
  return { ok: false, trouble, message, detail: data };
}

/** Whether the site has shared storage at all. Asked first, so a site without it is not sent requests that can only fail. */
export const checkStorage = () => call<{ ok: boolean; storage: boolean }>('GET', 'health');
export const loadShared = () => call<SharedState>('GET', 'state');
export const saveShared = (state: unknown, baseRevision: number, force = false) => call<SavedVersion>('POST', 'state', { state, baseRevision, force });
export const listVersions = () => call<{ versions: SavedVersion[] }>('GET', 'history');
export const loadVersion = (revision: number) => call<SharedState>('GET', `history&revision=${revision}`);
export const createWishLink = (weekStart: string, operators: { id: string; nick: string }[]) => call<{ token: string }>('POST', 'wishlink', { weekStart, operators });
export const loadWishForm = (token: string) => call<WishForm>('GET', `wishlink&token=${encodeURIComponent(token)}`);
export const sendWish = (wish: { token: string; operatorId: string; days: string[]; shifts: string[]; comment: string }) => call<{ id: string }>('POST', 'wish', wish);
export const listWishes = () => call<{ wishes: Wish[] }>('GET', 'wishes');
export const removeWish = (id: string) => call<{ removed: string }>('POST', 'wish-delete', { id });
