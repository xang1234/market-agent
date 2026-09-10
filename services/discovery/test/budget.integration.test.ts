import assert from "node:assert/strict";
import test from "node:test";

import { hashJsonValue } from "../../observability/src/tool-call.ts";
import { parseLlmEnv } from "../../llm/src/channel-config.ts";
import { createLlmRouter } from "../../llm/src/router.ts";
import { createCampaignModel } from "../src/model.ts";
import { createOperationRunner } from "../src/operations.ts";
import { dbOptions, withCampaignDb } from "./db-fixture.ts";

test("the last model budget slot dispatches exactly one concurrent operation", dbOptions, async (t) => {
  const { db, repo, createApprovedRun } = await withCampaignDb(t);
  const { run } = await createApprovedRun();
  const lease = await repo.claimNextRun("worker-1");
  assert.ok(lease);
  await db.query("update discovery_runs set usage=jsonb_set(usage,array['model'],to_jsonb(63::int)) where run_id=$1::uuid", [run.run_id]);
  const operations = createOperationRunner(repo, lease, new AbortController().signal);
  let dispatched = 0;
  const execute = async () => {
    dispatched += 1;
    return { text: "provider result" };
  };

  const results = await Promise.allSettled([
    operations.run({
      key: `${run.run_id}/research/pool/model-a`,
      request_hash: hashJsonValue({ operation: "a" }),
      resource: "model",
      phase: "research",
      execute,
    }),
    operations.run({
      key: `${run.run_id}/research/pool/model-b`,
      request_hash: hashJsonValue({ operation: "b" }),
      resource: "model",
      phase: "research",
      execute,
    }),
  ]);

  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(dispatched, 1);
  const usage = await db.query<{ usage: { model: number } }>("select usage from discovery_runs where run_id=$1::uuid", [run.run_id]);
  assert.equal(usage.rows[0]?.usage.model, 64);
});

test("a run deadline includes worker downtime before a reservation", dbOptions, async (t) => {
  const { db, repo, clock, createApprovedRun } = await withCampaignDb(t);
  const { run } = await createApprovedRun();
  const lease = await repo.claimNextRun("worker-1");
  assert.ok(lease);
  clock.advance(2_700_000);
  await db.query(
    "update discovery_runs set lease_expires_at=$2::timestamptz where run_id=$1::uuid",
    [run.run_id, new Date(clock.now().getTime() + 60_000).toISOString()],
  );
  const operations = createOperationRunner(repo, lease, new AbortController().signal);
  let dispatched = 0;

  await assert.rejects(
    operations.run({
      key: `${run.run_id}/discovery/pool/deadline-check`,
      request_hash: hashJsonValue({ operation: "deadline" }),
      resource: "search",
      phase: "discovery",
      execute: async () => {
        dispatched += 1;
        return { hits: [] };
      },
    }),
    { code: "deadline_exceeded" },
  );

  assert.equal(dispatched, 0);
});

test("an interrupted reserved operation becomes unknown only after lease reclamation", dbOptions, async (t) => {
  const { db, repo, clock, createApprovedRun } = await withCampaignDb(t);
  const { run } = await createApprovedRun();
  const lease = await repo.claimNextRun("worker-1");
  assert.ok(lease);
  const key = `${run.run_id}/discovery/pool/interrupted-search`;
  const request_hash = hashJsonValue({ query: "interrupted" });
  await repo.reserveAttempt(lease, {
    operation_key: key,
    request_hash,
    resource: "search",
    phase: "discovery",
    attempt_number: 1,
  });
  clock.advance(90_001);
  const reclaimed = await repo.claimNextRun("worker-2");
  assert.ok(reclaimed);
  const operations = createOperationRunner(repo, reclaimed, new AbortController().signal);
  let dispatched = 0;

  const result = await operations.run({
    key,
    request_hash,
    resource: "search",
    phase: "discovery",
    execute: async () => {
      dispatched += 1;
      return { hits: ["recovered"] };
    },
  });

  assert.deepEqual(result, { hits: ["recovered"] });
  assert.equal(dispatched, 1);
  const attempts = await db.query<{ attempt_number: number; outcome: string }>(
    "select attempt_number,outcome from discovery_attempts where run_id=$1::uuid and operation_key=$2 order by attempt_number",
    [run.run_id, key],
  );
  assert.deepEqual(attempts.rows, [
    { attempt_number: 1, outcome: "unknown" },
    { attempt_number: 2, outcome: "success" },
  ]);
});

