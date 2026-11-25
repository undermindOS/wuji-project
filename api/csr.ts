// Shared storage for the operators' schedule builder: one Vercel Function, one address, /api/csr?op=…
// The file is self-contained on purpose: no imports, so nothing depends on how functions are bundled.
// Access is by one team key, set by the project owner as CSR_ACCESS_KEY. Without that variable the
// storage is open: anyone who can reach the address can read and replace what is stored here.

declare const process: { env: Record<string, string | undefined> };

/** The few Redis commands used below, as one call. Upstash's REST API and the in-memory stand-in both fit it. */
export interface Kv { command(args: (string | number)[]): Promise<unknown> }

const STATE = 'csr:state', HISTORY = 'csr:history', LINKS = 'csr:wishlinks', WISHES = 'csr:wishes';
const MAX_BODY = 500_000, HISTORY_KEPT = 30, MAX_WISHES = 500, MAX_LINKS = 200, MAX_COMMENT = 1000;

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const fail = (status: number, code: string, message: string): Response => json(status, { error: code, message });
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isMonday = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value && date.getUTCDay() === 1;
};
const parse = (text: unknown): unknown => { try { return typeof text === 'string' ? JSON.parse(text) : null; } catch { return null; } };
const token = (bytes: number): string => [...crypto.getRandomValues(new Uint8Array(bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');

interface Stored { revision: number; savedAt: string; state: unknown }
interface WishLink { token: string; weekStart: string; operators: { id: string; nick: string }[]; createdAt: string }

async function body(request: Request): Promise<Record<string, unknown> | Response> {
  const text = await request.text();
  if (text.length > MAX_BODY) return fail(413, 'too_large', 'That is more than this storage accepts in one save.');
  const value = parse(text);
  return isObject(value) ? value : fail(400, 'bad_request', 'The request is not a JSON object.');
}

/** HGETALL comes back as a flat [field, value, field, value, …] list. */
const hashValues = (flat: unknown): unknown[] => Array.isArray(flat) ? flat.filter((_, index) => index % 2 === 1).map(parse).filter(isObject) : [];

/** What kind of storage settings the deployment can see. Yes or no only: never a name, never a value. */
export interface StorageSeen { restAddress: boolean; restToken: boolean; redisAddress: boolean }

/** What an operator does through a wish link needs no team key: the link's own long random code guards it. */
const OPEN = new Set(['GET wishlink', 'POST wish']);

/** Compares two secrets without stopping at the first difference, so timing says nothing about the key. */
async function sameSecret(given: string, expected: string): Promise<boolean> {
  const digest = async (text: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  const [a, b] = await Promise.all([digest(given), digest(expected)]);
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}

export function createApi(kv: Kv | null, seen?: StorageSeen, accessKey: string | null = null): { fetch(request: Request): Promise<Response> } {
  const current = async (store: Kv): Promise<Stored> => {
    const saved = parse(await store.command(['GET', STATE]));
    return isObject(saved) && typeof saved.revision === 'number' ? saved as unknown as Stored : { revision: 0, savedAt: '', state: null };
  };

  const routes: Record<string, (store: Kv, request: Request, url: URL) => Promise<Response>> = {
    async 'GET state'(store) { return json(200, await current(store)); },

    // Every save is kept: the newest replaces the shared state, and a copy goes onto the history list.
    async 'POST state'(store, request) {
      const input = await body(request);
      if (input instanceof Response) return input;
      if (!isObject(input.state) || input.state.version !== 1 || !Array.isArray(input.state.operators)) return fail(400, 'bad_state', 'This is not a schedule to save.');
      if (!Number.isInteger(input.baseRevision)) return fail(400, 'bad_request', 'The save does not say which version it was made from.');
      const before = await current(store);
      if (before.revision !== input.baseRevision && input.force !== true) return json(409, { error: 'conflict', message: 'Someone saved a newer version.', revision: before.revision, savedAt: before.savedAt });
      const next: Stored = { revision: before.revision + 1, savedAt: new Date().toISOString(), state: input.state };
      const text = JSON.stringify(next);
      await store.command(['SET', STATE, text]);
      await store.command(['LPUSH', HISTORY, text]);
      await store.command(['LTRIM', HISTORY, 0, HISTORY_KEPT - 1]);
      return json(200, { revision: next.revision, savedAt: next.savedAt });
    },

    async 'GET history'(store, _request, url) {
      const saved = await store.command(['LRANGE', HISTORY, 0, HISTORY_KEPT - 1]);
      const versions = (Array.isArray(saved) ? saved.map(parse).filter(isObject) : []) as unknown as Stored[];
      const wanted = url.searchParams.get('revision');
      if (wanted === null) return json(200, { versions: versions.map(({ revision, savedAt }) => ({ revision, savedAt })) });
      const found = versions.find(version => String(version.revision) === wanted);
      return found ? json(200, found) : fail(404, 'not_found', 'That version is no longer kept.');
    },

    // A wish link carries only what the form needs: the week and the operators' ids and nicknames.
    async 'POST wishlink'(store, request) {
      const input = await body(request);
      if (input instanceof Response) return input;
      if (!isMonday(input.weekStart)) return fail(400, 'bad_request', 'The week must start on a Monday.');
      const operators = Array.isArray(input.operators) ? input.operators.filter(isObject).map(item => ({ id: item.id, nick: item.nick }))
        .filter((item): item is { id: string; nick: string } => typeof item.id === 'string' && /^[a-z0-9-]{1,40}$/.test(item.id) && typeof item.nick === 'string' && !!item.nick.trim() && item.nick.length <= 40) : [];
      if (!operators.length || operators.length > 60) return fail(400, 'bad_request', 'The link needs between 1 and 60 operators.');
      if (Number(await store.command(['HLEN', LINKS])) >= MAX_LINKS) return fail(409, 'too_many', 'There are too many wish links already.');
      const link: WishLink = { token: token(16), weekStart: input.weekStart, operators, createdAt: new Date().toISOString() };
      await store.command(['HSET', LINKS, link.token, JSON.stringify(link)]);
      return json(200, { token: link.token });
    },

    async 'GET wishlink'(store, _request, url) {
      const link = parse(await store.command(['HGET', LINKS, url.searchParams.get('token') ?? '']));
      return isObject(link) ? json(200, { weekStart: link.weekStart, operators: link.operators }) : fail(404, 'not_found', 'This link does not exist or was removed.');
    },

    async 'POST wish'(store, request) {
      const input = await body(request);
      if (input instanceof Response) return input;
      const link = parse(await store.command(['HGET', LINKS, typeof input.token === 'string' ? input.token : ''])) as WishLink | null;
      if (!isObject(link)) return fail(404, 'not_found', 'This link does not exist or was removed.');
      const operator = link.operators.find(item => item.id === input.operatorId);
      if (!operator) return fail(400, 'bad_request', 'Choose who the wish is from.');
      const days = Array.isArray(input.days) && input.days.length === 7 && input.days.every(day => day === 'work' || day === 'off' || day === '') ? input.days as string[] : null;
      const shifts = Array.isArray(input.shifts) && input.shifts.length <= 8 && input.shifts.every(shift => typeof shift === 'string' && /^[a-z0-9]{1,12}$/.test(shift)) ? [...new Set(input.shifts as string[])] : null;
      const comment = typeof input.comment === 'string' ? input.comment.trim() : null;
      if (!days || !shifts || comment === null || comment.length > MAX_COMMENT) return fail(400, 'bad_request', 'The wish is not filled in the way the form sends it.');
      if (!days.some(Boolean) && !shifts.length && !comment) return fail(400, 'empty', 'Add a day, a shift or a comment first.');
      if (Number(await store.command(['HLEN', WISHES])) >= MAX_WISHES) return fail(409, 'too_many', 'The wish list is full. Ask the scheduler to clear old wishes.');
      const wish = { id: token(8), weekStart: link.weekStart, operatorId: operator.id, nick: operator.nick, days, shifts, comment, createdAt: new Date().toISOString() };
      await store.command(['HSET', WISHES, wish.id, JSON.stringify(wish)]);
      return json(200, { id: wish.id });
    },

    async 'GET wishes'(store) {
      const wishes = hashValues(await store.command(['HGETALL', WISHES])) as { createdAt?: string }[];
      return json(200, { wishes: wishes.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))) });
    },

    async 'POST wish-delete'(store, request) {
      const input = await body(request);
      if (input instanceof Response) return input;
      if (typeof input.id !== 'string') return fail(400, 'bad_request', 'Which wish to remove is missing.');
      await store.command(['HDEL', WISHES, input.id]);
      return json(200, { removed: input.id });
    },
  };

  return {
    async fetch(request) {
      const url = new URL(request.url);
      const op = url.searchParams.get('op') ?? '';
      if (request.method === 'GET' && op === 'health') return json(200, { ok: true, storage: kv !== null, locked: accessKey !== null, ...(seen ? { seen } : {}) });
      const route = routes[`${request.method} ${op}`];
      if (!route) return fail(404, 'not_found', 'Unknown request.');
      if (accessKey !== null && !OPEN.has(`${request.method} ${op}`)) {
        const given = request.headers.get('x-csr-key');
        if (!given) return fail(401, 'key_required', 'This needs the team key.');
        if (!await sameSecret(given, accessKey)) return fail(401, 'key_wrong', 'That is not the team key.');
      }
      if (!kv) return fail(503, 'storage_not_connected', 'Shared storage is not connected yet.');
      try { return await route(kv, request, url); }
      catch { return fail(502, 'storage_failed', 'Shared storage did not answer. Try again in a moment.'); }
    },
  };
}

/** Upstash Redis over its REST API: the command goes as a JSON array, the answer comes back as { result }. */
export function upstashKv(url: string, bearer: string, send: typeof fetch = fetch): Kv {
  return {
    async command(args) {
      const response = await send(url, { method: 'POST', headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' }, body: JSON.stringify(args) });
      const answer = await response.json() as { result?: unknown; error?: string };
      if (!response.ok || answer.error) throw new Error(answer.error ?? `Storage answered ${response.status}`);
      return answer.result ?? null;
    },
  };
}

/** Finds the storage address and token whatever prefix the Vercel integration gave the variables. */
export function kvFromEnv(env: Record<string, string | undefined>): Kv | null {
  for (const [name, url] of Object.entries(env)) {
    const match = /^(.*)(UPSTASH_REDIS_REST_|KV_REST_API_)URL$/.exec(name);
    const bearer = match ? env[`${match[1]}${match[2]}TOKEN`] : undefined;
    if (match && url && /^https:\/\//.test(url) && bearer) return upstashKv(url, bearer);
  }
  return null;
}

/** The team key, when the owner has set one. A blank variable counts as not set. */
export const accessKeyFromEnv = (env: Record<string, string | undefined>): string | null => env.CSR_ACCESS_KEY?.trim() || null;

/**
 * Says why storage is or is not found, without revealing anything: whether a REST address, a REST token
 * and a plain redis:// address are present. A deployment built before the database was connected sees
 * none of them; a database connected without its REST interface shows only the last one.
 */
export function storageSeen(env: Record<string, string | undefined>): StorageSeen {
  const some = (pattern: RegExp, value: RegExp) => Object.entries(env).some(([name, text]) => pattern.test(name) && !!text && value.test(text));
  return {
    restAddress: some(/(UPSTASH_REDIS_REST_|KV_REST_API_)URL$/, /^https:\/\//),
    restToken: some(/(UPSTASH_REDIS_REST_|KV_REST_API_)TOKEN$/, /./),
    redisAddress: some(/(^|_)(REDIS_URL|KV_URL)$/, /^rediss?:\/\//),
  };
}

/** The same commands kept in memory: used by the local dev server and by the tests, never on the site. */
export function memoryKv(): Kv {
  const strings = new Map<string, string>(), lists = new Map<string, string[]>(), hashes = new Map<string, Map<string, string>>();
  const hash = (key: string) => hashes.get(key) ?? hashes.set(key, new Map()).get(key)!;
  return {
    async command([name, key, ...rest]) {
      const id = String(key), values = rest.map(String);
      switch (String(name).toUpperCase()) {
        case 'GET': return strings.get(id) ?? null;
        case 'SET': strings.set(id, values[0]); return 'OK';
        case 'LPUSH': lists.set(id, [...values.reverse(), ...(lists.get(id) ?? [])]); return lists.get(id)!.length;
        case 'LTRIM': lists.set(id, (lists.get(id) ?? []).slice(Number(rest[0]), Number(rest[1]) + 1)); return 'OK';
        case 'LRANGE': return (lists.get(id) ?? []).slice(Number(rest[0]), Number(rest[1]) + 1);
        case 'HSET': hash(id).set(values[0], values[1]); return 1;
        case 'HGET': return hash(id).get(values[0]) ?? null;
        case 'HDEL': return hash(id).delete(values[0]) ? 1 : 0;
        case 'HLEN': return hash(id).size;
        case 'HGETALL': return [...hash(id)].flat();
        default: throw new Error(`Command ${String(name)} is not supported here.`);
      }
    },
  };
}

export default { fetch: (request: Request): Promise<Response> => createApi(kvFromEnv(process.env), storageSeen(process.env), accessKeyFromEnv(process.env)).fetch(request) };
