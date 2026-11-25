import assert from 'node:assert/strict';
import test from 'node:test';
import handler, { accessKeyFromEnv, createApi, kvFromEnv, memoryKv, storageSeen, upstashKv } from '../api/csr.ts';
import { call as clientCall } from '../src/features/csr/api/shared.ts';

const api = () => createApi(memoryKv());
const call = async (target: { fetch(request: Request): Promise<Response> }, method: string, op: string, body?: unknown) => {
  const response = await target.fetch(new Request(`https://example.test/api/csr?op=${op}`, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'content-type': 'application/json' } }));
  return { status: response.status, data: await response.json() as any, cache: response.headers.get('cache-control') };
};
const state = (operators = [{ id: 'sam', nick: 'Sam' }]) => ({ version: 1, operators, weekStart: '2026-11-23', weeks: {} });

test('without storage the address answers, says so, and stores nothing', async () => {
  const offline = createApi(null);
  assert.deepEqual((await call(offline, 'GET', 'health')).data, { ok: true, storage: false, locked: false });
  const read = await call(offline, 'GET', 'state');
  assert.deepEqual([read.status, read.data.error], [503, 'storage_not_connected']);
  assert.equal((await call(offline, 'POST', 'state', { state: state(), baseRevision: 0 })).status, 503);
  assert.equal((await call(offline, 'GET', 'nope')).status, 404);
  // No variables on this machine, so the deployed entry point reports the same.
  assert.equal(kvFromEnv({}), null);
  assert.deepEqual(await (await handler.fetch(new Request('https://example.test/api/csr?op=health'))).json(), { ok: true, storage: kvFromEnv(process.env) !== null, locked: accessKeyFromEnv(process.env) !== null, seen: storageSeen(process.env) });
});

test('a save replaces the shared state, keeps every version, and refuses to overwrite a newer one silently', async () => {
  const shared = api();
  assert.deepEqual((await call(shared, 'GET', 'state')).data, { revision: 0, savedAt: '', state: null });
  const first = await call(shared, 'POST', 'state', { state: state(), baseRevision: 0 });
  assert.deepEqual([first.status, first.data.revision, first.cache], [200, 1, 'no-store']);
  // A second browser that still holds revision 0 is told about the newer save instead of erasing it.
  const stale = await call(shared, 'POST', 'state', { state: state([{ id: 'may', nick: 'May' }]), baseRevision: 0 });
  assert.deepEqual([stale.status, stale.data.error, stale.data.revision], [409, 'conflict', 1]);
  assert.equal((await call(shared, 'GET', 'state')).data.state.operators[0].nick, 'Sam');
  const forced = await call(shared, 'POST', 'state', { state: state([{ id: 'may', nick: 'May' }]), baseRevision: 0, force: true });
  assert.deepEqual([forced.status, forced.data.revision], [200, 2]);
  assert.equal((await call(shared, 'GET', 'state')).data.state.operators[0].nick, 'May');
  const history = await call(shared, 'GET', 'history');
  assert.deepEqual(history.data.versions.map((version: any) => version.revision), [2, 1]);
  assert.equal((await call(shared, 'GET', 'history&revision=1')).data.state.operators[0].nick, 'Sam');
  assert.equal((await call(shared, 'GET', 'history&revision=9')).status, 404);
  assert.equal((await call(shared, 'POST', 'state', { state: { version: 2 }, baseRevision: 2 })).data.error, 'bad_state');
  assert.equal((await call(shared, 'POST', 'state', { state: state() })).data.error, 'bad_request');
  const huge = await shared.fetch(new Request('https://example.test/api/csr?op=state', { method: 'POST', body: 'x'.repeat(500_001) }));
  assert.equal(huge.status, 413);
});

test('only the last thirty saves are kept', async () => {
  const shared = api();
  for (let revision = 0; revision < 33; revision += 1) await call(shared, 'POST', 'state', { state: state(), baseRevision: revision });
  const versions = (await call(shared, 'GET', 'history')).data.versions;
  assert.deepEqual([versions.length, versions[0].revision, versions[29].revision], [30, 33, 4]);
});

