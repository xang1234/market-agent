import assert from "node:assert/strict";
import test from "node:test";

import type { QueryExecutor } from "../../agents/src/agent-repo.ts";
import { createPacketStore } from "../src/packet-repo.ts";
import { requestHash } from "../src/scout-support.ts";
import { briefFixture, packetFixture } from "./fixtures.ts";
import { dbOptions, withCampaignDb } from "./db-fixture.ts";

const USER_ID = "10000000-0000-4000-8000-000000000001";
const RUN_ID = "70000000-0000-4000-8000-000000000001";
const REPORTING_SOURCE = "f2000000-0000-4000-8000-000000000001";
const QUOTE_CLAIM = "b1000000-0000-4000-8000-000000000001";

test("research packet refresh does not retain a packet claim after its exact current row disappears", async () => {
  const packet = packetFixture();
  const db = {
    release() {},
    async query<R extends Record<string, unknown>>(text: string) {
      if (text.trim() === "begin" || text.trim() === "commit") return result([] as R[]);
      if (text.includes("from users where user_id")) return result([{ user_id: USER_ID }] as unknown as R[]);
      if (text.includes("from discovery_runs where run_id")) return result([{ lease_epoch: 2, lease_owner: "packet-worker", lease_expires_at: "2026-09-10T13:00:00.000Z", cancel_requested_at: null }] as unknown as R[]);
      if (text.includes("from discovery_candidates") && text.includes("for update")) {
        return result([{
          research_packet: packet,
          research_packet_hash: requestHash(packet),
          issuer_id: packet.identity.issuer_id,
          state: "researching",
          assessment: null,
          snapshot_id: null,
        }] as unknown as R[]);
      }
      if (text.includes("from listings l join instruments")) return result([{ listing_id: packet.identity.listing_id }] as unknown as R[]);
      if (text.includes("join claims c") && text.includes("reported_by_source_id")) return result([] as R[]);
      if (text.includes("from documents d join sources")) {
        return result(packet.excerpts.map((excerpt) => ({ document_id: excerpt.document_id, source_id: excerpt.source_id })) as unknown as R[]);
      }
      if (text.includes("from facts f join sources")) return result([] as R[]);
      if (text.includes("from discovery_quote_claims")) return result([] as R[]);
      throw new Error(`unexpected query: ${text}`);
    },
  };

  const refreshed = await createPacketStore(db, () => new Date("2026-09-10T12:00:00.000Z")).refreshResearchPacket(
    { run_id: RUN_ID, user_id: USER_ID, worker_id: "packet-worker", epoch: 2, expires_at: "2026-09-10T13:00:00.000Z" },
    packet,
  );

  assert.deepEqual(refreshed.claims, []);
});

