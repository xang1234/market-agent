import assert from "node:assert/strict";
import test from "node:test";

import { hashJsonValue } from "../../observability/src/tool-call.ts";
import { briefFixture, identityFixture } from "./fixtures.ts";
import { dbOptions, withCampaignDb } from "./db-fixture.ts";

test("a stale editor cannot replace an approved brief", dbOptions, async (t) => {
  const { repo, createApprovedRun, userId } = await withCampaignDb(t);
  const { campaign, brief } = await createApprovedRun();
  await repo.saveBrief(userId, campaign.campaign_id, brief.version, brief.brief);
  await assert.rejects(
    repo.saveBrief(userId, campaign.campaign_id, brief.version, brief.brief),
    { code: "stale_brief" },
  );
  assert.deepEqual((await repo.getBrief(userId, brief.brief_id)).brief, brief.brief);
});

test("starts are idempotent per request and serialize active work per user", dbOptions, async (t) => {
  const { repo, userId } = await withCampaignDb(t);
  const first = await repo.createCampaign(userId, { name: "First", question: "Which US-listed companies benefit from grid modernization spending?" });
  const second = await repo.createCampaign(userId, { name: "Second", question: "Which US-listed companies benefit from grid modernization spending?" });
  const firstBrief = await repo.saveBrief(userId, first.campaign_id, 0, briefFixture());
  const secondBrief = await repo.saveBrief(userId, second.campaign_id, 0, briefFixture());
  const requestKey = crypto.randomUUID();
  const started = await repo.startRun(userId, first.campaign_id, { brief_version: firstBrief.version, brief_hash: firstBrief.hash, request_key: requestKey });
  const repeated = await repo.startRun(userId, first.campaign_id, { brief_version: firstBrief.version, brief_hash: firstBrief.hash, request_key: requestKey });
  assert.equal(repeated.run_id, started.run_id);
  await assert.rejects(
    repo.startRun(userId, first.campaign_id, { brief_version: firstBrief.version, brief_hash: hashJsonValue({ changed: true }), request_key: requestKey }),
    { code: "request_conflict" },
  );
  await assert.rejects(
    repo.startRun(userId, second.campaign_id, { brief_version: secondBrief.version, brief_hash: secondBrief.hash, request_key: crypto.randomUUID() }),
    { code: "active_run" },
  );
});