test('a wish needs a live link, a listed operator and something to say', async () => {
  const shared = api();
  const operators = [{ id: 'sam', nick: 'Sam' }, { id: 'may', nick: 'May', timeZone: 'EET', lines: { nonvoice: 'weak' } }];
  const made = await call(shared, 'POST', 'wishlink', { weekStart: '2026-11-30', operators });
  assert.match(made.data.token, /^[0-9a-f]{32}$/);
  // The form gets the week and the nicknames, and nothing else that was sent along.
  assert.deepEqual((await call(shared, 'GET', `wishlink&token=${made.data.token}`)).data, { weekStart: '2026-11-30', operators: [{ id: 'sam', nick: 'Sam' }, { id: 'may', nick: 'May' }] });
  assert.equal((await call(shared, 'GET', 'wishlink&token=missing')).status, 404);
  assert.equal((await call(shared, 'POST', 'wishlink', { weekStart: '2026-12-01', operators })).data.error, 'bad_request');
  assert.equal((await call(shared, 'POST', 'wishlink', { weekStart: '2026-11-30', operators: [] })).data.error, 'bad_request');

  const days = ['', '', 'off', '', 'work', '', ''];
  const wish = { token: made.data.token, operatorId: 'may', days, shifts: ['l1130', 'l1130'], comment: '  Dentist on Wednesday <b>morning</b>  ' };
  const sent = await call(shared, 'POST', 'wish', wish);
  assert.equal(sent.status, 200);
  const listed = (await call(shared, 'GET', 'wishes')).data.wishes;
  assert.equal(listed.length, 1);
  assert.deepEqual({ ...listed[0], id: 'x', createdAt: 'x' }, { id: 'x', weekStart: '2026-11-30', operatorId: 'may', nick: 'May', days, shifts: ['l1130'], comment: 'Dentist on Wednesday <b>morning</b>', createdAt: 'x' });
  assert.equal((await call(shared, 'POST', 'wish', { ...wish, token: 'gone' })).status, 404);
  assert.equal((await call(shared, 'POST', 'wish', { ...wish, operatorId: 'kate' })).data.error, 'bad_request');
  assert.equal((await call(shared, 'POST', 'wish', { ...wish, days: ['off'] })).data.error, 'bad_request');
  assert.equal((await call(shared, 'POST', 'wish', { ...wish, comment: 'x'.repeat(1001) })).data.error, 'bad_request');
  assert.equal((await call(shared, 'POST', 'wish', { ...wish, days: ['', '', '', '', '', '', ''], shifts: [], comment: ' ' })).data.error, 'empty');
  await call(shared, 'POST', 'wish', { ...wish, operatorId: 'sam', comment: 'Second' });
  assert.equal((await call(shared, 'GET', 'wishes')).data.wishes.length, 2);
  assert.equal((await call(shared, 'POST', 'wish-delete', { id: sent.data.id })).status, 200);
  assert.deepEqual((await call(shared, 'GET', 'wishes')).data.wishes.map((item: any) => item.comment), ['Second']);
});

test('the storage adapter speaks the Upstash REST protocol and finds its variables under any prefix', async () => {
  const seen: { url: string; auth: string | null; body: unknown }[] = [];
  const kv = upstashKv('https://db.example.test', 'secret-token', (async (url: any, init: any) => {
    seen.push({ url: String(url), auth: new Headers(init.headers).get('authorization'), body: JSON.parse(init.body) });
    return new Response(JSON.stringify(seen.length === 2 ? { error: 'ERR wrong number of arguments' } : { result: 'OK' }), { status: seen.length === 2 ? 400 : 200 });
  }) as typeof fetch);
  assert.equal(await kv.command(['SET', 'csr:state', '{"a":1}']), 'OK');
  assert.deepEqual(seen[0], { url: 'https://db.example.test', auth: 'Bearer secret-token', body: ['SET', 'csr:state', '{"a":1}'] });
  await assert.rejects(kv.command(['GET']), /wrong number of arguments/);
  // A failing store becomes a plain 502 for the page, without the storage error text.
  const broken = await call(createApi({ command: async () => { throw new Error('secret detail'); } }), 'GET', 'state');
  assert.deepEqual([broken.status, broken.data.error, JSON.stringify(broken.data).includes('secret')], [502, 'storage_failed', false]);
  assert.ok(kvFromEnv({ UPSTASH_REDIS_REST_URL: 'https://a.example.test', UPSTASH_REDIS_REST_TOKEN: 't' }));
  assert.ok(kvFromEnv({ KV_REST_API_URL: 'https://a.example.test', KV_REST_API_TOKEN: 't', KV_REST_API_READ_ONLY_TOKEN: 'r' }));
  assert.ok(kvFromEnv({ CSR_KV_REST_API_URL: 'https://a.example.test', CSR_KV_REST_API_TOKEN: 't' }));
  assert.equal(kvFromEnv({ KV_REST_API_URL: 'https://a.example.test' }), null);
  assert.equal(kvFromEnv({ KV_REST_API_URL: 'redis://a.example.test', KV_REST_API_TOKEN: 't' }), null);
});

