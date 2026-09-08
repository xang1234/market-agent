import assert from 'node:assert/strict';
import test from 'node:test';
import type { AddressInfo } from 'node:net';
import { createDevApiServer, createFixtureDevApiAdapters } from '../src/http.ts';
import { DevApiHttpError } from '../src/dev-api-shared.ts';

const AGENT = '20000000-0000-4000-8000-000000000001';
const USER = '10000000-0000-4000-8000-000000000001';

test('thesis routes authenticate before reading or saving and preserve owner scope', async t => {
  const seen: unknown[] = [];
  const server = createDevApiServer({}, { adapters: {
    ...createFixtureDevApiAdapters(),
    theses: {
      async get(input: unknown) { seen.push(input); return { thesis: null, versions: [], assessments: [] }; },
      async save(input: unknown) { seen.push(input); return { thesis: { thesis_version_id: AGENT, agent_id: AGENT, version: 1, thesis: 'Margins recover', subject_ref: {kind: 'issuer' as const, id: AGENT}, conditions: [], created_at: new Date().toISOString() } }; },
      async draft(input: unknown) { seen.push(input); return { conditions: [] }; },
    },
  } });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/agents/${AGENT}/thesis`;
  assert.equal((await fetch(url)).status, 401);
  assert.equal(seen.length, 0);
  const response = await fetch(url, { headers: { 'x-user-id': USER } });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { thesis: null, versions: [], assessments: [] });
  assert.deepEqual(seen[0], { agentId: AGENT, userId: USER });
  const save = await fetch(url, { method: 'PUT', headers: { 'x-user-id': USER }, body: JSON.stringify({ expected_version: 0 }) });
  assert.equal(save.status, 200);
  assert.deepEqual(seen[1], { agentId: AGENT, userId: USER, body: { expected_version: 0 } });
  const draft = await fetch(`${url}/draft`, { method: 'POST', headers: { 'x-user-id': USER }, body: '{"thesis":"Margins recover"}' });
  assert.equal(draft.status, 200);
  assert.deepEqual(seen[2], { agentId: AGENT, userId: USER, body: { thesis: 'Margins recover' } });
  for (const body of ['{', '[]', 'null']) {
    assert.equal((await fetch(url, { method: 'PUT', headers: { 'x-user-id': USER }, body })).status, 400);
  }
  assert.equal(seen.length, 3);
});

test('thesis routes preserve explicit unavailable and ownership errors', async t => {
  const server = createDevApiServer({}, { adapters: {
    ...createFixtureDevApiAdapters(),
    theses: {
      async get() { throw new DevApiHttpError(404, 'agent not found'); },
      async save() { throw new DevApiHttpError(409, 'Thesis changed; reload before saving.'); },
      async draft() { throw new DevApiHttpError(503, 'Configure a model first.'); },
    },
  } });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/agents/${AGENT}/thesis`;
  const headers = { 'x-user-id': USER };
  assert.equal((await fetch(url, { headers })).status, 404);
  assert.equal((await fetch(url, { method: 'PUT', headers, body: '{}' })).status, 409);
  assert.equal((await fetch(`${url}/draft`, { method: 'POST', headers, body: '{}' })).status, 503);
});
