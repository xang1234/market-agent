import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { randomUUID } from 'node:crypto';
import { connectedPool, dockerAvailable } from '../../../db/test/docker-pg.ts';
import { createAgent, getAgent } from '../../agents/src/agent-repo.ts';
import { saveThesis, loadThesisHistory } from '../../agents/src/thesis-repo.ts';
import { runAgentLoop } from '../../agents/src/agent-loop.ts';
import type { ThesisMetricCheck } from '../../agents/src/thesis-types.ts';
import { loadEvidenceInspection } from '../../evidence/src/inspector.ts';
import { createEvidenceFinancialPort } from '../../financial-engine/src/evidence-adapter.ts';
import { databaseUrl, engineDatabase, IDS, seedReportedFact } from '../../financial-engine/test/db-fixtures.ts';
import { createThesisAdapter } from '../src/thesis-adapter.ts';
import { createThesisAgentLoopStages } from '../src/thesis-runtime.ts';
import { createServiceDevApiAdapters } from '../src/http.ts';

const USER = IDS.owner;
const OTHER = IDS.other;
const ISSUER = IDS.issuerA;
const CONDITION = '30000000-0000-4000-8000-000000000001';
const options = { skip: !dockerAvailable(), timeout: 120_000 };
const UNCATALOGUED_CASH: ThesisMetricCheck = { metric_key: 'cash_reserves', unit: 'USD', period_kind: 'point', operator: 'gte', threshold: 100, max_age_days: 1 };
const LAST_YEAR = new Date().getUTCFullYear() - 1;
const revenue = (maxAgeDays: number): ThesisMetricCheck => ({ metric_key: 'revenue', unit: 'currency', period_kind: 'fiscal_y', operator: 'gt', threshold: '1', max_age_days: maxAgeDays });