test("concurrent starts across campaigns allow one active run", dbOptions, async (t) => {
  const { repo, userId } = await withCampaignDb(t);
  const first = await repo.createCampaign(userId, { name: "First", question: "Which US-listed companies benefit from grid modernization spending?" });
  const second = await repo.createCampaign(userId, { name: "Second", question: "Which US-listed companies benefit from grid modernization spending?" });
  const [firstBrief, secondBrief] = await Promise.all([
    repo.saveBrief(userId, first.campaign_id, 0, briefFixture()),
    repo.saveBrief(userId, second.campaign_id, 0, briefFixture()),
  ]);
  const results = await Promise.allSettled([
    repo.startRun(userId, first.campaign_id, { brief_version: firstBrief.version, brief_hash: firstBrief.hash, request_key: crypto.randomUUID() }),
    repo.startRun(userId, second.campaign_id, { brief_version: secondBrief.version, brief_hash: secondBrief.hash, request_key: crypto.randomUUID() }),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const rejected = results.find((result) => result.status === "rejected");
  assert.ok(rejected && rejected.reason.code === "active_run");
});

test("run starts reject stale versions and foreign ownership", dbOptions, async (t) => {
  const { repo, createApprovedRun, userId, otherUserId } = await withCampaignDb(t);
  const { campaign, brief } = await createApprovedRun();
  await assert.rejects(repo.getCampaign(otherUserId, campaign.campaign_id), { code: "not_found" });
  await assert.rejects(
    repo.startRun(userId, campaign.campaign_id, { brief_version: brief.version, brief_hash: hashJsonValue({ stale: true }), request_key: crypto.randomUUID() }),
    { code: "stale_brief" },
  );
});

test("candidate admission caps at one hundred", dbOptions, async (t) => {
  const { repo, createApprovedRun } = await withCampaignDb(t);
  const { run } = await createApprovedRun();
  const lease = await repo.claimNextRun("worker-1");
  assert.ok(lease);
  for (let index = 0; index < 100; index += 1) {
    await repo.admitCandidate(lease, {
      candidate_id: crypto.randomUUID(), lead_key: `lead-${index}`, name: `Lead ${index}`, identity: null,
      origins: ["web"], mechanism_ids: ["40000000-0000-4000-8000-000000000001"], seed: false,
      primary_domain_lead: false, first_seen: [index, 0], lead_hit_ids: [], reason_codes: [],
    });
  }
  await assert.rejects(repo.admitCandidate(lease, {
    candidate_id: crypto.randomUUID(), lead_key: "over-limit", name: "Over limit", identity: null,
    origins: ["web"], mechanism_ids: ["40000000-0000-4000-8000-000000000001"], seed: false,
    primary_domain_lead: false, first_seen: [101, 0], lead_hit_ids: [], reason_codes: [],
  }), { code: "budget_exhausted" });
  assert.equal((await repo.candidates(lease.user_id, run.run_id)).length, 100);
});

test("candidate admission merges a duplicate resolved issuer", dbOptions, async (t) => {
  const { db, repo, createApprovedRun } = await withCampaignDb(t);
  const { run } = await createApprovedRun();
  const identity = identityFixture();
  const instrumentId = "82000000-0000-4000-8000-000000000001";
  await db.query("insert into issuers (issuer_id,legal_name,former_names) values ($1::uuid,$2,'[]'::jsonb)", [identity.issuer_id, identity.legal_name]);
  await db.query("insert into instruments (instrument_id,issuer_id,asset_type) values ($1::uuid,$2::uuid,'common_stock')", [instrumentId, identity.issuer_id]);
  await db.query("insert into listings (listing_id,instrument_id,mic,ticker,trading_currency,timezone) values ($1::uuid,$2::uuid,$3,$4,$5,'America/New_York')", [identity.listing_id, instrumentId, identity.mic, identity.ticker, identity.currency]);
  const lease = await repo.claimNextRun("worker-1"); assert.ok(lease);
  const base = { identity, origins: ["web"] as const, mechanism_ids: ["40000000-0000-4000-8000-000000000001"], seed: false, primary_domain_lead: false, first_seen: [0, 0] as [number, number], lead_hit_ids: [], reason_codes: ["first"] };
  await repo.admitCandidate(lease, { ...base, candidate_id: crypto.randomUUID(), lead_key: "first", name: identity.legal_name });
  await repo.admitCandidate(lease, { ...base, candidate_id: crypto.randomUUID(), lead_key: "second", name: identity.legal_name, origins: ["seed"], mechanism_ids: ["40000000-0000-4000-8000-000000000002"], reason_codes: ["second"] });
  const candidates = await repo.candidates(lease.user_id, run.run_id);
  assert.equal(candidates.length, 1);
  assert.deepEqual(candidates[0]?.origins.sort(), ["seed", "web"]);
  assert.deepEqual(candidates[0]?.mechanism_ids.sort(), ["40000000-0000-4000-8000-000000000001", "40000000-0000-4000-8000-000000000002"]);
});

test("brief saves reject an unregistered metric key", dbOptions, async (t) => {
  const { repo, userId } = await withCampaignDb(t);
  const campaign = await repo.createCampaign(userId, { name: "Metrics", question: "Which US-listed companies benefit from grid modernization spending?" });
  const brief = briefFixture();
  brief.criteria[0]!.metric = { metric_key: "not_registered", unit: "ratio", period_kind: "fiscal_q", operator: "gte", threshold: 0.1, max_age_days: 90 };
  await assert.rejects(repo.saveBrief(userId, campaign.campaign_id, 0, brief), { code: "validation" });
});

test("lease writes reject an epoch mismatch", dbOptions, async (t) => {
  const { repo, createApprovedRun } = await withCampaignDb(t);
  await createApprovedRun();
  const lease = await repo.claimNextRun("worker-1");
  assert.ok(lease);
  await assert.rejects(
    repo.saveCheckpoint({ ...lease, epoch: lease.epoch + 1 }, { version: 1, stage: "discovery", cohort: [], next_company: 0, completed_operation_keys: [] }),
    { code: "lease_lost" },
  );
});

test("attempt reservations cache matching results and event sequences are monotonic", dbOptions, async (t) => {
  const { repo, createApprovedRun } = await withCampaignDb(t);
  const { run } = await createApprovedRun();
  const lease = await repo.claimNextRun("worker-1"); assert.ok(lease);
  const key = `${run.run_id}/discovery/pool/search`;
  const requestHash = hashJsonValue({ query: "grid suppliers" });
  const reserved = await repo.reserveAttempt(lease, { operation_key: key, request_hash: requestHash, resource: "search", phase: "discovery", attempt_number: 1 });
  assert.equal(reserved.state, "dispatch");
  await repo.finishAttempt(lease, { attempt_id: reserved.attempt_id, outcome: "success", result: { hits: 2 }, tool_call_id: null });
  const cached = await repo.reserveAttempt(lease, { operation_key: key, request_hash: requestHash, resource: "search", phase: "discovery", attempt_number: 1 });
  assert.deepEqual(cached, { attempt_id: reserved.attempt_id, attempt_number: 1, state: "cached", result: { hits: 2 } });
  await assert.rejects(repo.reserveAttempt(lease, { operation_key: key, request_hash: hashJsonValue({ query: "changed" }), resource: "search", phase: "discovery", attempt_number: 1 }), { code: "request_conflict" });
  await repo.appendEvent(lease, { stage: "discovery", kind: "search_completed", candidate_id: null, summary: "Completed the first bounded search.", citations: [] });
  await repo.appendEvent(lease, { stage: "discovery", kind: "budget_exhausted", candidate_id: null, summary: "A bounded resource limit was reached.", citations: [] });
  const events = await repo.events(lease.user_id, run.run_id, 0, 100);
  assert.deepEqual(events.items.map((event) => event.sequence), [1, 2]);
  assert.equal(events.next_sequence, 2);
});
