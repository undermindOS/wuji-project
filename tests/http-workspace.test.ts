import assert from 'node:assert/strict';
import test from 'node:test';
import { HttpWorkspaceClient, WorkspaceApiError } from '../src/features/workspace/api/HttpWorkspaceClient.ts';

test('a static-host HTML fallback is not accepted as a saved project response', async () => {
  const client = new HttpWorkspaceClient(async () => new Response('<html>app</html>', { headers: { 'Content-Type': 'text/html' } }));
  await assert.rejects(client.listProjects(), value => value instanceof WorkspaceApiError && value.code === 'unavailable');
});

test('backend conflicts preserve their status and message for explicit recovery', async () => {
  const client = new HttpWorkspaceClient(async () => Response.json({ code: 'source_conflict', message: 'Исходник изменился.' }, { status: 409 }));
  await assert.rejects(client.createProject('name'), value => value instanceof WorkspaceApiError && value.status === 409 && value.message === 'Исходник изменился.');
});

test('network failure is distinguishable from cancellation', async () => {
  const offline = new HttpWorkspaceClient(async () => { throw new TypeError('offline'); });
  await assert.rejects(offline.listProjects(), value => value instanceof WorkspaceApiError && value.status === 0);
  const aborted = new HttpWorkspaceClient(async () => { throw new DOMException('cancelled', 'AbortError'); });
  await assert.rejects(aborted.listProjects(), { name: 'AbortError' });
});

test('workspace history is requested with explicit source and task IDs', async () => {
  let requested = '';
  const client = new HttpWorkspaceClient(async url => { requested = String(url); return Response.json({}); });
  await client.getWorkspace('project-id', { sourceId: 'source-id', taskId: 'task-id' });
  assert.equal(requested, '/api/v1/projects/project-id/workspace?source_id=source-id&task_id=task-id');
});

test('multipart uploads let the browser choose the boundary and preserve selected files', async () => {
  let sent: RequestInit | undefined;
  const client = new HttpWorkspaceClient(async (_url, init) => { sent = init; return Response.json({}); });
  const form = new FormData(); form.set('schedule', new File(['shift_id\ns1\n'], 'week.csv'));
  await client.previewImport('project-id', form);
  assert.equal(sent?.body, form);
  assert.equal(new Headers(sent?.headers).has('Content-Type'), false);
});

test('native fetch receives the global receiver required by the desktop browser', async () => {
  const fetcher = function (this: typeof globalThis) {
    assert.equal(this, globalThis);
    return Promise.resolve(Response.json([]));
  };
  const client = new HttpWorkspaceClient(fetcher);
  assert.deepEqual(await client.listProjects(), []);
});