test('the health answer says which storage settings are missing, and never what they are', async () => {
  // A deployment built before the database was connected sees nothing.
  assert.deepEqual(storageSeen({ NODE_ENV: 'production' }), { restAddress: false, restToken: false, redisAddress: false });
  // Connected the usual way: everything is there, under any prefix.
  const full = { STORAGE_KV_REST_API_URL: 'https://db.example.test', STORAGE_KV_REST_API_TOKEN: 'secret-token', STORAGE_KV_REST_API_READ_ONLY_TOKEN: 'read', STORAGE_KV_URL: 'rediss://default:secret@db.example.test:6379', STORAGE_REDIS_URL: 'rediss://default:secret@db.example.test:6379' };
  assert.deepEqual(storageSeen(full), { restAddress: true, restToken: true, redisAddress: true });
  assert.ok(kvFromEnv(full));
  // A database connected without its REST interface cannot be used by this function, and the answer shows why.
  const plain = { REDIS_URL: 'redis://default:secret@db.example.test:6379' };
  assert.deepEqual(storageSeen(plain), { restAddress: false, restToken: false, redisAddress: true });
  assert.equal(kvFromEnv(plain), null);
  assert.deepEqual(storageSeen({ UPSTASH_REDIS_REST_URL: 'https://db.example.test' }), { restAddress: true, restToken: false, redisAddress: false });
  const answer = await createApi(null, storageSeen(full)).fetch(new Request('https://example.test/api/csr?op=health'));
  const text = await answer.text();
  assert.deepEqual(JSON.parse(text), { ok: true, storage: false, locked: false, seen: { restAddress: true, restToken: true, redisAddress: true } });
  assert.doesNotMatch(text, /secret|example\.test|STORAGE|KV_|REDIS/);
});

