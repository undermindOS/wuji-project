import assert from 'node:assert/strict';
import test from 'node:test';
import handler, { createApi, kvFromEnv, memoryKv, upstashKv } from '../api/csr.ts';

const api = () => createApi(memoryKv());
const call = async (target: { fetch(request: Request): Promise<Response> }, method: string, op: string, body?: unknown) => {
  const response = await target.fetch(new Request(`https://example.test/api/csr?op=${op}`, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'content-type': 'application/json' } }));
  return { status: response.status, data: await response.json() as any, cache: response.headers.get('cache-control') };
};
const state = (operators = [{ id: 'sam', nick: 'Sam' }]) => ({ version: 1, operators, weekStart: '2026-11-23', weeks: {} });

test('without storage the address answers, says so, and stores nothing', async () => {
  const offline = createApi(null);
  assert.deepEqual((await call(offline, 'GET', 'health')).data, { ok: true, storage: false });
  const read = await call(offline, 'GET', 'state');
  assert.deepEqual([read.status, read.data.error], [503, 'storage_not_connected']);
  assert.equal((await call(offline, 'POST', 'state', { state: state(), baseRevision: 0 })).status, 503);
  assert.equal((await call(offline, 'GET', 'nope')).status, 404);
  // No variables on this machine, so the deployed entry point reports the same.
  assert.equal(kvFromEnv({}), null);
  assert.deepEqual(await (await handler.fetch(new Request('https://example.test/api/csr?op=health'))).json(), { ok: true, storage: kvFromEnv(process.env) !== null });
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
