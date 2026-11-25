// Shared storage for the operators' schedule builder: one Vercel Function, one address, /api/csr?op=…
// The file is self-contained on purpose: no imports, so nothing depends on how functions are bundled.
// Without CSR_ACCESS_KEY the storage is open: anyone who can reach the address can read and replace what
// is stored here. With it, the shared copy answers only to signed-in accounts the owner has approved, and
// the variable itself is the owner key: an account that proves it has the key becomes an owner.

declare const process: { env: Record<string, string | undefined> };

/** The few Redis commands used below, as one call. Upstash's REST API and the in-memory stand-in both fit it. */
export interface Kv { command(args: (string | number)[]): Promise<unknown> }

const STATE = 'csr:state', HISTORY = 'csr:history', LINKS = 'csr:wishlinks', WISHES = 'csr:wishes';
const USERS = 'csr:users', SESSION = 'csr:session:', TRIES = 'csr:tries:', COOKIE = 'csr_session';
const MAX_BODY = 500_000, HISTORY_KEPT = 30, MAX_WISHES = 500, MAX_LINKS = 200, MAX_COMMENT = 1000;
const MAX_USERS = 200, MAX_WAITING = 40, MAX_PASSWORD = 200, SESSION_SECONDS = 30 * 86_400;
/** PBKDF2-HMAC-SHA256 rounds for a password. Kept with each account, so it can be raised later. */
export const PASSWORD_ROUNDS = 600_000;
const NICK = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{1,23}$/u;

const json = (status: number, body: unknown, extra: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra } });
const fail = (status: number, code: string, message: string): Response => json(status, { error: code, message });
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isMonday = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value && date.getUTCDay() === 1;
};
const parse = (text: unknown): unknown => { try { return typeof text === 'string' ? JSON.parse(text) : null; } catch { return null; } };
const hex = (bytes: Uint8Array): string => [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
const token = (bytes: number): string => hex(crypto.getRandomValues(new Uint8Array(bytes)));
const sha256 = async (text: string): Promise<string> => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))));

interface Stored { revision: number; savedAt: string; state: unknown; savedBy?: string }
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

/** owner: approves accounts. scheduler: reads and saves the shared copy. operator: sends wishes under their own name. */
type Role = 'owner' | 'scheduler' | 'operator';
/** An account as stored. The password itself is never kept: only its salted hash. */
interface User { nick: string; role: Role | null; status: 'pending' | 'active' | 'disabled'; operatorId: string | null; salt: string; hash: string; rounds: number; epoch: number; createdAt: string }

/**
 * Who may call what once the owner key is set; a request not listed needs an approved owner or scheduler.
 * 'anyone' needs no account (a wish link is guarded by its own long random code), 'signed' any account.
 */
const ACCESS: Record<string, 'anyone' | 'signed' | 'operator' | 'owner'> = {
  'GET wishlink': 'anyone', 'POST wish': 'anyone', 'GET me': 'anyone', 'POST signup': 'anyone', 'POST login': 'anyone', 'POST logout': 'anyone',
  'POST password': 'signed', 'POST owner': 'signed', 'POST my-wish': 'operator', 'GET accounts': 'owner', 'POST account': 'owner',
};
const BY_LINK = new Set(['GET wishlink', 'POST wish']);

const userKey = (nick: string): string => nick.trim().toLowerCase();
const goodPassword = (value: unknown): value is string => typeof value === 'string' && value.length >= 8 && value.length <= MAX_PASSWORD;
const view = (user: User) => ({ nick: user.nick, role: user.role, status: user.status, operatorId: user.operatorId, createdAt: user.createdAt });
/** The address a request came from, as the hosting platform reports it. Used only to count tries. */
const who = (request: Request): string => request.headers.get('x-real-ip') ?? request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'local';

async function passwordHash(password: string, salt: string, rounds: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  return hex(new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: rounds }, key, 256)));
}

/** The session cookie: not readable by scripts on the page, and not sent along with requests that start on another site. */
const cookie = (request: Request, value: string, seconds: number): string =>
  `${COOKIE}=${value}; Path=/api/csr; Max-Age=${seconds}; HttpOnly; SameSite=Strict${/^(localhost|127\.0\.0\.1|\[::1\])$/.test(new URL(request.url).hostname) ? '' : '; Secure'}`;

