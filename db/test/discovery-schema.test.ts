import assert from "node:assert/strict";
import test from "node:test";

import { createDiscoveryRepository } from "../../services/discovery/src/repository.ts";
import { createOperationRunner } from "../../services/discovery/src/operations.ts";
import {
  bootstrapDatabase,
  connectedPool,
  createContainerName,
  dbRoot,
  dockerAvailable,
  registerLifoCleanup,
  run,
  startPostgres,
  stopPostgres,
  waitForPostgres,
} from "./docker-pg.ts";

const tables = [
  "discovery_campaigns", "discovery_briefs", "discovery_runs", "discovery_candidates", "discovery_attempts", "discovery_events",
];
const options = { skip: !dockerAvailable(), timeout: 120_000 };

test("fresh consolidated schema installs all discovery tables and invariants", options, async (t) => {
  const { databaseUrl } = await bootstrapDatabase(t, "discovery-schema-fresh");
  const db = await connectedPool(t, databaseUrl);
  await assertDiscoverySchema(db);
  await assert.rejects(
    db.query("insert into discovery_runs (campaign_id,user_id,brief_id,request_key,status,stage,policy_version,limits,usage,checkpoint,coverage) values (gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),'invalid','queued','v1','{}','{}','{}','{}')"),
  );
});

test("migration path installs discovery schema and rollback removes only discovery objects", options, async (t) => {
  const containerName = createContainerName("discovery-schema-migrated");
  const password = "postgres";
  registerLifoCleanup(t, () => stopPostgres(containerName));
  const port = startPostgres(containerName, password);
  const databaseUrl = `postgresql://postgres:${password}@127.0.0.1:${port}/postgres`;
  await waitForPostgres(containerName, databaseUrl);
  const migrated = run("npm", ["run", "migrate", "--", "up", "--database-url", databaseUrl], { cwd: dbRoot, env: { DATABASE_URL: databaseUrl } });
  assert.equal(migrated.status, 0, migrated.stderr || migrated.stdout);
  const db = await connectedPool(t, databaseUrl);
  await assertDiscoverySchema(db);
  const rolledBackLatest = run("npm", ["run", "migrate", "--", "down", "--database-url", databaseUrl], { cwd: dbRoot, env: { DATABASE_URL: databaseUrl } });
  assert.equal(rolledBackLatest.status, 0, rolledBackLatest.stderr || rolledBackLatest.stdout);
  const rolledBackDiscovery = run("npm", ["run", "migrate", "--", "down", "--database-url", databaseUrl], { cwd: dbRoot, env: { DATABASE_URL: databaseUrl } });
  assert.equal(rolledBackDiscovery.status, 0, rolledBackDiscovery.stderr || rolledBackDiscovery.stdout);
  const rolledBackBase = run("npm", ["run", "migrate", "--", "down", "--database-url", databaseUrl], { cwd: dbRoot, env: { DATABASE_URL: databaseUrl } });
  assert.equal(rolledBackBase.status, 0, rolledBackBase.stderr || rolledBackBase.stdout);
  const after = await db.query<{ discovery: string | null; metrics: string | null }>("select to_regclass('public.discovery_campaigns')::text as discovery,to_regclass('public.metrics')::text as metrics");
  assert.equal(after.rows[0]?.discovery, null);
  assert.equal(after.rows[0]?.metrics, "metrics");
});

