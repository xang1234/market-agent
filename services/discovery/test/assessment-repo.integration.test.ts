import assert from "node:assert/strict";
import test from "node:test";

import type { QueryExecutor } from "../../agents/src/agent-repo.ts";
import { decideCandidate } from "../src/assessment.ts";
import { createAssessmentCommitter } from "../src/assessment-repo.ts";
import { analystFixture, briefFixture, identityFixture, packetFixture, skepticFixture } from "./fixtures.ts";
import { dbOptions, withCampaignDb } from "./db-fixture.ts";

const TOOL_CALL_ID = "d1000000-0000-4000-8000-000000000001";
const TOOL_HASH = "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";

test("assessment sealing verifies real snapshot provenance and rolls back an invalid seal", dbOptions, async (t) => {
  const { db, repo, clock, createApprovedRun } = await withCampaignDb(t);
  const { run } = await createApprovedRun();
  const packet = packetFixture();
  await insertEligibleListing(db, packet.identity);
  const lease = await repo.claimNextRun("assessment-worker");
  assert.ok(lease);
  await repo.admitCandidate(lease, {
    candidate_id: packet.candidate_id,
    lead_key: "assessment-candidate",
    name: packet.identity.legal_name,
    identity: packet.identity,
    origins: ["web"],
    mechanism_ids: [briefFixture().mechanisms[0]!.mechanism_id],
    seed: false,
    primary_domain_lead: true,
    first_seen: [0, 0],
    lead_hit_ids: [],
    reason_codes: [],
  });
  await repo.commitCohort(lease, [packet.candidate_id], {} as never);
  await seedEvidence(db, packet, run.campaign_id, run.run_id, false);
  const decision = decideCandidate(briefFixture(), packet, analystFixture(), skepticFixture(), "2026-09-10T12:00:00Z");
  const commit = createAssessmentCommitter({ db, clock: clock.now });

  await assert.rejects(() => commit(lease, packet, decision), /snapshot verification failed/i);
  await assertCandidateUnsealed(db, packet.candidate_id);
  assert.equal((await db.query<{ count: string }>("select count(*)::text as count from snapshots")).rows[0]?.count, "0");

  await db.query(
    "insert into tool_call_logs (tool_call_id,tool_name,args,result_hash,status) values ($1::uuid,'assessment_model','{}'::jsonb,$2,'ok')",
    [TOOL_CALL_ID, TOOL_HASH],
  );
  const committed = await commit(lease, packet, decision);
  assert.equal(committed.decision.state, "eligible_not_shortlisted");
  const sealed = await db.query<{ state: string; snapshot_id: string; claim_refs: string[]; document_refs: string[]; tool_call_ids: string[] }>(
    `select c.state,c.snapshot_id::text as snapshot_id,s.claim_refs,s.document_refs,s.tool_call_ids
       from discovery_candidates c join snapshots s on s.snapshot_id=c.snapshot_id
      where c.candidate_id=$1::uuid`,
    [packet.candidate_id],
  );
  assert.deepEqual(sealed.rows, [{
    state: "eligible_not_shortlisted",
    snapshot_id: committed.snapshot_id,
    claim_refs: packet.claims.map((claim) => claim.claim_id),
    document_refs: packet.excerpts.map((excerpt) => excerpt.document_id),
    tool_call_ids: [TOOL_CALL_ID],
  }]);
});

async function insertEligibleListing(db: QueryExecutor, identity: ReturnType<typeof identityFixture>): Promise<void> {
  const instrumentId = crypto.randomUUID();
  await db.query("insert into issuers (issuer_id,legal_name,former_names) values ($1::uuid,$2,'[]'::jsonb)", [identity.issuer_id, identity.legal_name]);
  await db.query("insert into instruments (instrument_id,issuer_id,asset_type) values ($1::uuid,$2::uuid,'common_stock')", [instrumentId, identity.issuer_id]);
  await db.query("insert into listings (listing_id,instrument_id,mic,ticker,trading_currency,timezone) values ($1::uuid,$2::uuid,$3,$4,$5,'America/New_York')", [identity.listing_id, instrumentId, identity.mic, identity.ticker, identity.currency]);
}

async function seedEvidence(
  db: QueryExecutor,
  packet: ReturnType<typeof packetFixture>,
  campaignId: string,
  runId: string,
  insertToolLog: boolean,
): Promise<void> {
  for (const excerpt of packet.excerpts) {
    await db.query(
      `insert into sources (source_id,provider,kind,canonical_url,trust_tier,license_class,retrieved_at)
       values ($1::uuid,'campaign-test','press_release',$2,'primary','test',$3::timestamptz)`,
      [excerpt.source_id, excerpt.url, excerpt.retrieved_at],
    );
    await db.query(
      `insert into documents (document_id,source_id,kind,title,published_at,content_hash,raw_blob_id,parse_status)
       values ($1::uuid,$2::uuid,'press_release',$3,$4::timestamptz,$5,$6,'parsed')`,
      [excerpt.document_id, excerpt.source_id, excerpt.title, excerpt.published_at, excerpt.document_hash, excerpt.document_hash],
    );
  }
  for (const claim of packet.claims) {
    await db.query(
      `insert into claims (claim_id,document_id,predicate,text_canonical,polarity,modality,reported_by_source_id,confidence,status)
       values ($1::uuid,$2::uuid,'campaign_test',$3,'positive','asserted',$4::uuid,1,'extracted')`,
      [claim.claim_id, claim.document_id, claim.text_canonical, claim.source_id],
    );
  }
  await db.query(
    `insert into discovery_attempts (campaign_id,run_id,operation_key,request_hash,attempt_number,resource,phase,candidate_id,model_initial,model_role,outcome,result,result_hash,tool_call_id,completed_at)
     values ($1::uuid,$2::uuid,$3,$4,1,'model','research',$5::uuid,true,'analyst','success','{}'::jsonb,$6,$7::uuid,now())`,
    [campaignId, runId, `${runId}/research/${packet.candidate_id}/analyst`, "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd", packet.candidate_id, TOOL_HASH, TOOL_CALL_ID],
  );
  if (insertToolLog) {
    await db.query(
      "insert into tool_call_logs (tool_call_id,tool_name,args,result_hash,status) values ($1::uuid,'assessment_model','{}'::jsonb,$2,'ok')",
      [TOOL_CALL_ID, TOOL_HASH],
    );
  }
}

async function assertCandidateUnsealed(db: QueryExecutor, candidateId: string): Promise<void> {
  const rows = await db.query<{ state: string; snapshot_id: string | null; assessment: unknown }>(
    "select state,snapshot_id::text as snapshot_id,assessment from discovery_candidates where candidate_id=$1::uuid",
    [candidateId],
  );
  assert.deepEqual(rows.rows, [{ state: "researching", snapshot_id: null, assessment: null }]);
}
