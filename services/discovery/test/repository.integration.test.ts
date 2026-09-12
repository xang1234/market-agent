import assert from "node:assert/strict";
import test from "node:test";

import { hashJsonValue } from "../../observability/src/tool-call.ts";
import type { Origin, RankedDecision } from "../src/types.ts";
import { briefFixture, identityFixture } from "./fixtures.ts";
import { dbOptions, withCampaignDb } from "./db-fixture.ts";

function rankedDecision(candidateId: string, state: RankedDecision["state"], rank: number | null): RankedDecision {
  const unknown = { level: "unknown" as const, explanation: "Unavailable", citations: [] };
  return {
    candidate_id: candidateId, identity: identityFixture(), state, rank,
    dimensions: { theme_exposure: unknown, evidence_strength: unknown, business_quality: unknown, valuation_context: unknown },
    criteria: [], counterarguments: [], unresolved_questions: [], next_action: "Review", reason_codes: [],
  };
}

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

test("unresolved admissions remain visible without entering research selection", dbOptions, async (t) => {
  const { repo, createApprovedRun } = await withCampaignDb(t);
  const { run } = await createApprovedRun();
  const lease = await repo.claimNextRun("worker-1");
  assert.ok(lease);
  const unresolved = {
    candidate_id: crypto.randomUUID(), lead_key: "unresolved", name: "Unresolved lead", identity: null,
    origins: ["web"], mechanism_ids: ["40000000-0000-4000-8000-000000000001"], seed: false,
    primary_domain_lead: false, first_seen: [0, 0], lead_hit_ids: [], reason_codes: ["identity_unresolved"],
  } as const;
  await repo.admitCandidate(lease, unresolved);
  await repo.admitCandidate(lease, unresolved);

  const candidates = await repo.candidates(lease.user_id, run.run_id);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.state, "unresolved_identity");
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
  const base = { identity, origins: ["web"] as Origin[], mechanism_ids: ["40000000-0000-4000-8000-000000000001"], seed: false, primary_domain_lead: false, first_seen: [0, 0] as [number, number], lead_hit_ids: [], reason_codes: ["first"] };
  await repo.admitCandidate(lease, { ...base, candidate_id: crypto.randomUUID(), lead_key: "first", name: identity.legal_name });
  await repo.admitCandidate(lease, { ...base, candidate_id: crypto.randomUUID(), lead_key: "second", name: identity.legal_name, origins: ["seed"], mechanism_ids: ["40000000-0000-4000-8000-000000000002"], reason_codes: ["second"] });
  const candidates = await repo.candidates(lease.user_id, run.run_id);
  assert.equal(candidates.length, 1);
  assert.deepEqual(candidates[0]?.origins.sort(), ["seed", "web"]);
  assert.deepEqual(candidates[0]?.mechanism_ids.sort(), ["40000000-0000-4000-8000-000000000001", "40000000-0000-4000-8000-000000000002"]);
});