test("migration 0042 fences legacy reservations and preserves charged cached attempts", options, async (t) => {
  const containerName = createContainerName("discovery-schema-0042-upgrade");
  const password = "postgres";
  registerLifoCleanup(t, () => stopPostgres(containerName));
  const port = startPostgres(containerName, password);
  const databaseUrl = `postgresql://postgres:${password}@127.0.0.1:${port}/postgres`;
  await waitForPostgres(containerName, databaseUrl);
  const initial = run("npm", ["run", "migrate", "--", "up", "--database-url", databaseUrl], { cwd: dbRoot, env: { DATABASE_URL: databaseUrl } });
  assert.equal(initial.status, 0, initial.stderr || initial.stdout);
  const before0042 = run("npm", ["run", "migrate", "--", "down", "--database-url", databaseUrl], { cwd: dbRoot, env: { DATABASE_URL: databaseUrl } });
  assert.equal(before0042.status, 0, before0042.stderr || before0042.stdout);
  const db = await connectedPool(t, databaseUrl);
  const legacy = await seedPre0042Attempts(db);

  const upgraded = run("npm", ["run", "migrate", "--", "up", "--database-url", databaseUrl], { cwd: dbRoot, env: { DATABASE_URL: databaseUrl } });
  assert.equal(upgraded.status, 0, upgraded.stderr || upgraded.stdout);
  const attempts = await db.query<{ operation_key: string; outcome: string; model_initial: boolean; model_role: string | null; reserved_worker_id: string | null; reserved_lease_epoch: string | null }>(
    "select operation_key,outcome,model_initial,model_role,reserved_worker_id,reserved_lease_epoch::text as reserved_lease_epoch from discovery_attempts where run_id=$1::uuid order by operation_key",
    [legacy.runId],
  );
  assert.deepEqual(attempts.rows, [
    { operation_key: legacy.analystKey, outcome: "success", model_initial: false, model_role: null, reserved_worker_id: null, reserved_lease_epoch: null },
    { operation_key: legacy.skepticKey, outcome: "unknown", model_initial: false, model_role: null, reserved_worker_id: null, reserved_lease_epoch: null },
  ]);
  const runState = await db.query<{ lease_owner: string | null; lease_epoch: string; expired: boolean; usage: { model: number } }>(
    "select lease_owner,lease_epoch::text as lease_epoch,lease_expires_at <= now() as expired,usage from discovery_runs where run_id=$1::uuid",
    [legacy.runId],
  );
  assert.deepEqual(runState.rows, [{ lease_owner: null, lease_epoch: "8", expired: true, usage: { search: 0, document: 0, identity: 0, financial: 0, model: 2 } }]);

  const repo = createDiscoveryRepository(db, { clock: () => new Date() });
  const oldLease = { run_id: legacy.runId, user_id: legacy.userId, worker_id: "legacy-worker", epoch: 7, expires_at: new Date().toISOString() };
  await assert.rejects(repo.finishAttempt(oldLease, { attempt_id: legacy.reservedAttemptId, outcome: "success", result: { text: "old worker" }, tool_call_id: null }), { code: "lease_lost" });
  const reclaimed = await repo.claimNextRun("recovery-worker");
  assert.ok(reclaimed);
  const operations = createOperationRunner(repo, reclaimed, new AbortController().signal);
  let cacheDispatches = 0;
  const cached = await operations.providerAttempt({
    key: legacy.analystKey,
    request_hash: legacy.analystHash,
    index: 0,
    resource: "model",
    phase: "research",
    candidate_id: legacy.candidateId,
    model_initial: true,
    model_role: "analyst",
    execute: async () => {
      cacheDispatches += 1;
      return { text: "should not dispatch" };
    },
  });
  assert.deepEqual(cached, { text: "legacy cached analyst" });
  assert.equal(cacheDispatches, 0);
  let recoveredDispatches = 0;
  const recovered = await operations.providerAttempt({
    key: legacy.skepticKey,
    request_hash: legacy.skepticHash,
    index: 0,
    resource: "model",
    phase: "research",
    candidate_id: legacy.candidateId,
    execute: async () => {
      recoveredDispatches += 1;
      return { text: "recovered skeptic" };
    },
  });
  assert.deepEqual(recovered, { text: "recovered skeptic" });
  assert.equal(recoveredDispatches, 1);
  const recoveredAttempts = await db.query<{ attempt_number: number; outcome: string }>(
    "select attempt_number,outcome from discovery_attempts where run_id=$1::uuid and operation_key=$2 order by attempt_number",
    [legacy.runId, legacy.skepticKey],
  );
  assert.deepEqual(recoveredAttempts.rows, [{ attempt_number: 1, outcome: "unknown" }, { attempt_number: 2, outcome: "success" }]);
  const chargedUsage = await db.query<{ usage: { model: number } }>("select usage from discovery_runs where run_id=$1::uuid", [legacy.runId]);
  assert.equal(chargedUsage.rows[0]?.usage.model, 3);
});