function sessionSecret(request: Request): string | null {
  const found = /(?:^|;\s*)csr_session=([0-9a-f]{64})(?:;|$)/.exec(request.headers.get('cookie') ?? '');
  if (!found) return null;
  // On a write the cookie counts only when the page itself sent it: JSON, and not from another site.
  if (request.method !== 'GET' && (!(request.headers.get('content-type') ?? '').includes('application/json') || request.headers.get('sec-fetch-site') === 'cross-site')) return null;
  return found[1];
}

/** Compares two secrets without stopping at the first difference, so timing says nothing about the key. */
async function sameSecret(given: string, expected: string): Promise<boolean> {
  const digest = async (text: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  const [a, b] = await Promise.all([digest(given), digest(expected)]);
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}

export function createApi(kv: Kv | null, seen?: StorageSeen, accessKey: string | null = null, rounds = PASSWORD_ROUNDS): { fetch(request: Request): Promise<Response> } {
  const current = async (store: Kv): Promise<Stored> => {
    const saved = parse(await store.command(['GET', STATE]));
    return isObject(saved) && typeof saved.revision === 'number' ? saved as unknown as Stored : { revision: 0, savedAt: '', state: null };
  };

  const getUser = async (store: Kv, nick: string): Promise<User | null> => {
    const user = parse(await store.command(['HGET', USERS, userKey(nick)]));
    return isObject(user) ? user as unknown as User : null;
  };
  const putUser = async (store: Kv, user: User): Promise<void> => { await store.command(['HSET', USERS, userKey(user.nick), JSON.stringify(user)]); };
  const allUsers = async (store: Kv): Promise<User[]> => hashValues(await store.command(['HGETALL', USERS])) as unknown as User[];

  /** The nickname in the shared copy's team that an operator account is tied to; null once that person is gone. */
  const operatorNick = async (store: Kv, id: string | null): Promise<string | null> => {
    const saved = (await current(store)).state;
    const found = (isObject(saved) && Array.isArray(saved.operators) ? saved.operators : []).find(item => isObject(item) && item.id === id);
    return id !== null && isObject(found) && typeof found.nick === 'string' ? found.nick : null;
  };
  const describe = async (store: Kv, user: User) => ({ ...view(user), ...(user.role === 'operator' ? { operatorNick: await operatorNick(store, user.operatorId) } : {}) });

  /** A new session. Only a hash of its secret is stored, so the storage alone does not let anyone in. */
  const openSession = async (store: Kv, user: User, request: Request): Promise<Record<string, string>> => {
    const secret = token(32);
    await store.command(['SET', SESSION + await sha256(secret), JSON.stringify({ nick: userKey(user.nick), epoch: user.epoch }), 'EX', SESSION_SECONDS]);
    return { 'set-cookie': cookie(request, secret, SESSION_SECONDS) };
  };
  /** The account behind a request. A session dies when its account is switched off, removed or given a new password. */
  const signedIn = async (store: Kv, request: Request): Promise<User | null> => {
    const secret = sessionSecret(request);
    const session = secret ? parse(await store.command(['GET', SESSION + await sha256(secret)])) : null;
    if (!isObject(session) || typeof session.nick !== 'string') return null;
    const user = await getUser(store, session.nick);
    return user && user.epoch === session.epoch && user.status !== 'disabled' ? user : null;
  };
  /** Counts one more try under `name`; true once there were more than `max` within `seconds`. */
  const tooMany = async (store: Kv, name: string, max: number, seconds: number): Promise<boolean> => {
    const count = Number(await store.command(['INCR', TRIES + name]));
    if (count === 1) await store.command(['EXPIRE', TRIES + name, seconds]);
    return count > max;
  };
  const slowDown = () => fail(429, 'too_many_tries', 'Too many tries. Wait fifteen minutes and try again.');

  const addWish = async (store: Kv, input: Record<string, unknown>, from: { weekStart: string; operatorId: string; nick: string; account?: string }): Promise<Response> => {
    const days = Array.isArray(input.days) && input.days.length === 7 && input.days.every(day => day === 'work' || day === 'off' || day === '') ? input.days as string[] : null;
    const shifts = Array.isArray(input.shifts) && input.shifts.length <= 8 && input.shifts.every(shift => typeof shift === 'string' && /^[a-z0-9]{1,12}$/.test(shift)) ? [...new Set(input.shifts as string[])] : null;
    const comment = typeof input.comment === 'string' ? input.comment.trim() : null;
    if (!days || !shifts || comment === null || comment.length > MAX_COMMENT) return fail(400, 'bad_request', 'The wish is not filled in the way the form sends it.');
    if (!days.some(Boolean) && !shifts.length && !comment) return fail(400, 'empty', 'Add a day, a shift or a comment first.');
    if (Number(await store.command(['HLEN', WISHES])) >= MAX_WISHES) return fail(409, 'too_many', 'The wish list is full. Ask the scheduler to clear old wishes.');
    const wish = { id: token(8), ...from, days, shifts, comment, createdAt: new Date().toISOString() };
    await store.command(['HSET', WISHES, wish.id, JSON.stringify(wish)]);
    return json(200, { id: wish.id });
  };

  // `user` is the signed-in account; it is null wherever accounts are off or the request needs none.
  const routes: Record<string, (store: Kv, request: Request, url: URL, user: User | null) => Promise<Response>> = {
    async 'GET me'(store, _request, _url, user) { return json(200, { accounts: true, account: user ? await describe(store, user) : null }); },

    // A new account can sign in at once, but opens nothing until an owner approves it.
    async 'POST signup'(store, request) {
      const input = await body(request);
      if (input instanceof Response) return input;
      const nick = typeof input.nick === 'string' ? input.nick.trim().replace(/\s+/g, ' ') : '';
      if (!NICK.test(nick)) return fail(400, 'bad_nick', 'A nickname is 2 to 24 letters, digits, spaces, dots, dashes or underscores, and starts with a letter or a digit.');
      if (!goodPassword(input.password)) return fail(400, 'bad_password', `A password is 8 to ${MAX_PASSWORD} characters.`);
      if (await tooMany(store, `signup:${who(request)}`, 10, 3600)) return fail(429, 'too_many_tries', 'Too many new accounts from this address. Try again in an hour.');
      const all = await allUsers(store);
      if (all.length >= MAX_USERS || all.filter(item => item.status === 'pending').length >= MAX_WAITING) return fail(409, 'too_many', 'Too many accounts are waiting for approval. Ask the owner to look at them.');
      const salt = token(16);
      const user: User = { nick, role: null, status: 'pending', operatorId: null, salt, hash: await passwordHash(input.password, salt, rounds), rounds, epoch: 1, createdAt: new Date().toISOString() };
      if (Number(await store.command(['HSETNX', USERS, userKey(nick), JSON.stringify(user)])) !== 1) return fail(409, 'nick_taken', 'That nickname is taken. Choose another, or sign in.');
      return json(200, { account: view(user) }, await openSession(store, user, request));
    },

    async 'POST login'(store, request) {
      const input = await body(request);
      if (input instanceof Response) return input;
      const nick = typeof input.nick === 'string' ? userKey(input.nick) : '', password = typeof input.password === 'string' ? input.password : '';
      if (!nick || nick.length > 24 || !password || password.length > MAX_PASSWORD) return fail(400, 'bad_request', 'Enter the nickname and the password.');
      if (await tooMany(store, `login:from:${who(request)}`, 30, 900) || await tooMany(store, `login:nick:${nick}`, 10, 900)) return slowDown();
      const user = await getUser(store, nick);
      // The same work is done for a nickname nobody has, so the time the answer takes says nothing about who has an account.
      const hash = await passwordHash(password, user?.salt ?? 'nobody', user?.rounds ?? rounds);
      if (!user || !await sameSecret(hash, user.hash)) return fail(401, 'wrong_login', 'That nickname and password do not match.');
      if (user.status === 'disabled') return fail(403, 'disabled', 'This account was switched off. Ask the owner.');
      return json(200, { account: await describe(store, user) }, await openSession(store, user, request));
    },

    async 'POST logout'(store, request) {
      const secret = sessionSecret(request);
      if (secret) await store.command(['DEL', SESSION + await sha256(secret)]);
      return json(200, { account: null }, { 'set-cookie': cookie(request, '', 0) });
    },

    // A new password signs the account out everywhere else.
    async 'POST password'(store, request, _url, user) {
      const input = await body(request);
      if (input instanceof Response || !user) return input instanceof Response ? input : fail(401, 'sign_in', 'Sign in first.');
      if (await tooMany(store, `password:${userKey(user.nick)}`, 10, 900)) return slowDown();
      if (typeof input.current !== 'string' || input.current.length > MAX_PASSWORD || !await sameSecret(await passwordHash(input.current, user.salt, user.rounds), user.hash)) return fail(400, 'wrong_password', 'The current password is not right.');
      if (!goodPassword(input.next)) return fail(400, 'bad_password', `A password is 8 to ${MAX_PASSWORD} characters.`);
      const salt = token(16);
      const next: User = { ...user, salt, hash: await passwordHash(input.next, salt, rounds), rounds, epoch: user.epoch + 1 };
      await putUser(store, next);
      return json(200, { account: await describe(store, next) }, await openSession(store, next, request));
    },

    // The owner key is the variable the project owner set; whoever has it may approve everyone else.
    async 'POST owner'(store, request, _url, user) {
      const input = await body(request);
      if (input instanceof Response || !user) return input instanceof Response ? input : fail(401, 'sign_in', 'Sign in first.');
      if (await tooMany(store, `owner:${who(request)}`, 10, 900)) return slowDown();
      if (typeof input.key !== 'string' || accessKey === null || !await sameSecret(input.key, accessKey)) return fail(403, 'key_wrong', 'That is not the owner key.');
      const next: User = { ...user, role: 'owner', status: 'active', operatorId: null };
      await putUser(store, next);
      return json(200, { account: view(next) });
    },

    async 'GET accounts'(store) {
      return json(200, { accounts: (await allUsers(store)).map(view).sort((a, b) => a.createdAt.localeCompare(b.createdAt)) });
    },

    async 'POST account'(store, request, _url, user) {
      const input = await body(request);
      if (input instanceof Response) return input;
      const target = typeof input.nick === 'string' ? await getUser(store, input.nick) : null;
      if (!target) return fail(404, 'not_found', 'There is no such account.');
      if (user && userKey(target.nick) === userKey(user.nick)) return fail(400, 'own_account', 'An owner cannot change their own account here.');
      if (input.action === 'approve') {
        if (input.role !== 'scheduler' && input.role !== 'operator') return fail(400, 'bad_request', 'Choose what the account is for.');
        const operatorId = input.role === 'operator' && typeof input.operatorId === 'string' ? input.operatorId : null;
        if (input.role === 'operator' && !await operatorNick(store, operatorId)) return fail(400, 'not_in_team', 'That person is not in the team saved for everyone. Press “Save for everyone” first, then let the account in.');
        await putUser(store, { ...target, role: input.role, status: 'active', operatorId });
      } else if (input.action === 'disable') {
        await putUser(store, { ...target, status: 'disabled', epoch: target.epoch + 1 });
      } else if (input.action === 'enable') {
        await putUser(store, { ...target, status: target.role ? 'active' : 'pending' });
      } else if (input.action === 'remove') {
        await store.command(['HDEL', USERS, userKey(target.nick)]);
      } else if (input.action === 'reset') {
        // A one-time password for the owner to pass on. It is shown once and not kept.
        const password = [token(2), token(2), token(2), token(2)].join('-'), salt = token(16);
        await putUser(store, { ...target, salt, hash: await passwordHash(password, salt, rounds), rounds, epoch: target.epoch + 1 });
        return json(200, { nick: target.nick, password });
      } else return fail(400, 'bad_request', 'Unknown change.');
      return json(200, { nick: target.nick });
    },

    async 'GET state'(store) { return json(200, await current(store)); },

    // Every save is kept: the newest replaces the shared state, and a copy goes onto the history list.
    async 'POST state'(store, request, _url, user) {
      const input = await body(request);
      if (input instanceof Response) return input;
      if (!isObject(input.state) || input.state.version !== 1 || !Array.isArray(input.state.operators)) return fail(400, 'bad_state', 'This is not a schedule to save.');
      if (!Number.isInteger(input.baseRevision)) return fail(400, 'bad_request', 'The save does not say which version it was made from.');
      const before = await current(store);
      if (before.revision !== input.baseRevision && input.force !== true) return json(409, { error: 'conflict', message: 'Someone saved a newer version.', revision: before.revision, savedAt: before.savedAt });
      const next: Stored = { revision: before.revision + 1, savedAt: new Date().toISOString(), state: input.state, ...(user ? { savedBy: user.nick } : {}) };
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
      if (wanted === null) return json(200, { versions: versions.map(({ revision, savedAt, savedBy }) => ({ revision, savedAt, ...(savedBy ? { savedBy } : {}) })) });
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
      return addWish(store, input, { weekStart: link.weekStart, operatorId: operator.id, nick: operator.nick });
    },

    // A wish from a signed-in operator: who it is from comes from the account, not from the form.
    async 'POST my-wish'(store, request, _url, user) {
      const input = await body(request);
      if (input instanceof Response) return input;
      if (!isMonday(input.weekStart)) return fail(400, 'bad_request', 'The week must start on a Monday.');
      const nick = user ? await operatorNick(store, user.operatorId) : null;
      if (!user || !user.operatorId || !nick) return fail(409, 'not_in_team', 'This account is no longer tied to anyone in the team. Ask the scheduler.');
      return addWish(store, input, { weekStart: input.weekStart, operatorId: user.operatorId, nick, account: user.nick });
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
      const name = `${request.method} ${op}`, route = routes[name];
      if (!route) return fail(404, 'not_found', 'Unknown request.');
      // Accounts exist only where the owner key is set, and need storage to live in.
      if (name === 'GET me' && (accessKey === null || !kv)) return json(200, { accounts: accessKey !== null && kv !== null, account: null });
      if (accessKey === null && name in ACCESS && !BY_LINK.has(name)) return fail(404, 'accounts_off', 'Accounts are not switched on here.');
      if (!kv) return fail(503, 'storage_not_connected', 'Shared storage is not connected yet.');
      try {
        const needs = ACCESS[name] ?? 'team';
        const user = accessKey !== null && !BY_LINK.has(name) ? await signedIn(kv, request) : null;
        if (accessKey !== null && needs !== 'anyone') {
          if (!user) return fail(401, 'sign_in', 'Sign in first.');
          if (needs !== 'signed') {
            if (user.status !== 'active') return fail(403, 'waiting', 'This account is waiting for the owner’s approval.');
            const allowed = needs === 'owner' ? user.role === 'owner' : needs === 'operator' ? user.role === 'operator' : user.role === 'owner' || user.role === 'scheduler';
            if (!allowed) return fail(403, 'not_allowed', 'This account is not allowed to do that.');
          }
        }
        return await route(kv, request, url, user);
      } catch { return fail(502, 'storage_failed', 'Shared storage did not answer. Try again in a moment.'); }
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

/** The owner key, when the owner has set one. A blank variable counts as not set. */
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
  const strings = new Map<string, string>(), lists = new Map<string, string[]>(), hashes = new Map<string, Map<string, string>>(), expires = new Map<string, number>();
  const hash = (key: string) => hashes.get(key) ?? hashes.set(key, new Map()).get(key)!;
  return {
    async command([name, key, ...rest]) {
      const id = String(key), values = rest.map(String);
      if ((expires.get(id) ?? Infinity) <= Date.now()) { strings.delete(id); expires.delete(id); }
      switch (String(name).toUpperCase()) {
        case 'GET': return strings.get(id) ?? null;
        case 'SET': strings.set(id, values[0]); if (values[1] === 'EX') expires.set(id, Date.now() + Number(values[2]) * 1000); else expires.delete(id); return 'OK';
        case 'DEL': expires.delete(id); return strings.delete(id) ? 1 : 0;
        case 'INCR': strings.set(id, String(Number(strings.get(id) ?? 0) + 1)); return Number(strings.get(id));
        case 'EXPIRE': expires.set(id, Date.now() + Number(rest[0]) * 1000); return 1;
        case 'HSETNX': if (hash(id).has(values[0])) return 0; hash(id).set(values[0], values[1]); return 1;
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
