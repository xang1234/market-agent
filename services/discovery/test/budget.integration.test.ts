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

test("an interrupted reserved operation becomes unknown and only retries once", dbOptions, async (t) => {
  const { db, repo, createApprovedRun } = await withCampaignDb(t);
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
  const operations = createOperationRunner(repo, lease, new AbortController().signal);
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

test("a restarted model operation dispatches only durable attempt two", dbOptions, async (t) => {
  const { db, repo, createApprovedRun } = await withCampaignDb(t);
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
  const operations = createOperationRunner(repo, lease, new AbortController().signal);
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
    attempt_number: 1,
  });
  assert.equal(skeptic.state, "dispatch");
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
