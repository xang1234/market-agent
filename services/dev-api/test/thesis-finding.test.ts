import assert from 'node:assert/strict';
import test from 'node:test';
import { generateThesisFinding } from '../src/thesis-finding.ts';

const ids = (n: number) => `${n}0000000-0000-4000-8000-000000000001`;
const [AGENT, ISSUER, CONDITION, CLAIM, SOURCE, SNAPSHOT] = [1, 2, 3, 4, 5, 6].map(ids);

async function severityOf(status: 'supported' | 'challenged', impacts: unknown[]) {
  const db = { query: async (sql: string, params: unknown[]) => {
    if (sql.includes('entity_impacts')) return { rows: impacts };
    const [finding_id, agent_id, snapshot_id, subject_refs, claim_cluster_ids, severity, headline, summary_blocks] = params as string[];
    return { rows: [{ finding_id, agent_id, snapshot_id, severity, headline, created_at: '2026-11-04T00:00:00.000Z',
      subject_refs: JSON.parse(subject_refs), claim_cluster_ids: JSON.parse(claim_cluster_ids), summary_blocks: JSON.parse(summary_blocks) }] };
  } } as never;
  const finding = await generateThesisFinding(db, {
    agentName: 'Margins',
    thesis: { agent_id: AGENT, subject_ref: { kind: 'issuer', id: ISSUER }, conditions: [{ condition_id: CONDITION, statement: 'Margins expand.', falsifier: 'Margins fall.', horizon: 'Next year' }] } as never,
    result: { condition_id: CONDITION, status, reason: 'A filing says so.', claim_refs: [CLAIM], fact_refs: [], method: 'model' },
    packet: { claims: [{ claim_id: CLAIM, source_id: SOURCE, trust_tier: 'primary', confidence: 1 }], documents: [], facts: [] } as never,
    snapshot: { snapshot_id: SNAPSHOT, source_ids: [SOURCE], as_of: '2026-11-04T00:00:00.000Z' },
  });
  return finding.severity;
}

const STRONGEST = { direction: 'negative', channel: 'balance_sheet', horizon: 'near_term', confidence: 1 };

test('a supported condition stops at medium, however strong its evidence', async () => {
  assert.equal(await severityOf('supported', []), 'medium');
  assert.equal(await severityOf('supported', [STRONGEST]), 'medium');
});

test('a challenged condition keeps the severity policy', async () => {
  assert.equal(await severityOf('challenged', []), 'high');
  assert.equal(await severityOf('challenged', [STRONGEST]), 'critical');
});
