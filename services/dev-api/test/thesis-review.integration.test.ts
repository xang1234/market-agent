import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { randomUUID } from 'node:crypto';
import { bootstrapDatabase, connectedClient, connectedPool, dockerAvailable } from '../../../db/test/docker-pg.ts';
import { createAgent, getAgent } from '../../agents/src/agent-repo.ts';
import { saveThesis, loadThesisHistory } from '../../agents/src/thesis-repo.ts';
import { runAgentLoop } from '../../agents/src/agent-loop.ts';
import { loadEvidenceInspection } from '../../evidence/src/inspector.ts';
import { createThesisAdapter } from '../src/thesis-adapter.ts';
import { createThesisAgentLoopStages } from '../src/thesis-runtime.ts';
import { createServiceDevApiAdapters } from '../src/http.ts';

const USER = '10000000-0000-4000-8000-000000000001';
const OTHER = '10000000-0000-4000-8000-000000000002';
const ISSUER = '20000000-0000-4000-8000-000000000001';
const CONDITION = '30000000-0000-4000-8000-000000000001';
const options = { skip: !dockerAvailable(), timeout: 120_000 };

async function fixture(t: TestContext, name: string) {
  const { databaseUrl } = await bootstrapDatabase(t, name);
  const db = await connectedClient(t, databaseUrl);
  const pool = await connectedPool(t, databaseUrl);
  await db.query('insert into users(user_id,email) values($1,$2),($3,$4)', [USER,'owner@example.test',OTHER,'other@example.test']);
  await db.query("insert into issuers(issuer_id,legal_name) values($1,'Test issuer')", [ISSUER]);
  const agent = await createAgent(db, { user_id: USER, name: 'Cash monitor', thesis: 'Cash reserves remain strong.', cadence: 'daily', universe: { mode: 'static', subject_refs: [{ kind: 'issuer', id: ISSUER }] } });
  const source = randomUUID();
  const metricId = randomUUID();
  await db.query("insert into sources(source_id,user_id,provider,kind,trust_tier,license_class,retrieved_at) values($1,$2,'Company filings','filing','primary','public',now())", [source,USER]);
  await db.query("insert into metrics(metric_id,metric_key,display_name,unit_class,aggregation,interpretation,canonical_source_class) values($1,'cash_reserves','Cash reserves','currency','latest','higher is better','filing')", [metricId]);
  const thesis = await saveThesis(db, { agent_id: agent.agent_id, user_id: USER, expected_version: 0, thesis: agent.thesis, subject_ref: { kind: 'issuer', id: ISSUER }, conditions: [{ condition_id: CONDITION, statement: 'Cash reserves remain strong.', falsifier: 'Cash falls below the required floor.', horizon: 'Next quarter', metric: { metric_key: 'cash_reserves', unit: 'USD', period_kind: 'point', operator: 'gte', threshold: 100, max_age_days: 1 } }] });
  async function insertFact(asOf: string, periodEnd: string | null = null) {
    const id = randomUUID();
    await db.query(`insert into facts(fact_id,subject_kind,subject_id,metric_id,period_kind,period_end,value_num,unit,scale,as_of,observed_at,source_id,method,verification_status,freshness_class,coverage_level,confidence)
      values($1,'issuer',$2,$3,'point',$4,200,'USD',1,$5,$5,$6,'reported','authoritative','filing_time','full',1)`, [id,ISSUER,metricId,periodEnd,asOf,source]);
    return id;
  }
  async function run() {
    const fresh = (await getAgent(db, agent.agent_id))!;
    const stages = createThesisAgentLoopStages({ db: pool, userId: USER, runId: randomUUID(), agent: fresh, thesis });
    return runAgentLoop({ pool, agent_id: agent.agent_id, current_watermarks: fresh.watermarks, stages });
  }
  const history = () => loadThesisHistory(db, { user_id: USER, agent_id: agent.agent_id });
  return { db, pool, agent, thesis, source, insertFact, run, history };
}

test('full agent edits accept an unchanged universe regardless of JSON object key order', options, async t => {
  const { db, pool, agent } = await fixture(t, 'thesis-review-universe');
  const services = createServiceDevApiAdapters({ db: pool, async sealAnalyzeSnapshot() { throw new Error('unused'); } });
  const universe = { mode: 'static', subject_refs: [{ kind: 'issuer', id: ISSUER }] };
  const saved = await services.agents.update({ userId: USER, agentId: agent.agent_id, body: { name: 'Renamed cash monitor', cadence: 'hourly', thesis: agent.thesis, universe } });
  assert.equal(saved?.name, 'Renamed cash monitor');
  assert.equal(saved?.cadence, 'hourly');
  assert.deepEqual((await getAgent(db, agent.agent_id))?.universe, universe);
  await assert.rejects(services.agents.update({ userId: USER, agentId: agent.agent_id, body: { universe: { ...universe, subject_refs: [{ kind: 'issuer', id: randomUUID() }] } } }), { status: 409 });
});

