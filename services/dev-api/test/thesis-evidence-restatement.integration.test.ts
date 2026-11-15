import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { bootstrapDatabase, connectedClient, dockerAvailable } from '../../../db/test/docker-pg.ts';
import type { ThesisVersion } from '../../agents/src/thesis-types.ts';
import { loadThesisPacket } from '../src/thesis-evidence.ts';

const USER = '10000000-0000-4000-8000-000000000001';
const ISSUER = '20000000-0000-4000-8000-000000000001';

test('a thesis packet holds the as-reported value of a restated year, beside vendor facts (#335)', { skip: !dockerAvailable(), timeout: 120000 }, async t => {
  const { databaseUrl } = await bootstrapDatabase(t, 'thesis-evidence-restatement');
  const db = await connectedClient(t, databaseUrl);
  await db.query("insert into issuers(issuer_id,legal_name) values($1,'Restating issuer')", [ISSUER]);
  const [original, restating, vendor] = [randomUUID(), randomUUID(), randomUUID()];
  for (const source of [original, restating, vendor])
    await db.query("insert into sources(source_id,provider,kind,trust_tier,license_class,retrieved_at) values($1,'Test','filing','primary','public',now())", [source]);
  const [revenue, price] = [randomUUID(), randomUUID()];
  await db.query(`insert into metrics(metric_id,metric_key,display_name,unit_class,aggregation,interpretation,canonical_source_class)
    values($1,'revenue','Revenue','currency','sum','higher_is_better','gaap'),($2,'price','Price','currency','latest','neutral','vendor')`, [revenue, price]);
  const insert = async (values: { metric: string; kind: 'fiscal_y' | 'point'; value: string; source: string; method: string; supersedes?: string }) => {
    const year = values.kind === 'fiscal_y';
    return (await db.query<{ fact_id: string }>(
      `insert into facts(subject_kind,subject_id,metric_id,period_kind,period_start,period_end,fiscal_year,fiscal_period,value_num,unit,as_of,observed_at,source_id,method,verification_status,freshness_class,coverage_level,confidence,supersedes)
       values('issuer',$1,$2,$3,$4,$5,$6,$7,$8,'USD',now() - interval '1 hour',now() - interval '1 hour',$9,$10,'authoritative','filing_time','full',1,$11)
       returning fact_id::text`,
      [ISSUER, values.metric, values.kind, year ? '2023-01-01' : null, year ? '2023-12-31' : new Date().toISOString().slice(0, 10), year ? 2023 : null, year ? 'FY' : null,
        values.value, values.source, values.method, values.supersedes ?? null],
    )).rows[0]!.fact_id;
  };
  const reported = await insert({ metric: revenue, kind: 'fiscal_y', value: '100', source: original, method: 'reported' });
  await insert({ metric: revenue, kind: 'fiscal_y', value: '95', source: restating, method: 'restated', supersedes: reported });
  const quote = await insert({ metric: price, kind: 'point', value: '42', source: vendor, method: 'vendor' });

  const packet = await loadThesisPacket(db, { thesis: thesis(), userId: USER, asOf: new Date().toISOString(), runId: randomUUID(), financial: {} as never });
  assert.deepEqual(packet.facts.map(fact => [fact.fact_id, fact.metric_key, fact.value_num]).sort(), [
    [quote, 'price', '42'],
    [reported, 'revenue', '100'],
  ].sort());
});

function thesis(): ThesisVersion {
  const condition = (id: string, metric: { metric_key: string; period_kind: 'fiscal_y' | 'point' }) => ({
    condition_id: id, statement: `${metric.metric_key} holds.`, falsifier: `${metric.metric_key} falls.`, horizon: 'Next year',
    metric: { ...metric, unit: 'USD', operator: 'gte' as const, threshold: '1', max_age_days: 3650 },
  });
  return {
    thesis_version_id: '40000000-0000-4000-8000-000000000001',
    agent_id: '50000000-0000-4000-8000-000000000001',
    version: 1,
    thesis: 'Revenue and price hold.',
    subject_ref: { kind: 'issuer', id: ISSUER },
    created_at: '2026-09-01T00:00:00.000Z',
    conditions: [
      condition('60000000-0000-4000-8000-000000000001', { metric_key: 'revenue', period_kind: 'fiscal_y' }),
      condition('60000000-0000-4000-8000-000000000002', { metric_key: 'price', period_kind: 'point' }),
    ],
  };
}