async function fixture(t: TestContext, name: string, metric = UNCATALOGUED_CASH) {
  const db = await engineDatabase(t, name);
  const pool = await connectedPool(t, databaseUrl(db));
  const agent = await createAgent(db, { user_id: USER, name: 'Cash monitor', thesis: 'Cash reserves remain strong.', cadence: 'daily', universe: { mode: 'static', subject_refs: [{ kind: 'issuer', id: ISSUER }] } });
  const source = randomUUID();
  const metricId = randomUUID();
  await db.query("insert into sources(source_id,user_id,provider,kind,trust_tier,license_class,retrieved_at) values($1,$2,'Company filings','filing','primary','public',now())", [source,USER]);
  await db.query("insert into metrics(metric_id,metric_key,display_name,unit_class,aggregation,interpretation,canonical_source_class) values($1,'cash_reserves','Cash reserves','currency','latest','higher is better','filing')", [metricId]);
  const thesis = await saveThesis(db, { agent_id: agent.agent_id, user_id: USER, expected_version: 0, thesis: agent.thesis, subject_ref: { kind: 'issuer', id: ISSUER }, conditions: [{ condition_id: CONDITION, statement: 'The saved metric holds.', falsifier: 'The saved metric falls below the saved level.', horizon: 'Next quarter', metric }] });
  async function insertFact(asOf: string, periodEnd: string | null = null) {
    const id = randomUUID();
    await db.query(`insert into facts(fact_id,subject_kind,subject_id,metric_id,period_kind,period_end,value_num,unit,scale,as_of,observed_at,source_id,method,verification_status,freshness_class,coverage_level,confidence)
      values($1,'issuer',$2,$3,'point',$4,200,'USD',1,$5,$5,$6,'reported','authoritative','filing_time','full',1)`, [id,ISSUER,metricId,periodEnd,asOf,source]);
    return id;
  }
  async function run(now?: () => string) {
    const fresh = (await getAgent(db, agent.agent_id))!;
    const stages = createThesisAgentLoopStages({ db: pool, userId: USER, runId: randomUUID(), agent: fresh, thesis, financial: { pool, evidence: createEvidenceFinancialPort }, ...(now ? { now } : {}) });
    return runAgentLoop({ pool, agent_id: agent.agent_id, current_watermarks: fresh.watermarks, stages });
  }
  const history = () => loadThesisHistory(db, { user_id: USER, agent_id: agent.agent_id });
  const findings = async () => (await db.query('select count(*)::int as n from findings where agent_id=$1', [agent.agent_id])).rows[0].n;
  return { db, pool, agent, thesis, source, insertFact, run, history, findings };
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

test('a condition outside the verified catalog is unresolved and raises no alert, while its point fact is still sealed', options, async t => {
  const { db, agent, insertFact, run, history, findings } = await fixture(t, 'thesis-review-point');
  const factId = await insertFact(new Date(Date.now() - 60_000).toISOString());
  // A dense history in another unit must not crowd the requested USD fact out of the sealed packet.
  await db.query(`insert into facts(subject_kind,subject_id,metric_id,period_kind,period_end,value_num,unit,as_of,observed_at,source_id,method,verification_status,freshness_class,coverage_level,confidence)
    select subject_kind,subject_id,metric_id,period_kind,period_end,value_num,'EUR',now(),now(),source_id,method,verification_status,freshness_class,coverage_level,confidence
    from facts cross join generate_series(1,260) where fact_id=$1`, [factId]);
  const configured = await createThesisAdapter(db).get({ userId: USER, agentId: agent.agent_id });
  assert.ok(configured.metrics.some(metric => metric.metric_key === 'cash_reserves' && metric.period_kind === 'point'));
  await run();
  const assessment = (await history()).assessments[0];
  assert.deepEqual([assessment.results[0].status, assessment.results[0].reason, assessment.results[0].fact_refs],
    ['unresolved', 'The saved rule could not be verified (metric_has_no_verified_definition).', []]);
  assert.equal(await findings(), 0);
  const inspected = await loadEvidenceInspection(db, { user_id: USER, snapshot_id: assessment.snapshot_id, ref: { kind: 'fact', id: factId } });
  assert.equal(inspected.title, '$200.0');
});

test('an unchanged outcome expires once its period end passes the saved maximum age', options, async t => {
  const dayAheadOfDbClock = new Date();
  dayAheadOfDbClock.setUTCDate(dayAheadOfDbClock.getUTCDate() + 1);
  dayAheadOfDbClock.setUTCHours(0, 0, 0, 0);
  const maxAgeDays = Math.round((dayAheadOfDbClock.getTime() - Date.parse(`${LAST_YEAR}-12-31T00:00:00Z`)) / 86_400_000);
  const { db, run, history, findings } = await fixture(t, 'thesis-review-expiry', revenue(maxAgeDays));
  await seedReportedFact(db, { metric_key: 'revenue', value: '500', fiscal_year: LAST_YEAR });
  const at = (ms: number) => () => new Date(dayAheadOfDbClock.getTime() + ms).toISOString();
  await run(at(43_200_000));
  assert.equal((await history()).assessments[0].results[0].status, 'supported');
  await run(at(86_399_999));
  assert.equal((await history()).assessments.length, 1, 'the maximum age is inclusive');
  await run(at(86_400_000));
  const expired = await history();
  assert.deepEqual([expired.assessments[0].results[0].status, expired.assessments[0].results[0].reason],
    ['unresolved', 'The latest eligible value is older than the saved maximum age at the assessment cutoff.']);
  assert.equal(expired.assessments.length, 2);
  await run(at(86_401_000));
  assert.equal((await history()).assessments.length, 2, 'unchanged expired results still deduplicate');
  assert.equal(await findings(), 1, 'only the supported transition alerts');
});

test('a newer assessment is detected at microsecond precision, not lost to millisecond rounding', options, async t => {
  const { db, insertFact, run, history } = await fixture(t, 'thesis-review-conflict-precision');
  const earlier = new Date(Date.now() - 60_000).toISOString();
  await insertFact(earlier, earlier.slice(0, 10));
  await run(() => new Date(Date.now() - 30_000).toISOString());
  assert.equal((await history()).assessments.length, 1);
  // New evidence for the next run, whose cutoff is a whole millisecond...
  const cutoff = new Date(Date.now() - 10_000).toISOString();
  await insertFact(new Date(Date.parse(cutoff) - 1_000).toISOString(), cutoff.slice(0, 10));
  // ...while another assessment finished 1 microsecond after it.
  await db.query(
    `update agent_thesis_assessments set assessed_at = $1::timestamptz + interval '1 microsecond'`,
    [cutoff],
  );
  // It must fail on the conflict itself, not on any unrelated error.
  await assert.rejects(run(() => cutoff), { name: 'ThesisConflictError', message: /A newer assessment finished during this run/ });
  assert.equal((await history()).assessments.length, 1, 'the run must yield to the newer assessment');
});

test('a run whose clock is ahead of the host still assesses its evidence', options, async t => {
  const { db, run, history } = await fixture(t, 'thesis-review-clock-ahead', revenue(730));
  await seedReportedFact(db, { metric_key: 'revenue', value: '500', fiscal_year: LAST_YEAR });
  await run(() => new Date(Date.now() + 3_600_000).toISOString());
  assert.equal((await history()).assessments[0].results[0].status, 'supported');
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
  const stages = createThesisAgentLoopStages({ db: pool, userId: USER, runId: randomUUID(), agent: fresh, thesis, financial: { pool, evidence: createEvidenceFinancialPort }, getModel: async () => ({ identity: 'controlled', llm: { async complete() { return { text: JSON.stringify({ results: [{ condition_id: CONDITION, status: 'supported', reason: 'The cited report describes strong demand.', claim_refs: [claimId] }] }) }; } } }) });
  await runAgentLoop({ pool, agent_id: agent.agent_id, current_watermarks: fresh.watermarks, stages });
  const assessment = (await history()).assessments[0];
  const snapshot = await db.query('select source_ids from snapshots where snapshot_id=$1', [assessment.snapshot_id]);
  assert.deepEqual(snapshot.rows[0].source_ids.sort(), [reporter,source].sort());
  const inspection = await loadEvidenceInspection(db, { user_id: USER, snapshot_id: assessment.snapshot_id, ref: { kind: 'document', id: documentId } });
  assert.ok(inspection.related_refs.some(ref => ref.kind === 'source' && ref.id === source));
  assert.equal((await loadEvidenceInspection(db, { user_id: USER, snapshot_id: assessment.snapshot_id, ref: { kind: 'source', id: source } })).ref.id, source);
  await assert.rejects(loadEvidenceInspection(db, { user_id: OTHER, snapshot_id: assessment.snapshot_id, ref: { kind: 'source', id: source } }), { status: 404 });
});
