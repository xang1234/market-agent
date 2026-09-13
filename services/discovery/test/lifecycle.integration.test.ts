import assert from "node:assert/strict";
import test from "node:test";

import { deleteUserAndQueueObjectBlobsWithPool } from "../../evidence/src/blob-gc-repo.ts";
import { createDiscoveryReadModel } from "../src/read-model.ts";
import { createDiscoveryService } from "../src/service.ts";
import { dbOptions, withCampaignDb } from "./db-fixture.ts";
import { createRunnerHarness } from "./runner-harness.ts";

test("campaign deletion removes queued campaign rows and its source-derived attempt records", dbOptions, async (t) => {
  const { db, repo, userId, createApprovedRun } = await withCampaignDb(t);
  const { campaign, run } = await createApprovedRun();
  await db.query(
    `insert into discovery_attempts (campaign_id,run_id,operation_key,request_hash,attempt_number,resource,phase,outcome)
     values ($1::uuid,$2::uuid,'queued-source-derived','sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',1,'model','draft','success')`,
    [campaign.campaign_id, run.run_id],
  );
  await repo.deleteCampaign(userId, campaign.campaign_id);
  assert.equal((await db.query("select 1 from discovery_campaigns where campaign_id=$1::uuid", [campaign.campaign_id])).rowCount, 0);
  assert.equal((await db.query("select 1 from discovery_attempts where run_id=$1::uuid", [run.run_id])).rowCount, 0);
  assert.equal((await db.query("select 1 from discovery_events where run_id=$1::uuid", [run.run_id])).rowCount, 0);
  assert.equal((await db.query("select 1 from discovery_candidates where run_id=$1::uuid", [run.run_id])).rowCount, 0, "candidate role outputs and research packets cascade with their run");
});

test("campaign deletion refuses a run with a live lease", dbOptions, async (t) => {
  const { repo, userId, createApprovedRun } = await withCampaignDb(t);
  const { campaign } = await createApprovedRun();
  assert.ok(await repo.claimNextRun("still-live"));
  await assert.rejects(repo.deleteCampaign(userId, campaign.campaign_id), { code: "active_run" });
});

test("a queued run reports worker waiting only when it is strictly older than ninety seconds", dbOptions, async (t) => {
  const { db, repo, userId, clock, createApprovedRun } = await withCampaignDb(t);
  const { run } = await createApprovedRun();
  await db.query("update discovery_runs set created_at=$2::timestamptz where run_id=$1::uuid", [run.run_id, clock.now().toISOString()]);
  clock.advance(90_000);
  const service = createDiscoveryService({ repo, reads: createDiscoveryReadModel(db, clock.now) });
  const view = await service.getRun(userId, run.run_id);
  assert.equal(view.status, "queued");
  assert.equal(view.worker_waiting, false);
  assert.deepEqual(view.shortlist, []);
  clock.advance(1_000);
  assert.equal((await service.getRun(userId, run.run_id)).worker_waiting, true);
});

test("campaign deletion removes a sealed snapshot only when no other product branch still reaches it", dbOptions, async (t) => {
  const h = await createRunnerHarness(t);
  await h.executeOnce();
  const candidate = (await h.candidates()).find((item) => item.snapshot_id !== null);
  assert.ok(candidate?.snapshot_id);
  const snapshotId = candidate.snapshot_id;
  const toolCalls = await h.db.query<{ tool_call_id: string }>(
    "select tool_call_id::text as tool_call_id from discovery_attempts where run_id=$1::uuid and tool_call_id is not null",
    [h.runId],
  );
  assert.ok(toolCalls.rows.length > 0, "fixture retains discovery operation logs");
  const campaign = await h.db.query<{ campaign_id: string }>("select campaign_id::text as campaign_id from discovery_runs where run_id=$1::uuid", [h.runId]);
  await h.repo.deleteCampaign(h.userId, campaign.rows[0]!.campaign_id);
  assert.equal((await h.db.query("select 1 from snapshots where snapshot_id=$1::uuid", [snapshotId])).rowCount, 0);
  assert.equal((await h.db.query("select 1 from tool_call_logs where tool_call_id=any($1::uuid[])", [toolCalls.rows.map((row) => row.tool_call_id)])).rowCount, 0);
});

test("campaign deletion removes an unreferenced campaign exact-quote claim and its cascading evidence", dbOptions, async (t) => {
  const h = await createRunnerHarness(t);
  await h.executeOnce();
  const claim = await h.db.query<{ claim_id: string }>(
    `select q.claim_id::text as claim_id from discovery_quote_claims q
      where q.operation_key like $1::text || '/%' limit 1`,
    [h.runId],
  );
  const claimId = claim.rows[0]?.claim_id;
  assert.ok(claimId);
  const campaign = await h.db.query<{ campaign_id: string }>("select campaign_id::text as campaign_id from discovery_runs where run_id=$1::uuid", [h.runId]);
  await h.repo.deleteCampaign(h.userId, campaign.rows[0]!.campaign_id);
  assert.equal((await h.db.query("select 1 from claims where claim_id=$1::uuid", [claimId])).rowCount, 0);
  assert.equal((await h.db.query("select 1 from claim_evidence where claim_id=$1::uuid", [claimId])).rowCount, 0);
});