// What a browser does for the page: it keeps the session cookie and sends it back with every request.
function browser(target: { fetch(request: Request): Promise<Response> }) {
  let cookie = '';
  const ask = async (method: string, op: string, body?: unknown, headers: Record<string, string> = {}) => {
    const response = await target.fetch(new Request(`https://example.test/api/csr?op=${op}`, { method, headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(cookie ? { cookie } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }));
    const set = response.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await response.text();
    return { status: response.status, data: JSON.parse(text), text, set };
  };
  return { ask, cookie: () => cookie, forget: () => { cookie = ''; } };
}

const KEY = 'unit-test owner key 7f3a';
// Few rounds here only: the tests check the rules around a password, not how slow the hash is.
const withAccounts = () => { const kv = memoryKv(); return { kv, site: createApi(kv, undefined, KEY, 1000) }; };
const teamRequests = [['GET', 'state'], ['POST', 'state', { state: state(), baseRevision: 0 }], ['GET', 'history'], ['GET', 'wishes'], ['POST', 'wishlink', { weekStart: '2026-11-30', operators: [{ id: 'sam', nick: 'Sam' }] }], ['POST', 'wish-delete', { id: 'x' }]] as const;

test('with the owner key set, the shared copy answers only to accounts an owner has approved', async () => {
  const { kv, site } = withAccounts();
  const visitor = browser(site), may = browser(site), owner = browser(site);
  // Anyone may learn that the site is closed and that accounts exist, and nothing more.
  assert.deepEqual((await visitor.ask('GET', 'health')).data, { ok: true, storage: true, locked: true });
  assert.deepEqual((await visitor.ask('GET', 'me')).data, { accounts: true, account: null });
  for (const [method, op, body] of teamRequests) {
    const none = await visitor.ask(method, op, body);
    assert.deepEqual([op, none.status, none.data.error], [op, 401, 'sign_in']);
  }
  // The key that used to open the shared copy by itself no longer does.
  assert.equal((await visitor.ask('GET', 'state', undefined, { 'x-csr-key': KEY })).status, 401);

  // A new account signs in at once and still opens nothing.
  assert.equal((await may.ask('POST', 'signup', { nick: 'x', password: 'long enough 1' })).data.error, 'bad_nick');
  assert.equal((await may.ask('POST', 'signup', { nick: '<May>', password: 'long enough 1' })).data.error, 'bad_nick');
  assert.equal((await may.ask('POST', 'signup', { nick: 'May', password: 'short' })).data.error, 'bad_password');
  assert.equal((await may.ask('POST', 'signup', { nick: 'May', password: 'x'.repeat(201) })).data.error, 'bad_password');
  const joined = await may.ask('POST', 'signup', { nick: '  May  ', password: 'may password 1' });
  assert.deepEqual([joined.status, joined.data.account.nick, joined.data.account.status, joined.data.account.role], [200, 'May', 'pending', null]);
  assert.match(joined.set ?? '', /^csr_session=[0-9a-f]{64}; Path=\/api\/csr; Max-Age=2592000; HttpOnly; SameSite=Strict; Secure$/);
  assert.equal((await may.ask('GET', 'me')).data.account.status, 'pending');
  for (const [method, op, body] of teamRequests) {
    const early = await may.ask(method, op, body);
    assert.deepEqual([op, early.status, early.data.error], [op, 403, 'waiting']);
  }
  assert.equal((await may.ask('GET', 'accounts')).status, 403);
  assert.equal((await visitor.ask('POST', 'signup', { nick: 'MAY', password: 'another one 2' })).data.error, 'nick_taken');
  // What is stored is a salted hash and a hash of the session secret: neither the password nor the cookie.
  const stored = JSON.stringify([await kv.command(['HGETALL', 'csr:users']), await kv.command(['GET', `csr:session:${may.cookie().split('=')[1]}`])]);
  assert.ok(!stored.includes('may password 1') && stored.endsWith(',null]'));

  // The owner key turns an ordinary account into an owner, and only the right key does.
  await owner.ask('POST', 'signup', { nick: 'Boss', password: 'boss password 1' });
  const refused = await owner.ask('POST', 'owner', { key: `${KEY}!` });
  assert.deepEqual([refused.status, refused.data.error, refused.text.includes(KEY)], [403, 'key_wrong', false]);
  assert.equal((await visitor.ask('POST', 'owner', { key: KEY })).status, 401);
  assert.deepEqual((await owner.ask('POST', 'owner', { key: KEY })).data.account.role, 'owner');
  const list = await owner.ask('GET', 'accounts');
  assert.deepEqual(list.data.accounts.map((item: any) => [item.nick, item.status, item.role]), [['May', 'pending', null], ['Boss', 'active', 'owner']]);
  assert.ok(!/salt|hash|epoch/.test(list.text));
  assert.equal((await owner.ask('POST', 'account', { nick: 'Boss', action: 'disable' })).data.error, 'own_account');
  assert.equal((await owner.ask('POST', 'account', { nick: 'Nobody', action: 'disable' })).status, 404);

  // Approved as a scheduler, May reads and saves, and her name stays with the save.
  assert.equal((await owner.ask('POST', 'account', { nick: 'may', action: 'approve', role: 'boss' })).status, 400);
  assert.equal((await owner.ask('POST', 'account', { nick: 'may', action: 'approve', role: 'scheduler' })).status, 200);
  assert.equal((await may.ask('GET', 'state')).data.revision, 0);
  assert.equal((await may.ask('POST', 'state', { state: state(), baseRevision: 0 })).data.revision, 1);
  assert.equal((await owner.ask('POST', 'state', { state: state(), baseRevision: 1 })).data.revision, 2);
  assert.deepEqual((await may.ask('GET', 'history')).data.versions.map((version: any) => [version.revision, version.savedBy]), [[2, 'Boss'], [1, 'May']]);
  assert.equal((await may.ask('GET', 'accounts')).data.error, 'not_allowed');

  // A write counts as May's only when her own page sent it: not a form from another site, not something that is not JSON.
  const save = { state: state(), baseRevision: 2 };
  assert.equal((await may.ask('POST', 'state', save, { 'sec-fetch-site': 'cross-site' })).status, 401);
  assert.equal((await may.ask('POST', 'state', save, { 'content-type': 'text/plain' })).status, 401);
  assert.equal((await may.ask('POST', 'state', save, { 'sec-fetch-site': 'same-origin' })).status, 200);

  // Switched off: the session she holds stops working at once, and so does her password.
  assert.equal((await owner.ask('POST', 'account', { nick: 'May', action: 'disable' })).status, 200);
  assert.equal((await may.ask('GET', 'state')).status, 401);
  assert.equal((await may.ask('POST', 'login', { nick: 'May', password: 'may password 1' })).data.error, 'disabled');
  assert.equal((await owner.ask('POST', 'account', { nick: 'May', action: 'enable' })).status, 200);
  assert.equal((await may.ask('POST', 'login', { nick: 'may', password: 'may password 1' })).data.account.role, 'scheduler');
  assert.equal((await may.ask('GET', 'state')).status, 200);

  // A wrong password and a nickname nobody has get the same answer.
  const wrong = await visitor.ask('POST', 'login', { nick: 'May', password: 'not her password' });
  const nobody = await visitor.ask('POST', 'login', { nick: 'Kate', password: 'not her password' });
  assert.deepEqual([wrong.status, wrong.text], [401, nobody.text]);

  // A reset gives the owner a one-time password to pass on; the old one and the old session are gone.
  const reset = await owner.ask('POST', 'account', { nick: 'May', action: 'reset' });
  assert.match(reset.data.password, /^[0-9a-f]{4}(-[0-9a-f]{4}){3}$/);
  assert.equal((await may.ask('GET', 'state')).status, 401);
  assert.equal((await may.ask('POST', 'login', { nick: 'May', password: 'may password 1' })).status, 401);
  assert.equal((await may.ask('POST', 'login', { nick: 'May', password: reset.data.password })).status, 200);
  // She then sets her own, which signs her out everywhere else.
  const elsewhere = browser(site);
  await elsewhere.ask('POST', 'login', { nick: 'May', password: reset.data.password });
  assert.equal((await may.ask('POST', 'password', { current: 'guess', next: 'her own new one' })).data.error, 'wrong_password');
  assert.equal((await may.ask('POST', 'password', { current: reset.data.password, next: 'short' })).data.error, 'bad_password');
  assert.equal((await may.ask('POST', 'password', { current: reset.data.password, next: 'her own new one' })).status, 200);
  assert.deepEqual([(await may.ask('GET', 'state')).status, (await elsewhere.ask('GET', 'state')).status], [200, 401]);

  // Signing out ends the session on the site, not only in the browser.
  const held = may.cookie();
  const out = await may.ask('POST', 'logout', {});
  assert.match(out.set ?? '', /^csr_session=; Path=\/api\/csr; Max-Age=0;/);
  assert.equal((await site.fetch(new Request('https://example.test/api/csr?op=state', { headers: { cookie: held } }))).status, 401);
  // Removed: the nickname is free again and the account is gone.
  assert.equal((await owner.ask('POST', 'account', { nick: 'May', action: 'remove' })).status, 200);
  assert.equal((await visitor.ask('POST', 'login', { nick: 'May', password: 'her own new one' })).status, 401);
  assert.deepEqual((await owner.ask('GET', 'accounts')).data.accounts.map((item: any) => item.nick), ['Boss']);

  // Without the owner key nothing changes: the storage is open and there are no accounts to make.
  assert.deepEqual([accessKeyFromEnv({}), accessKeyFromEnv({ CSR_ACCESS_KEY: '   ' }), accessKeyFromEnv({ CSR_ACCESS_KEY: ' abc ' })], [null, null, 'abc']);
  const open = createApi(memoryKv());
  assert.equal((await call(open, 'GET', 'state')).status, 200);
  assert.deepEqual((await call(open, 'GET', 'me')).data, { accounts: false, account: null });
  assert.deepEqual((await call(open, 'POST', 'signup', { nick: 'May', password: 'may password 1' })).data.error, 'accounts_off');
  assert.deepEqual((await call(createApi(null, undefined, KEY), 'GET', 'me')).data, { accounts: false, account: null });
});

test('an operator account sends wishes under its own name, and a wish link still needs no account', async () => {
  const { site } = withAccounts();
  const owner = browser(site), sam = browser(site), visitor = browser(site);
  await owner.ask('POST', 'signup', { nick: 'Boss', password: 'boss password 1' });
  await owner.ask('POST', 'owner', { key: KEY });
  await sam.ask('POST', 'signup', { nick: 'sam.k', password: 'sam password 1' });
  // An operator account is tied to someone in the team that is saved for everyone.
  const approve = { nick: 'sam.k', action: 'approve', role: 'operator', operatorId: 'sam' };
  assert.equal((await owner.ask('POST', 'account', approve)).data.error, 'not_in_team');
  await owner.ask('POST', 'state', { state: state([{ id: 'sam', nick: 'Sam' }, { id: 'may', nick: 'May' }]), baseRevision: 0 });
  assert.equal((await owner.ask('POST', 'account', { ...approve, operatorId: 'kate' })).data.error, 'not_in_team');
  assert.equal((await owner.ask('POST', 'account', approve)).status, 200);
  assert.deepEqual((await sam.ask('GET', 'me')).data.account, { nick: 'sam.k', role: 'operator', status: 'active', operatorId: 'sam', createdAt: (await sam.ask('GET', 'me')).data.account.createdAt, operatorNick: 'Sam' });
  // The operator sees neither the shared copy nor other people's wishes.
  assert.deepEqual([(await sam.ask('GET', 'state')).data.error, (await sam.ask('GET', 'wishes')).data.error], ['not_allowed', 'not_allowed']);
  const days = ['off', '', '', '', '', '', ''];
  // Whatever the form claims, the wish is from the person the account is tied to.
  assert.equal((await sam.ask('POST', 'my-wish', { weekStart: '2026-12-01', days, shifts: [], comment: '' })).data.error, 'bad_request');
  assert.equal((await sam.ask('POST', 'my-wish', { weekStart: '2026-11-30', days: [], shifts: [], comment: '' })).data.error, 'bad_request');
  assert.equal((await sam.ask('POST', 'my-wish', { weekStart: '2026-11-30', operatorId: 'may', nick: 'May', days, shifts: ['l1130'], comment: ' Monday off ' })).status, 200);
  assert.equal((await owner.ask('POST', 'my-wish', { weekStart: '2026-11-30', days, shifts: [], comment: '' })).data.error, 'not_allowed');
  assert.equal((await visitor.ask('POST', 'my-wish', { weekStart: '2026-11-30', days, shifts: [], comment: '' })).status, 401);

  const link = await owner.ask('POST', 'wishlink', { weekStart: '2026-11-30', operators: [{ id: 'may', nick: 'May' }] });
  assert.deepEqual((await visitor.ask('GET', `wishlink&token=${link.data.token}`)).data, { weekStart: '2026-11-30', operators: [{ id: 'may', nick: 'May' }] });
  assert.equal((await visitor.ask('POST', 'wish', { token: link.data.token, operatorId: 'may', days, shifts: [], comment: '' })).status, 200);
  const wishes = (await owner.ask('GET', 'wishes')).data.wishes;
  assert.deepEqual(wishes.map((wish: any) => [wish.nick, wish.operatorId, wish.account, wish.comment]).sort(), [['May', 'may', undefined, ''], ['Sam', 'sam', 'sam.k', 'Monday off']]);

  // Once that person is no longer in the saved team, the account has nobody to speak for.
  await owner.ask('POST', 'state', { state: state([{ id: 'may', nick: 'May' }]), baseRevision: 1 });
  assert.equal((await sam.ask('GET', 'me')).data.account.operatorNick, null);
  assert.equal((await sam.ask('POST', 'my-wish', { weekStart: '2026-11-30', days, shifts: [], comment: '' })).data.error, 'not_in_team');
});

test('tries at a password, at the owner key and at new accounts are counted and cut off', async () => {
  const { site } = withAccounts();
  const may = browser(site), guesser = browser(site);
  await may.ask('POST', 'signup', { nick: 'May', password: 'may password 1' });
  const from = (address: string) => ({ 'x-real-ip': address });
  // Ten tries at one nickname in fifteen minutes, whoever makes them; then even the right password waits.
  for (let attempt = 0; attempt < 10; attempt += 1) assert.equal((await guesser.ask('POST', 'login', { nick: 'May', password: `guess ${attempt}` }, from(`10.0.0.${attempt}`))).status, 401);
  const eleventh = await guesser.ask('POST', 'login', { nick: 'may', password: 'may password 1' }, from('10.0.0.99'));
  assert.deepEqual([eleventh.status, eleventh.data.error], [429, 'too_many_tries']);
  // Thirty tries from one address, whatever the nicknames.
  for (let attempt = 0; attempt < 30; attempt += 1) await guesser.ask('POST', 'login', { nick: `nobody${attempt}`, password: 'some guess' }, from('10.0.1.1'));
  assert.equal((await guesser.ask('POST', 'login', { nick: 'someone', password: 'some guess' }, from('10.0.1.1'))).status, 429);
  assert.equal((await guesser.ask('POST', 'login', { nick: 'someone', password: 'some guess' }, from('10.0.1.2'))).status, 401);
  // Ten tries at the owner key from one address.
  for (let attempt = 0; attempt < 10; attempt += 1) assert.equal((await may.ask('POST', 'owner', { key: `guess ${attempt}` }, from('10.0.2.1'))).status, 403);
  assert.equal((await may.ask('POST', 'owner', { key: KEY }, from('10.0.2.1'))).status, 429);
  // Ten new accounts an hour from one address.
  for (let attempt = 0; attempt < 10; attempt += 1) assert.equal((await browser(site).ask('POST', 'signup', { nick: `new ${attempt}`, password: 'some password' }, from('10.0.3.1'))).status, 200);
  assert.equal((await browser(site).ask('POST', 'signup', { nick: 'one more', password: 'some password' }, from('10.0.3.1'))).status, 429);
});

test('the page tells "sign in" and "not allowed" from other failures, and sends no key of its own', async () => {
  const sent: Headers[] = [];
  const server = (status: number, body: unknown) => (async (_url: any, init: any) => { sent.push(new Headers(init.headers)); return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }); }) as typeof fetch;
  const ok = await clientCall('GET', 'state', undefined, server(200, { revision: 3 }));
  assert.deepEqual([ok.ok, sent[0].get('x-csr-key'), sent[0].get('content-type')], [true, null, null]);
  const none = await clientCall('GET', 'state', undefined, server(401, { error: 'sign_in', message: 'Sign in first.' }));
  assert.deepEqual([none.ok, !none.ok && none.trouble, !none.ok && none.detail?.error], [false, 'locked', 'sign_in']);
  const waiting = await clientCall('POST', 'state', { a: 1 }, server(403, { error: 'waiting', message: 'This account is waiting for the owner’s approval.' }));
  assert.deepEqual([!waiting.ok && waiting.trouble, !waiting.ok && waiting.message, sent[2].get('content-type')], ['locked', 'This account is waiting for the owner’s approval.', 'application/json']);
  const slow = await clientCall('POST', 'login', { nick: 'May', password: 'x' }, server(429, { error: 'too_many_tries', message: 'Too many tries.' }));
  assert.deepEqual([!slow.ok && slow.trouble, !slow.ok && slow.message], ['rejected', 'Too many tries.']);
  const down = await clientCall('GET', 'state', undefined, server(503, { error: 'storage_not_connected', message: 'x' }));
  assert.equal(!down.ok && down.trouble, 'not_connected');
  const page = await clientCall('GET', 'state', undefined, (async () => new Response('<!doctype html>', { status: 200, headers: { 'content-type': 'text/html' } })) as typeof fetch);
  assert.equal(!page.ok && page.trouble, 'not_connected');
});