test("cohort commit leaves unresolved rows visible and marks other resolved rows not selected", dbOptions, async (t) => {
  const { db, repo, createApprovedRun } = await withCampaignDb(t);
  const { run } = await createApprovedRun();
  const selectedIdentity = identityFixture(10);
  const unselectedIdentity = identityFixture(11);
  for (const identity of [selectedIdentity, unselectedIdentity]) {
    const instrumentId = crypto.randomUUID();
    await db.query("insert into issuers (issuer_id,legal_name,former_names) values ($1::uuid,$2,'[]'::jsonb)", [identity.issuer_id, identity.legal_name]);
    await db.query("insert into instruments (instrument_id,issuer_id,asset_type) values ($1::uuid,$2::uuid,'common_stock')", [instrumentId, identity.issuer_id]);
    await db.query("insert into listings (listing_id,instrument_id,mic,ticker,trading_currency,timezone) values ($1::uuid,$2::uuid,$3,$4,$5,'America/New_York')", [identity.listing_id, instrumentId, identity.mic, identity.ticker, identity.currency]);
  }
  const lease = await repo.claimNextRun("worker-1");
  assert.ok(lease);
  const selectedId = crypto.randomUUID();
  const unselectedId = crypto.randomUUID();
  const unresolvedId = crypto.randomUUID();
  const base = { origins: ["web"] as Origin[], mechanism_ids: ["40000000-0000-4000-8000-000000000001"], seed: false, primary_domain_lead: false, first_seen: [0, 0] as [number, number], lead_hit_ids: [], reason_codes: [] };
  await repo.admitCandidate(lease, { ...base, candidate_id: selectedId, lead_key: "selected", name: selectedIdentity.legal_name, identity: selectedIdentity });
  await repo.admitCandidate(lease, { ...base, candidate_id: unselectedId, lead_key: "unselected", name: unselectedIdentity.legal_name, identity: unselectedIdentity });
  await repo.admitCandidate(lease, { ...base, candidate_id: unresolvedId, lead_key: "unresolved", name: "Unresolved", identity: null });

  await repo.commitCohort(lease, [selectedId], {} as never);

  const states = new Map((await repo.candidates(lease.user_id, run.run_id)).map((candidate) => [candidate.candidate_id, candidate.state]));
  assert.equal(states.get(selectedId), "researching");
  assert.equal(states.get(unselectedId), "not_selected");
  assert.equal(states.get(unresolvedId), "unresolved_identity");
  await assert.rejects(repo.commitCohort(lease, [unselectedId], {} as never), { code: "request_conflict" });
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

test("attempt request identity spans both provider attempts", dbOptions, async (t) => {
  const { repo, createApprovedRun } = await withCampaignDb(t);
  const { run } = await createApprovedRun();
  const lease = await repo.claimNextRun("worker-1"); assert.ok(lease);
  const key = `${run.run_id}/discovery/pool/search`;
  const firstHash = hashJsonValue({ query: "grid suppliers" });
  const first = await repo.reserveAttempt(lease, { operation_key: key, request_hash: firstHash, resource: "search", phase: "discovery", attempt_number: 1 });
  await repo.finishAttempt(lease, { attempt_id: first.attempt_id, outcome: "error", result: { retry: true }, tool_call_id: null });
  await assert.rejects(
    repo.reserveAttempt(lease, { operation_key: key, request_hash: hashJsonValue({ query: "changed suppliers" }), resource: "search", phase: "discovery", attempt_number: 2 }),
    { code: "request_conflict" },
  );
  assert.equal((await repo.reserveAttempt(lease, { operation_key: key, request_hash: firstHash, resource: "search", phase: "discovery", attempt_number: 2 })).state, "dispatch");
});

test("search allocations are atomic and retries consume verification capacity", dbOptions, async (t) => {
  const { db, repo, createApprovedRun } = await withCampaignDb(t);
  const { run } = await createApprovedRun();
  const lease = await repo.claimNextRun("worker-1"); assert.ok(lease);
  const reserveDiscovery = (index: number) => repo.reserveAttempt(lease, {
    operation_key: `${run.run_id}/discovery/pool/search-discovery-${index}`,
    request_hash: hashJsonValue({ index, phase: "discovery" }), resource: "search", phase: "discovery", attempt_number: 1,
  });
  const reserveRetry = (index: number) => repo.reserveAttempt(lease, {
    operation_key: `${run.run_id}/discovery/pool/search-retry-${index}`,
    request_hash: hashJsonValue({ index, phase: "retry" }), resource: "search", phase: "discovery", attempt_number: 2,
  });
  for (let index = 0; index < 20; index += 1) await reserveDiscovery(index);
  await assert.rejects(reserveDiscovery(20), { code: "budget_exhausted" });
  for (let index = 0; index < 10; index += 1) await reserveRetry(index);
  await assert.rejects(reserveRetry(10), { code: "budget_exhausted" });
  const usage = await db.query<{ usage: { search: number }; phase_usage: { search: { discovery: number; verification: number } } }>("select usage,phase_usage from discovery_runs where run_id=$1::uuid", [run.run_id]);
  assert.equal(usage.rows[0]?.usage.search, 30);
  assert.deepEqual(usage.rows[0]?.phase_usage.search, { discovery: 20, research: 0, verification: 10 });
});

test("finalization rejects incomplete shortlist ranks and missing candidates", dbOptions, async (t) => {
  const { repo, createApprovedRun } = await withCampaignDb(t);
  const { run } = await createApprovedRun();
  const lease = await repo.claimNextRun("worker-1"); assert.ok(lease);
  const candidateId = crypto.randomUUID();
  await repo.admitCandidate(lease, {
    candidate_id: candidateId, lead_key: "ranked", name: "Ranked candidate", identity: null, origins: ["web"],
    mechanism_ids: ["40000000-0000-4000-8000-000000000001"], seed: false, primary_domain_lead: false,
    first_seen: [0, 0], lead_hit_ids: [], reason_codes: [],
  });
  const decision = rankedDecision(candidateId, "shortlisted", 3);
  await assert.rejects(repo.finalize(lease, { status: "completed", decisions: [decision], coverage: {} as never }), { code: "validation" });
  await assert.rejects(repo.finalize(lease, {
    status: "completed",
    decisions: [{ ...decision, candidate_id: crypto.randomUUID(), rank: 1 }],
    coverage: {} as never,
  }), { code: "not_found" });
});

test("finalization assigns ranks only to shortlisted candidates", dbOptions, async (t) => {
  const { repo, createApprovedRun } = await withCampaignDb(t);
  await createApprovedRun();
  const lease = await repo.claimNextRun("worker-1"); assert.ok(lease);
  const candidateId = crypto.randomUUID();
  await assert.rejects(repo.finalize(lease, { status: "completed", decisions: [rankedDecision(candidateId, "excluded", 1)], coverage: {} as never }), { code: "validation" });
  await assert.rejects(repo.finalize(lease, { status: "completed", decisions: [rankedDecision(candidateId, "shortlisted", null)], coverage: {} as never }), { code: "validation" });
});

test("draft rate limits count logical request IDs rather than provider attempts", dbOptions, async (t) => {
  const { repo, userId } = await withCampaignDb(t);
  const campaign = await repo.createCampaign(userId, { name: "Draft rate", question: "Which US-listed companies benefit from grid modernization spending?" });
  const firstRequest = crypto.randomUUID();
  for (const requestId of [firstRequest, firstRequest, crypto.randomUUID(), crypto.randomUUID()]) {
    const draft = await repo.acquireDraft(userId, campaign.campaign_id, requestId);
    await repo.releaseDraft(userId, campaign.campaign_id, draft.draft_token);
  }
  await assert.rejects(repo.acquireDraft(userId, campaign.campaign_id, crypto.randomUUID()), { code: "draft_rate_limit" });
});