test("a duplicate live operation stays in progress and preserves the first result", dbOptions, async (t) => {
  const { db, repo, createApprovedRun } = await withCampaignDb(t);
  const { run } = await createApprovedRun();
  const lease = await repo.claimNextRun("worker-1");
  assert.ok(lease);
  const operations = createOperationRunner(repo, lease, new AbortController().signal);
  const key = `${run.run_id}/discovery/pool/live-search`;
  const request_hash = hashJsonValue({ query: "live duplicate" });
  let dispatched = 0;
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  let started!: () => void;
  const dispatchStarted = new Promise<void>((resolve) => { started = resolve; });

  const first = operations.run({
    key,
    request_hash,
    resource: "search",
    phase: "discovery",
    execute: async () => {
      dispatched += 1;
      started();
      await blocked;
      return { hits: ["first result"] };
    },
  });
  await dispatchStarted;
  const duplicate = operations.run({
    key,
    request_hash,
    resource: "search",
    phase: "discovery",
    execute: async () => {
      dispatched += 1;
      return { hits: ["duplicate result"] };
    },
  });

  const duplicateResult = await Promise.allSettled([duplicate]);
  release();
  const firstResult = await Promise.allSettled([first]);
  assert.equal(dispatched, 1);
  assert.deepEqual(firstResult, [{ status: "fulfilled", value: { hits: ["first result"] } }]);
  assert.equal(duplicateResult[0]?.status, "rejected");
  assert.equal((duplicateResult[0] as PromiseRejectedResult).reason.code, "operation_in_progress");
  const attempts = await db.query<{ attempt_number: number; outcome: string; result: unknown }>(
    "select attempt_number,outcome,result from discovery_attempts where run_id=$1::uuid and operation_key=$2",
    [run.run_id, key],
  );
  assert.deepEqual(attempts.rows, [{ attempt_number: 1, outcome: "success", result: { hits: ["first result"] } }]);
});

test("a restarted model operation dispatches only durable attempt two", dbOptions, async (t) => {
  const { db, repo, clock, createApprovedRun } = await withCampaignDb(t);
  const { run } = await createApprovedRun();
  const lease = await repo.claimNextRun("worker-1");
  assert.ok(lease);
  const key = `${run.run_id}/discovery/pool/restarted-planner`;
  const request_hash = hashJsonValue({ role: "planner", request: "restart" });
  await repo.reserveAttempt(lease, {
    operation_key: key,
    request_hash,
    resource: "model",
    phase: "discovery",
    attempt_number: 1,
  });
  clock.advance(90_001);
  const reclaimed = await repo.claimNextRun("worker-2");
  assert.ok(reclaimed);
  const operations = createOperationRunner(repo, reclaimed, new AbortController().signal);
  let dispatched = 0;

  const result = await operations.providerAttempt({
    key,
    request_hash,
    index: 0,
    resource: "model",
    phase: "discovery",
    execute: async () => {
      dispatched += 1;
      return { text: "recovered" };
    },
  });

  assert.deepEqual(result, { text: "recovered" });
  assert.equal(dispatched, 1);
  const attempts = await db.query<{ attempt_number: number; outcome: string }>(
    "select attempt_number,outcome from discovery_attempts where run_id=$1::uuid and operation_key=$2 order by attempt_number",
    [run.run_id, key],
  );
  assert.deepEqual(attempts.rows, [
    { attempt_number: 1, outcome: "unknown" },
    { attempt_number: 2, outcome: "success" },
  ]);
});