test('point facts with no period end can be selected, assessed, sealed and inspected', options, async t => {
  const { db, agent, insertFact, run, history } = await fixture(t, 'thesis-review-point');
  const factId = await insertFact(new Date(Date.now() - 60_000).toISOString());
  const configured = await createThesisAdapter(db).get({ userId: USER, agentId: agent.agent_id });
  assert.ok(configured.metrics.some(metric => metric.metric_key === 'cash_reserves' && metric.period_kind === 'point'));
  await run();
  const assessment = (await history()).assessments[0];
  assert.equal(assessment.results[0].status, 'supported');
  assert.deepEqual(assessment.results[0].fact_refs, [factId]);
  const inspected = await loadEvidenceInspection(db, { user_id: USER, snapshot_id: assessment.snapshot_id, ref: { kind: 'fact', id: factId } });
  assert.equal(inspected.title, '200 USD');
});

test('unchanged facts expire at their exact freshness boundary within the same UTC day', options, async t => {
  const { insertFact, run, history } = await fixture(t, 'thesis-review-expiry');
  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  tomorrow.setUTCHours(12, 0, 0, 0);
  const deadline = tomorrow.getTime();
  t.mock.timers.enable({ apis: ['Date'], now: deadline - 1_000 });
  const observed = new Date(deadline - 86_400_000).toISOString();
  await insertFact(observed, observed.slice(0, 10));
  await run();
  assert.equal((await history()).assessments[0].results[0].status, 'supported');
  t.mock.timers.setTime(deadline);
  await run();
  assert.equal((await history()).assessments.length, 1, 'the maximum age is inclusive');
  t.mock.timers.setTime(deadline + 1);
  await run();
  const expired = await history();
  assert.equal(expired.assessments[0].results[0].status, 'unresolved');
  assert.equal(expired.assessments.length, 2);
  t.mock.timers.setTime(deadline + 1_000);
  await run();
  assert.equal((await history()).assessments.length, 2, 'unchanged expired results still deduplicate');
});

test('thesis snapshots preserve document sources separately from claim reporters', options, async t => {
  const { db, pool, agent, source, history } = await fixture(t, 'thesis-review-document');
  const reporter = randomUUID();
  const documentId = randomUUID();
  const claimId = randomUUID();
  await db.query("insert into sources(source_id,provider,kind,trust_tier,license_class,retrieved_at) values($1,'News reporter','article','secondary','public',now())", [reporter]);
  await db.query("insert into documents(document_id,source_id,kind,title,content_hash,raw_blob_id,parse_status) values($1,$2,'filing','Company filing','sha256:test','ephemeral:source-binding','parsed')", [documentId,source]);
  await db.query("insert into claims(claim_id,document_id,predicate,text_canonical,polarity,modality,reported_by_source_id,confidence,status) values($1,$2,'demand.change','Demand remains strong.','positive','asserted',$3,0.9,'extracted')", [claimId,documentId,reporter]);
  await db.query("insert into claim_arguments(claim_id,subject_kind,subject_id,role) values($1,'issuer',$2,'subject')", [claimId,ISSUER]);
  const thesis = await saveThesis(db, { agent_id: agent.agent_id, user_id: USER, expected_version: 1, thesis: 'Demand remains strong.', subject_ref: { kind: 'issuer', id: ISSUER }, conditions: [{ condition_id: CONDITION, statement: 'Demand remains strong.', falsifier: 'Customers cancel orders.', horizon: 'Next quarter' }] });
  const fresh = (await getAgent(db, agent.agent_id))!;
  const stages = createThesisAgentLoopStages({ db: pool, userId: USER, runId: randomUUID(), agent: fresh, thesis, getModel: async () => ({ identity: 'controlled', llm: { async complete() { return { text: JSON.stringify({ results: [{ condition_id: CONDITION, status: 'supported', reason: 'The cited report describes strong demand.', claim_refs: [claimId] }] }) }; } } }) });
  await runAgentLoop({ pool, agent_id: agent.agent_id, current_watermarks: fresh.watermarks, stages });
  const assessment = (await history()).assessments[0];
  const snapshot = await db.query('select source_ids from snapshots where snapshot_id=$1', [assessment.snapshot_id]);
  assert.deepEqual(snapshot.rows[0].source_ids.sort(), [reporter,source].sort());
  const inspection = await loadEvidenceInspection(db, { user_id: USER, snapshot_id: assessment.snapshot_id, ref: { kind: 'document', id: documentId } });
  assert.ok(inspection.related_refs.some(ref => ref.kind === 'source' && ref.id === source));
  assert.equal((await loadEvidenceInspection(db, { user_id: USER, snapshot_id: assessment.snapshot_id, ref: { kind: 'source', id: source } })).ref.id, source);
  await assert.rejects(loadEvidenceInspection(db, { user_id: OTHER, snapshot_id: assessment.snapshot_id, ref: { kind: 'source', id: source } }), { status: 404 });
});