async function assertDiscoverySchema(db: { query: <T extends Record<string, unknown>>(sql: string, values?: unknown[]) => Promise<{ rows: T[] }> }) {
  const installed = await db.query<{ table_name: string }>("select table_name from information_schema.tables where table_schema='public' and table_name = any($1::text[]) order by table_name", [tables]);
  assert.deepEqual(installed.rows.map((row) => row.table_name), [...tables].sort());
  const indexes = await db.query<{ indexname: string }>("select indexname from pg_indexes where schemaname='public' and tablename in ('discovery_runs','discovery_candidates')");
  const names = new Set(indexes.rows.map((row) => row.indexname));
  for (const expected of ["discovery_request_identity", "discovery_one_active_run_per_user", "discovery_candidate_issuer", "discovery_candidate_lead", "discovery_shortlist_rank"]) assert.equal(names.has(expected), true);
  const attemptColumns = await db.query<{ column_name: string; data_type: string; is_nullable: string }>(
    "select column_name,data_type,is_nullable from information_schema.columns where table_schema='public' and table_name='discovery_attempts' and column_name = any($1::text[]) order by column_name",
    [["model_initial", "model_role", "reserved_worker_id", "reserved_lease_epoch"]],
  );
  assert.deepEqual(attemptColumns.rows, [
    { column_name: "model_initial", data_type: "boolean", is_nullable: "NO" },
    { column_name: "model_role", data_type: "text", is_nullable: "YES" },
    { column_name: "reserved_lease_epoch", data_type: "bigint", is_nullable: "YES" },
    { column_name: "reserved_worker_id", data_type: "text", is_nullable: "YES" },
  ]);
}

async function seedPre0042Attempts(db: { query: <T extends Record<string, unknown>>(sql: string, values?: unknown[]) => Promise<{ rows: T[] }> }) {
  const userId = "10000000-0000-4000-8000-000000000010";
  const campaignId = "20000000-0000-4000-8000-000000000010";
  const briefId = "30000000-0000-4000-8000-000000000010";
  const runId = "40000000-0000-4000-8000-000000000010";
  const candidateId = "50000000-0000-4000-8000-000000000010";
  const reservedAttemptId = "60000000-0000-4000-8000-000000000010";
  const analystKey = `${runId}/research/${candidateId}/analyst`;
  const skepticKey = `${runId}/research/${candidateId}/skeptic`;
  const analystHash = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const skepticHash = "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  await db.query("insert into users (user_id,email,display_name) values ($1::uuid,'legacy-discovery@example.test','Legacy Discovery')", [userId]);
  await db.query("insert into discovery_campaigns (campaign_id,user_id,name,question,current_brief_version) values ($1::uuid,$2::uuid,'Legacy campaign','Which listed company benefits from an existing migration test?',1)", [campaignId, userId]);
  await db.query("insert into discovery_briefs (brief_id,campaign_id,version,brief,content_hash,approved_at) values ($1::uuid,$2::uuid,1,'{}'::jsonb,$3,now())", [briefId, campaignId, analystHash]);
  await db.query(
    `insert into discovery_runs (run_id,campaign_id,user_id,brief_id,request_key,status,stage,policy_version,limits,usage,phase_usage,checkpoint,coverage,lease_owner,lease_epoch,lease_expires_at,started_at)
     values ($1::uuid,$2::uuid,$3::uuid,$4::uuid,'70000000-0000-4000-8000-000000000010'::uuid,'running','research','legacy',
       '{"attempts":{"search":80,"document":100,"identity":100,"financial":100,"model":64},"request_timeout_ms":30000,"run_timeout_ms":2700000}'::jsonb,
       '{"search":0,"document":0,"identity":0,"financial":0,"model":2}'::jsonb,'{}'::jsonb,'{}'::jsonb,'{}'::jsonb,
       'legacy-worker',7,now()+interval '1 hour',now())`,
    [runId, campaignId, userId, briefId],
  );
  await db.query(
    `insert into discovery_candidates (candidate_id,run_id,lead_key,origins,mechanism_ids,lead_hit_ids,reason_codes,first_seen,seed,primary_domain_lead,name,state,selection_ordinal)
     values ($1::uuid,$2::uuid,'legacy-candidate','["web"]'::jsonb,'["00000000-0000-4000-8000-000000000001"]'::jsonb,'[]'::jsonb,'[]'::jsonb,'[0,0]'::jsonb,false,false,'Legacy Candidate','researching',1)`,
    [candidateId, runId],
  );
  await db.query(
    `insert into discovery_attempts (attempt_id,campaign_id,run_id,operation_key,request_hash,attempt_number,resource,phase,candidate_id,model_initial,outcome,result,completed_at)
     values (default,$1::uuid,$2::uuid,$3,$4,1,'model','research',$5::uuid,true,'success','{"text":"legacy cached analyst"}'::jsonb,now()),
            ($8::uuid,$1::uuid,$2::uuid,$6,$7,1,'model','research',$5::uuid,true,'reserved',null,null)`,
    [campaignId, runId, analystKey, analystHash, candidateId, skepticKey, skepticHash, reservedAttemptId],
  );
  return { userId, runId, candidateId, reservedAttemptId, analystKey, skepticKey, analystHash, skepticHash };
}