test("a model fallback consumes two durable provider budget units", dbOptions, async (t) => {
  const { db, repo, createApprovedRun } = await withCampaignDb(t);
  const { run } = await createApprovedRun();
  const lease = await repo.claimNextRun("worker-1");
  assert.ok(lease);
  const operations = createOperationRunner(repo, lease, new AbortController().signal);
  let dispatched = 0;
  const model = createCampaignModel(createLlmRouter({
    settings: modelSettings(),
    client: async () => {
      dispatched += 1;
      if (dispatched === 1) throw new Error("temporary provider failure");
      return { text: "fallback response" };
    },
  }), operations);

  const result = await model.complete({
    operation_key: `${run.run_id}/discovery/pool/planner`,
    request_hash: hashJsonValue({ role: "planner", request: "bounded" }),
    role: "planner",
    phase: "discovery",
    messages: [{ role: "user", content: "Create the bounded plan." }],
  });

  assert.equal(result.text, "fallback response");
  assert.equal(dispatched, 2);
  const usage = await db.query<{ usage: { model: number } }>("select usage from discovery_runs where run_id=$1::uuid", [run.run_id]);
  assert.equal(usage.rows[0]?.usage.model, 2);
});

test("a failed provider attempt remains charged and a completed operation returns its cache", dbOptions, async (t) => {
  const { db, repo, createApprovedRun } = await withCampaignDb(t);
  const { run } = await createApprovedRun();
  const lease = await repo.claimNextRun("worker-1");
  assert.ok(lease);
  const operations = createOperationRunner(repo, lease, new AbortController().signal);
  const failedKey = `${run.run_id}/discovery/pool/failing-model`;

  await assert.rejects(operations.providerAttempt({
    key: failedKey,
    request_hash: hashJsonValue({ operation: "failing model" }),
    index: 0,
    resource: "model",
    phase: "discovery",
    execute: async () => { throw new Error("provider failure after reservation"); },
  }));

  const cachedKey = `${run.run_id}/discovery/pool/cached-search`;
  const cachedHash = hashJsonValue({ operation: "cached search" });
  let dispatched = 0;
  const first = await operations.run({
    key: cachedKey,
    request_hash: cachedHash,
    resource: "search",
    phase: "discovery",
    execute: async () => {
      dispatched += 1;
      return { hits: ["first result"] };
    },
  });
  const resumed = await operations.run({
    key: cachedKey,
    request_hash: cachedHash,
    resource: "search",
    phase: "discovery",
    execute: async () => {
      dispatched += 1;
      return { hits: ["should not dispatch"] };
    },
  });

  assert.deepEqual(first, { hits: ["first result"] });
  assert.deepEqual(resumed, { hits: ["first result"] });
  assert.equal(dispatched, 1);
  const attempts = await db.query<{ resource: string; outcome: string }>(
    "select resource,outcome from discovery_attempts where run_id=$1::uuid and operation_key=$2",
    [run.run_id, failedKey],
  );
  assert.deepEqual(attempts.rows, [{ resource: "model", outcome: "error" }]);
  const usage = await db.query<{ usage: { model: number; search: number } }>("select usage from discovery_runs where run_id=$1::uuid", [run.run_id]);
  assert.deepEqual(usage.rows[0]?.usage, { search: 1, document: 0, identity: 0, financial: 0, model: 1 });
});