test("research packet refresh drops superseded and deleted claims while their documents remain current", dbOptions, async (t) => {
  const { db, repo, createApprovedRun } = await withCampaignDb(t);
  await createApprovedRun();
  const packet = packetFixture();
  await insertEligibleListing(db, packet.identity);
  const lease = await repo.claimNextRun("packet-worker");
  assert.ok(lease);
  await repo.admitCandidate(lease, {
    candidate_id: packet.candidate_id,
    lead_key: "packet-claim-currentness",
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
  await seedPacketClaims(db, packet);
  await repo.saveResearchPacket(lease, packet);

  await db.query("update claims set superseded_at=now() where claim_id=$1::uuid", [packet.claims[0]!.claim_id]);
  await db.query("delete from claims where claim_id=$1::uuid", [packet.claims[1]!.claim_id]);

  const refreshed = await repo.refreshResearchPacket(lease, packet);

  assert.deepEqual(refreshed.claims, []);
  assert.equal(refreshed.excerpts.length, 2);
  assert.ok(refreshed.coverage_gaps.includes("current_source_access_changed"));
});

test("research packet refresh retains distinct authorized reporting and document sources, then drops either revoked source", dbOptions, async (t) => {
  const { db, repo, otherUserId, lease } = await preparePacket(t, (() => {
    const packet = packetFixture();
    packet.claims[0] = { ...packet.claims[0]!, source_id: REPORTING_SOURCE };
    return packet;
  })());
  const packet = (await repo.loadResearchPacket(lease, "90000000-0000-4000-8000-000000000001"))!.packet;
  await insertPublicSource(db, REPORTING_SOURCE);
  await seedPacketClaims(db, packet);

  const authorized = await repo.refreshResearchPacket(lease, packet);
  assert.ok(authorized.claims.some((claim) => claim.claim_id === packet.claims[0]!.claim_id && claim.source_id === REPORTING_SOURCE));

  await db.query("update sources set user_id=$2::uuid where source_id=$1::uuid", [REPORTING_SOURCE, otherUserId]);
  const reportingRevoked = await repo.refreshResearchPacket(lease, packet);
  assert.equal(reportingRevoked.claims.some((claim) => claim.claim_id === packet.claims[0]!.claim_id), false);

  await db.query("update sources set user_id=null where source_id=$1::uuid", [REPORTING_SOURCE]);
  await db.query("update sources set user_id=$2::uuid where source_id=$1::uuid", [packet.excerpts[0]!.source_id, otherUserId]);
  const documentRevoked = await repo.refreshResearchPacket(lease, packet);
  assert.equal(documentRevoked.claims.some((claim) => claim.claim_id === packet.claims[0]!.claim_id), false);
});

test("research packet refresh does not reintroduce a superseded exact quote claim", dbOptions, async (t) => {
  const { db, repo, lease } = await preparePacket(t);
  const packet = (await repo.loadResearchPacket(lease, "90000000-0000-4000-8000-000000000001"))!.packet;
  await seedPacketClaims(db, packet);
  const excerpt = packet.excerpts[0]!;
  await db.query(
    `insert into claims (claim_id,document_id,predicate,text_canonical,polarity,modality,reported_by_source_id,confidence,status,superseded_at)
     values ($1::uuid,$2::uuid,'campaign_exact_quote','A superseded exact quote for regression coverage.','neutral','quoted',$3::uuid,1,'extracted',now())`,
    [QUOTE_CLAIM, excerpt.document_id, excerpt.source_id],
  );
  await db.query(
    `insert into discovery_quote_claims (quote_key,operation_key,request_hash,claim_id,document_id,source_id,document_hash,normalized_start,quote_hash)
     values ($1,$2,$3,$4::uuid,$5::uuid,$6::uuid,$7,0,$8)`,
    [
      `sha256:${"f".repeat(64)}`,
      "packet/quote-regression",
      `sha256:${"e".repeat(64)}`,
      QUOTE_CLAIM,
      excerpt.document_id,
      excerpt.source_id,
      excerpt.document_hash,
      `sha256:${"d".repeat(64)}`,
    ],
  );

  const refreshed = await repo.refreshResearchPacket(lease, packet);

  assert.equal(refreshed.claims.some((claim) => claim.claim_id === QUOTE_CLAIM), false);
});

test("quote-claim refresh preserves a distinct reporting source only while both sources are authorized", dbOptions, async (t) => {
  const { db, repo, otherUserId, lease } = await preparePacket(t);
  const packet = (await repo.loadResearchPacket(lease, "90000000-0000-4000-8000-000000000001"))!.packet;
  await seedPacketClaims(db, packet);
  await insertPublicSource(db, REPORTING_SOURCE);
  const excerpt = packet.excerpts[0]!;
  await db.query(
    `insert into claims (claim_id,document_id,predicate,text_canonical,polarity,modality,reported_by_source_id,confidence,status)
     values ($1::uuid,$2::uuid,'campaign_exact_quote','A current exact quote with distinct reporting provenance.','neutral','quoted',$3::uuid,1,'extracted')`,
    [QUOTE_CLAIM, excerpt.document_id, REPORTING_SOURCE],
  );
  await db.query(
    `insert into discovery_quote_claims (quote_key,operation_key,request_hash,claim_id,document_id,source_id,document_hash,normalized_start,quote_hash)
     values ($1,$2,$3,$4::uuid,$5::uuid,$6::uuid,$7,0,$8)`,
    [
      `sha256:${"c".repeat(64)}`,
      "packet/quote-distinct-provenance",
      `sha256:${"b".repeat(64)}`,
      QUOTE_CLAIM,
      excerpt.document_id,
      excerpt.source_id,
      excerpt.document_hash,
      `sha256:${"a".repeat(64)}`,
    ],
  );

  const authorized = await repo.refreshResearchPacket(lease, packet);
  assert.ok(authorized.claims.some((claim) => claim.claim_id === QUOTE_CLAIM && claim.source_id === REPORTING_SOURCE));

  await db.query("update sources set user_id=$2::uuid where source_id=$1::uuid", [REPORTING_SOURCE, otherUserId]);
  const reportingRevoked = await repo.refreshResearchPacket(lease, packet);
  assert.equal(reportingRevoked.claims.some((claim) => claim.claim_id === QUOTE_CLAIM), false);

  await db.query("update sources set user_id=null where source_id=$1::uuid", [REPORTING_SOURCE]);
  await db.query("update sources set user_id=$2::uuid where source_id=$1::uuid", [excerpt.source_id, otherUserId]);
  const documentRevoked = await repo.refreshResearchPacket(lease, packet);
  assert.equal(documentRevoked.claims.some((claim) => claim.claim_id === QUOTE_CLAIM), false);
});

async function preparePacket(t: Parameters<typeof withCampaignDb>[0], packet = packetFixture()) {
  const { db, repo, otherUserId, createApprovedRun } = await withCampaignDb(t);
  await createApprovedRun();
  await insertEligibleListing(db, packet.identity);
  const lease = await repo.claimNextRun("packet-worker");
  assert.ok(lease);
  await repo.admitCandidate(lease, {
    candidate_id: packet.candidate_id,
    lead_key: "packet-claim-currentness",
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
  await repo.saveResearchPacket(lease, packet);
  return { db, repo, otherUserId, lease };
}

async function insertEligibleListing(db: QueryExecutor, identity: ReturnType<typeof packetFixture>["identity"]): Promise<void> {
  const instrumentId = crypto.randomUUID();
  await db.query("insert into issuers (issuer_id,legal_name,former_names) values ($1::uuid,$2,'[]'::jsonb)", [identity.issuer_id, identity.legal_name]);
  await db.query("insert into instruments (instrument_id,issuer_id,asset_type) values ($1::uuid,$2::uuid,'common_stock')", [instrumentId, identity.issuer_id]);
  await db.query("insert into listings (listing_id,instrument_id,mic,ticker,trading_currency,timezone) values ($1::uuid,$2::uuid,$3,$4,$5,'America/New_York')", [identity.listing_id, instrumentId, identity.mic, identity.ticker, identity.currency]);
}

async function seedPacketClaims(db: QueryExecutor, packet: ReturnType<typeof packetFixture>): Promise<void> {
  for (const excerpt of packet.excerpts) {
    await db.query(
      `insert into sources (source_id,provider,kind,canonical_url,trust_tier,license_class,retrieved_at)
       values ($1::uuid,'packet-test','press_release',$2,'primary','test',$3::timestamptz)`,
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
       values ($1::uuid,$2::uuid,'packet_test',$3,'positive','asserted',$4::uuid,1,'extracted')`,
      [claim.claim_id, claim.document_id, claim.text_canonical, claim.source_id],
    );
  }
}

async function insertPublicSource(db: QueryExecutor, sourceId: string): Promise<void> {
  await db.query(
    `insert into sources (source_id,provider,kind,canonical_url,trust_tier,license_class,retrieved_at)
     values ($1::uuid,'packet-test','press_release',$2,'primary','test','2026-09-10T12:00:00.000Z')`,
    [sourceId, `https://example.test/reporting/${sourceId}`],
  );
}

function result<R extends Record<string, unknown>>(rows: R[], rowCount = rows.length) {
  return { rows, rowCount };
}