test("campaign deletion keeps a campaign exact-quote claim reached by a shared snapshot", dbOptions, async (t) => {
  const h = await createRunnerHarness(t);
  await h.executeOnce();
  const quote = await h.db.query<{ claim_id: string }>(
    `select q.claim_id::text as claim_id from discovery_quote_claims q
      where q.operation_key like $1::text || '/%' limit 1`,
    [h.runId],
  );
  const claimId = quote.rows[0]?.claim_id;
  assert.ok(claimId);
  const sharedSnapshot = await h.db.query<{ snapshot_id: string }>(
    `insert into snapshots (subject_refs,claim_refs,as_of,basis,normalization,allowed_transforms)
     values ('[]'::jsonb,jsonb_build_array($1::text),now(),'as_reported','none','[]'::jsonb)
     returning snapshot_id::text as snapshot_id`,
    [claimId],
  );
  const campaign = await h.db.query<{ campaign_id: string }>("select campaign_id::text as campaign_id from discovery_runs where run_id=$1::uuid", [h.runId]);
  await h.repo.deleteCampaign(h.userId, campaign.rows[0]!.campaign_id);
  assert.equal((await h.db.query("select 1 from claims where claim_id=$1::uuid", [claimId])).rowCount, 1);
  assert.equal((await h.db.query("select 1 from claim_evidence where claim_id=$1::uuid", [claimId])).rowCount, 1);
  assert.equal((await h.db.query("select 1 from snapshots where snapshot_id=$1::uuid", [sharedSnapshot.rows[0]!.snapshot_id])).rowCount, 1);
});

test("user erasure clears campaign-owned quote mapping and snapshots without deleting shared sources", dbOptions, async (t) => {
  const h = await createRunnerHarness(t);
  await h.executeOnce();
  const candidate = (await h.candidates()).find((item) => item.snapshot_id !== null);
  assert.ok(candidate?.snapshot_id);
  const source = await h.db.query<{ source_id: string }>(
    "select (research_packet->'excerpts'->0->>'source_id') as source_id from discovery_candidates where candidate_id=$1::uuid",
    [candidate.candidate_id],
  );
  const sourceId = source.rows[0]!.source_id;
  const toolCalls = await h.db.query<{ tool_call_id: string }>(
    "select tool_call_id::text as tool_call_id from discovery_attempts where run_id=$1::uuid and tool_call_id is not null",
    [h.runId],
  );
  const quote = await h.db.query<{ claim_id: string }>(
    `select q.claim_id::text as claim_id from discovery_quote_claims q
      where q.operation_key like $1::text || '/%' limit 1`,
    [h.runId],
  );
  const quoteClaimId = quote.rows[0]?.claim_id;
  assert.ok(quoteClaimId);
  const sharedSnapshot = await h.db.query<{ snapshot_id: string }>(
    `insert into snapshots (subject_refs,claim_refs,as_of,basis,normalization,allowed_transforms)
     values ('[]'::jsonb,jsonb_build_array($1::text),now(),'as_reported','none','[]'::jsonb)
     returning snapshot_id::text as snapshot_id`,
    [quoteClaimId],
  );
  const sharedEvent = await h.db.query<{ event_id: string }>(
    `insert into events (event_type,occurred_at,status,source_claim_ids,source_ids)
     values ('fixture_quote_reference',now(),'confirmed',jsonb_build_array($1::text),'[]'::jsonb)
     returning event_id::text as event_id`,
    [quoteClaimId],
  );
  await deleteUserAndQueueObjectBlobsWithPool(h.db, h.userId);
  await assert.rejects(h.repo.readRun(h.userId, h.runId), { code: "not_found" });
  assert.equal((await h.db.query("select 1 from discovery_candidates where run_id=$1::uuid", [h.runId])).rowCount, 0, "erasure removes the discovery visibility branch");
  assert.equal((await h.db.query("select 1 from discovery_quote_claims where source_id=$1::uuid", [sourceId])).rowCount, 0);
  assert.equal((await h.db.query("select 1 from claims where claim_id=$1::uuid", [quoteClaimId])).rowCount, 1, "shared snapshot/event references preserve canonical quote evidence");
  assert.equal((await h.db.query("select 1 from claim_evidence where claim_id=$1::uuid", [quoteClaimId])).rowCount, 1);
  assert.equal((await h.db.query("select 1 from snapshots where snapshot_id=$1::uuid", [sharedSnapshot.rows[0]!.snapshot_id])).rowCount, 1);
  assert.equal((await h.db.query("select 1 from events where event_id=$1::uuid", [sharedEvent.rows[0]!.event_id])).rowCount, 1);
  assert.equal((await h.db.query("select 1 from snapshots where snapshot_id=$1::uuid", [candidate.snapshot_id])).rowCount, 0);
  assert.equal((await h.db.query("select 1 from sources where source_id=$1::uuid", [sourceId])).rowCount, 1);
  assert.equal((await h.db.query("select 1 from tool_call_logs where tool_call_id=any($1::uuid[])", [toolCalls.rows.map((row) => row.tool_call_id)])).rowCount, 0);
});