test("optional model calls preserve initial analyst and skeptic slots for selected companies", dbOptions, async (t) => {
  const { db, repo, createApprovedRun } = await withCampaignDb(t);
  const { run } = await createApprovedRun();
  const lease = await repo.claimNextRun("worker-1");
  assert.ok(lease);
  const candidateId = crypto.randomUUID();
  await repo.admitCandidate(lease, {
    candidate_id: candidateId,
    lead_key: "floor-candidate",
    name: "Floor Candidate",
    identity: null,
    origins: ["web"],
    mechanism_ids: ["40000000-0000-4000-8000-000000000001"],
    seed: false,
    primary_domain_lead: false,
    first_seen: [0, 0],
    lead_hit_ids: [],
    reason_codes: [],
  });
  await repo.commitCohort(lease, [candidateId], {} as never);
  await db.query("update discovery_runs set usage=jsonb_set(usage,array['model'],to_jsonb(62::int)) where run_id=$1::uuid", [run.run_id]);

  await assert.rejects(repo.reserveAttempt(lease, {
    operation_key: `${run.run_id}/verification/pool/summary`,
    request_hash: hashJsonValue({ operation: "optional summary" }),
    resource: "model",
    phase: "verification",
    attempt_number: 1,
  }), { code: "budget_exhausted" });

  const analyst = await repo.reserveAttempt(lease, {
    operation_key: `${run.run_id}/research/${candidateId}/analyst`,
    request_hash: hashJsonValue({ operation: "analyst" }),
    resource: "model",
    phase: "research",
    candidate_id: candidateId,
    model_initial: true,
    model_role: "analyst",
    attempt_number: 1,
  });
  assert.equal(analyst.state, "dispatch");
  await assert.rejects(repo.reserveAttempt(lease, {
    operation_key: `${run.run_id}/verification/pool/summary-after-analyst`,
    request_hash: hashJsonValue({ operation: "optional summary after analyst" }),
    resource: "model",
    phase: "verification",
    attempt_number: 1,
  }), { code: "budget_exhausted" });
  const skeptic = await repo.reserveAttempt(lease, {
    operation_key: `${run.run_id}/research/${candidateId}/skeptic`,
    request_hash: hashJsonValue({ operation: "skeptic" }),
    resource: "model",
    phase: "research",
    candidate_id: candidateId,
    model_initial: true,
    model_role: "skeptic",
    attempt_number: 1,
  });
  assert.equal(skeptic.state, "dispatch");
  const usage = await db.query<{ usage: { model: number } }>("select usage from discovery_runs where run_id=$1::uuid", [run.run_id]);
  assert.equal(usage.rows[0]?.usage.model, 64);
});

test("initial model slots are unique to each selected candidate and role", dbOptions, async (t) => {
  const { db, repo, createApprovedRun } = await withCampaignDb(t);
  const { run } = await createApprovedRun();
  const lease = await repo.claimNextRun("worker-1");
  assert.ok(lease);
  const candidateA = crypto.randomUUID();
  const candidateB = crypto.randomUUID();
  for (const [candidate_id, lead_key, name] of [[candidateA, "floor-a", "Floor A"], [candidateB, "floor-b", "Floor B"]] as const) {
    await repo.admitCandidate(lease, {
      candidate_id,
      lead_key,
      name,
      identity: null,
      origins: ["web"],
      mechanism_ids: ["40000000-0000-4000-8000-000000000001"],
      seed: false,
      primary_domain_lead: false,
      first_seen: [0, 0],
      lead_hit_ids: [],
      reason_codes: [],
    });
  }
  await repo.commitCohort(lease, [candidateA, candidateB], {} as never);
  await db.query("update discovery_runs set usage=jsonb_set(usage,array['model'],to_jsonb(60::int)) where run_id=$1::uuid", [run.run_id]);

  for (const model_role of ["analyst", "skeptic"] as const) {
    const reserved = await repo.reserveAttempt(lease, {
      operation_key: `${run.run_id}/research/${candidateA}/${model_role}`,
      request_hash: hashJsonValue({ candidate: candidateA, model_role }),
      resource: "model",
      phase: "research",
      candidate_id: candidateA,
      model_initial: true,
      model_role,
      attempt_number: 1,
    });
    assert.equal(reserved.state, "dispatch");
  }
  for (const model_role of ["analyst", "skeptic"] as const) {
    await assert.rejects(repo.reserveAttempt(lease, {
      operation_key: `${run.run_id}/research/${candidateA}/duplicate-${model_role}`,
      request_hash: hashJsonValue({ candidate: candidateA, model_role, duplicate: true }),
      resource: "model",
      phase: "research",
      candidate_id: candidateA,
      model_initial: true,
      model_role,
      attempt_number: 1,
    }), { code: "request_conflict" });
  }
  for (const model_role of ["analyst", "skeptic"] as const) {
    const reserved = await repo.reserveAttempt(lease, {
      operation_key: `${run.run_id}/research/${candidateB}/${model_role}`,
      request_hash: hashJsonValue({ candidate: candidateB, model_role }),
      resource: "model",
      phase: "research",
      candidate_id: candidateB,
      model_initial: true,
      model_role,
      attempt_number: 1,
    });
    assert.equal(reserved.state, "dispatch");
  }
  const usage = await db.query<{ usage: { model: number } }>("select usage from discovery_runs where run_id=$1::uuid", [run.run_id]);
  assert.equal(usage.rows[0]?.usage.model, 64);
});

