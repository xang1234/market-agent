import assert from 'node:assert/strict';
import test from 'node:test';
import { LlmRouterError } from '../../llm/src/router.ts';
import { createThesisAdapter } from '../src/thesis-adapter.ts';

const AGENT = '20000000-0000-4000-8000-000000000001';
const USER = '10000000-0000-4000-8000-000000000001';
const db = { query: async () => ({ rows: [{
  agent_id: AGENT, user_id: USER, name: 'Margins', thesis: 'Margins expand.', cadence: 'daily', enabled: true,
  universe: { mode: 'static', subject_refs: [] }, alert_rules: [], watermarks: {},
  created_at: '2026-11-04T00:00:00.000Z', updated_at: '2026-11-04T00:00:00.000Z',
}] }) } as never;
const body = { thesis: 'Margins expand with services mix.' };

test('a failed draft logs its cause and keeps it out of the response', async t => {
  const logged = t.mock.method(console, 'error', () => {});
  const cause = new Error('all LLM deployments failed');
  const adapter = createThesisAdapter(db, async () => ({ async complete() { throw cause; } }));
  await assert.rejects(adapter.draft({ userId: USER, agentId: AGENT, body }), (error: Error & { status: number }) => {
    assert.equal(error.status, 503);
    assert.equal(error.message, 'Condition suggestions are unavailable. Try again or write your own conditions.');
    return true;
  });
  assert.deepEqual(logged.mock.calls.map(call => call.arguments), [[`thesis draft failed for agent ${AGENT}:`, cause]]);
});

test('a failed draft logs which deployments failed and why, as text', async t => {
  const logged = t.mock.method(console, 'error', () => {});
  const cause = new LlmRouterError('all_deployments_failed', 'all LLM deployments failed', [
    { deployment: { channel: 'anthropic', model: 'claude-sonnet-5-5' }, code: 'auth_failed', message: 'invalid x-api-key' },
    { deployment: { channel: 'opencode', model: 'glm-5' }, code: 'unknown', message: 'socket hang up' },
  ]);
  const adapter = createThesisAdapter(db, async () => ({ async complete() { throw cause; } }));
  await assert.rejects(adapter.draft({ userId: USER, agentId: AGENT, body }), { status: 503 });
  assert.deepEqual(logged.mock.calls.map(call => call.arguments), [[
    `thesis draft failed for agent ${AGENT}:`,
    'all LLM deployments failed (anthropic/claude-sonnet-5-5 auth_failed: invalid x-api-key; opencode/glm-5 unknown: socket hang up)',
  ]]);
});

test('an unconfigured model is a setup message, not a logged failure', async t => {
  const logged = t.mock.method(console, 'error', () => {});
  await assert.rejects(createThesisAdapter(db, async () => null).draft({ userId: USER, agentId: AGENT, body }), {
    status: 503,
    message: 'Configure a model in Settings to suggest conditions, or write your own.',
  });
  assert.equal(logged.mock.callCount(), 0);
});
