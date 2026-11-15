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

test('a drafted condition that states a stance is left out, and a draft of nothing else says so', async t => {
  t.mock.method(console, 'error', () => {});
  const drafted = (statement: string, horizon = 'Next year') => ({ statement, falsifier: 'Data center revenue falls for two quarters.', horizon });
  const draftOf = (conditions: ReturnType<typeof drafted>[]) => createThesisAdapter(db, async () => ({ async complete() { return { text: JSON.stringify({ conditions }) }; } }));
  const { conditions } = await draftOf([
    drafted('Data center revenue keeps growing.'),
    drafted('The stock is a buy while data center demand holds.'),
    drafted('Gaming revenue recovers.', 'Until the next downgrade'),
  ]).draft({ userId: USER, agentId: AGENT, body });
  assert.deepEqual(conditions.map(condition => condition.statement), ['Data center revenue keeps growing.']);
  await assert.rejects(draftOf([drafted('This is a buy.'), drafted('Rated a strong buy by us.'), drafted('Upgrade to overweight.')]).draft({ userId: USER, agentId: AGENT, body }), {
    status: 503,
    message: 'Every suggested condition stated a rating or recommendation, so none is shown. Try again or write your own conditions.',
  });
});

test("a living-thesis-v1 row keeps its status and refs but not the model's reason; engine and current reasons stay", async () => {
  const VERSION = '30000000-0000-4000-8000-000000000001';
  const MODEL = '40000000-0000-4000-8000-000000000001';
  const METRIC = '40000000-0000-4000-8000-000000000002';
  const CLAIM = '50000000-0000-4000-8000-000000000001';
  const FACT = '50000000-0000-4000-8000-000000000002';
  const engineReason = 'The verified calculation at the assessment cutoff meets the saved threshold.';
  const assessment = (id: string, prompt: string, at: string, modelReason: string) => ({
    assessment_id: id, thesis_version_id: VERSION, run_id: id, snapshot_id: id, input_hash: id, model_version: 'anthropic:claude-sonnet-5-5', prompt_version: prompt, assessed_at: at,
    results: [
      { condition_id: MODEL, status: 'supported', reason: modelReason, claim_refs: [CLAIM], fact_refs: [], method: 'model' },
      { condition_id: METRIC, status: 'supported', reason: engineReason, claim_refs: [], fact_refs: [FACT], method: 'metric' },
    ],
  });
  const rows = (text: string) => {
    if (text.includes('from agent_thesis_assessments')) return [
      assessment('60000000-0000-4000-8000-000000000002', 'living-thesis-v2', '2026-11-05T00:00:00.000Z', 'The cited stored sources support this condition.'),
      assessment('60000000-0000-4000-8000-000000000001', 'living-thesis-v1', '2026-11-04T00:00:00.000Z', 'From what I know, demand will outlast supply for years.'),
    ];
    if (text.includes('from agent_thesis_versions')) return [{
      thesis_version_id: VERSION, agent_id: AGENT, version: 1, thesis: 'Margins expand.', subject_ref: { kind: 'issuer', id: '70000000-0000-4000-8000-000000000001' },
      conditions: [
        { condition_id: MODEL, statement: 'Demand stays ahead of supply.', falsifier: 'Supply catches up with demand.', horizon: 'Next 10-K' },
        { condition_id: METRIC, statement: 'Revenue stays above a floor.', falsifier: 'Revenue falls below the floor.', horizon: 'Next 10-K',
          metric: { metric_key: 'revenue', unit: 'currency', period_kind: 'fiscal_y', operator: 'gt', threshold: '1', max_age_days: 730 } },
      ],
      created_at: '2026-11-04T00:00:00.000Z',
    }];
    if (text.includes('union all')) return [];
    return [{ agent_id: AGENT, user_id: USER, name: 'Margins', thesis: 'Margins expand.', cadence: 'daily', enabled: true, universe: { mode: 'static', subject_refs: [] }, alert_rules: [], watermarks: {}, created_at: '2026-11-04T00:00:00.000Z', updated_at: '2026-11-04T00:00:00.000Z' }];
  };
  const history = await createThesisAdapter({ query: async (text: string) => ({ rows: rows(text) }) } as never).get({ userId: USER, agentId: AGENT });
  assert.deepEqual(history.assessments.map(entry => [entry.prompt_version, entry.results.map(result => [result.status, result.reason, result.claim_refs, result.fact_refs])]), [
    ['living-thesis-v2', [['supported', 'The cited stored sources support this condition.', [CLAIM], []], ['supported', engineReason, [], [FACT]]]],
    ['living-thesis-v1', [['supported', 'An older assessment. Its model-written reason is not shown.', [CLAIM], []], ['supported', engineReason, [], [FACT]]]],
  ]);
});