test("each metered operation dispatch receives a cancellable request-timeout signal", dbOptions, async (t) => {
  const { db, repo, createApprovedRun } = await withCampaignDb(t);
  const { run } = await createApprovedRun();
  const lease = await repo.claimNextRun("worker-1");
  assert.ok(lease);
  await db.query(
    "update discovery_runs set limits=jsonb_set(limits,array['request_timeout_ms'],to_jsonb(1::int)) where run_id=$1::uuid",
    [run.run_id],
  );
  const operations = createOperationRunner(repo, lease, new AbortController().signal);

  await assert.rejects(
    operations.run({
      key: `${run.run_id}/discovery/pool/timed-search`,
      request_hash: hashJsonValue({ operation: "timed search" }),
      resource: "search",
      phase: "discovery",
      execute: async ({ signal }) => new Promise((_, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      }),
    }),
    (error) => error instanceof DOMException && error.name === "TimeoutError",
  );

  const attempts = await db.query<{ attempt_number: number; outcome: string }>(
    "select attempt_number,outcome from discovery_attempts where run_id=$1::uuid and operation_key=$2 order by attempt_number",
    [run.run_id, `${run.run_id}/discovery/pool/timed-search`],
  );
  assert.deepEqual(attempts.rows, [
    { attempt_number: 1, outcome: "error" },
    { attempt_number: 2, outcome: "error" },
  ]);
});

test("a research error releases only its unreserved initial model floor slots", dbOptions, async (t) => {
  const { db, repo, createApprovedRun } = await withCampaignDb(t);
  const { run } = await createApprovedRun();
  const lease = await repo.claimNextRun("worker-1");
  assert.ok(lease);
  const candidateId = crypto.randomUUID();
  await repo.admitCandidate(lease, {
    candidate_id: candidateId,
    lead_key: "failed-candidate",
    name: "Failed Candidate",
    identity: null,
    origins: ["web"],
    mechanism_ids: ["40000000-0000-4000-8000-000000000001"],
    seed: false,
    primary_domain_lead: false,
    first_seen: [0, 0],
    lead_hit_ids: [],
    reason_codes: [],
  });
  await repo.commitCohort(lease, [candidateId], {} as never);
  await db.query("update discovery_runs set usage=jsonb_set(usage,array['model'],to_jsonb(62::int)) where run_id=$1::uuid", [run.run_id]);
  await repo.reserveAttempt(lease, {
    operation_key: `${run.run_id}/research/${candidateId}/analyst`,
    request_hash: hashJsonValue({ operation: "initial analyst" }),
    resource: "model",
    phase: "research",
    candidate_id: candidateId,
    model_initial: true,
    model_role: "analyst",
    attempt_number: 1,
  });
  await repo.failCandidate(lease, candidateId, "acquisition_failed");
  const optional = await repo.reserveAttempt(lease, {
    operation_key: `${run.run_id}/verification/pool/summary`,
    request_hash: hashJsonValue({ operation: "summary after acquisition failure" }),
    resource: "model",
    phase: "verification",
    attempt_number: 1,
  });

  assert.equal(optional.state, "dispatch");
  const usage = await db.query<{ usage: { model: number } }>("select usage from discovery_runs where run_id=$1::uuid", [run.run_id]);
  assert.equal(usage.rows[0]?.usage.model, 64);
});

function modelSettings() {
  return parseLlmEnv({
    LLM_CHANNELS: "openai,deepseek",
    LLM_OPENAI_PROTOCOL: "openai",
    LLM_OPENAI_API_KEY: "sk-openai",
    LLM_OPENAI_MODELS: "gpt-4.1",
    LLM_DEEPSEEK_PROTOCOL: "openai-compatible",
    LLM_DEEPSEEK_BASE_URL: "https://api.deepseek.com/v1",
    LLM_DEEPSEEK_API_KEY: "ds-key",
    LLM_DEEPSEEK_MODELS: "deepseek-chat",
    LITELLM_MODEL: "openai/gpt-4.1",
    LITELLM_FALLBACK_MODELS: "deepseek/deepseek-chat",
  });
}
