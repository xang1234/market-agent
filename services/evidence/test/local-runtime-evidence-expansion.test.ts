import test from "node:test";
import assert from "node:assert/strict";

import { loadLocalRuntimeEvidence } from "../src/local-runtime-evidence.ts";
import type { QueryExecutor } from "../src/types.ts";
import { bootstrapDatabase, connectedClient, dockerAvailable } from "../../../db/test/docker-pg.ts";

// Integration coverage for ADR 0001: the evidence delta query expands a
// listing/instrument universe ref to its owning issuer so listing-scoped agent
// universes match issuer-attributed claims (the common case). Behavior change to
// a shared query, so it is proven end-to-end against Postgres, not just by SQL
// shape.

const ISSUER_ID = "a1111111-1111-4111-8111-111111111111";
const INSTRUMENT_ID = "a2222222-2222-4222-8222-222222222222";
const LISTING_ID = "a3333333-3333-4333-8333-333333333333";
const OTHER_ISSUER_ID = "a4444444-4444-4444-8444-444444444444";
const SOURCE_ID = "a5555555-5555-4555-8555-555555555555";
const DOCUMENT_ID = "a6666666-6666-4666-8666-666666666666";
const CLAIM_ID = "a7777777-7777-4777-8777-777777777777";

async function seedIssuerAttributedClaim(db: QueryExecutor): Promise<void> {
  await db.query(`insert into issuers (issuer_id, legal_name) values ($1, 'Acme Inc'), ($2, 'Other Inc')`, [
    ISSUER_ID,
    OTHER_ISSUER_ID,
  ]);
  await db.query(
    `insert into instruments (instrument_id, issuer_id, asset_type) values ($1, $2, 'common_stock')`,
    [INSTRUMENT_ID, ISSUER_ID],
  );
  await db.query(
    `insert into listings (listing_id, instrument_id, mic, ticker, trading_currency, timezone)
     values ($1, $2, 'XNAS', 'ACME', 'USD', 'America/New_York')`,
    [LISTING_ID, INSTRUMENT_ID],
  );
  await db.query(
    `insert into sources (source_id, provider, kind, trust_tier, license_class, retrieved_at)
     values ($1, 'sec_edgar', 'filing', 'primary', 'public', now())`,
    [SOURCE_ID],
  );
  await db.query(
    `insert into documents (document_id, source_id, kind, content_hash, raw_blob_id)
     values ($1, $2, 'filing', 'hash-acme', 'sha256:acme')`,
    [DOCUMENT_ID, SOURCE_ID],
  );
  await db.query(
    `insert into claims
       (claim_id, document_id, predicate, text_canonical, polarity, modality, reported_by_source_id, confidence, status)
     values ($1, $2, 'insider.transaction', 'CEO bought shares', 'neutral', 'asserted', $3, 0.9, 'extracted')`,
    [CLAIM_ID, DOCUMENT_ID, SOURCE_ID],
  );
  // The claim is attributed to the ISSUER (as SEC ingestion does), not the listing.
  await db.query(
    `insert into claim_arguments (claim_id, subject_kind, subject_id, role) values ($1, 'issuer', $2, 'subject')`,
    [CLAIM_ID, ISSUER_ID],
  );
}

test("delta query expands listing/instrument universes to the issuer (ADR 0001)", async (t) => {
  if (!dockerAvailable()) {
    t.skip("docker unavailable");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "evidence-expansion");
  const client = await connectedClient(t, databaseUrl);
  const db = client as unknown as QueryExecutor;
  await seedIssuerAttributedClaim(db);

  const byListing = await loadLocalRuntimeEvidence(db, { subject_refs: [{ kind: "listing", id: LISTING_ID }] });
  assert.deepEqual(byListing.claim_refs, [CLAIM_ID], "listing universe should match the issuer-attributed claim");
  // The returned (declared) subjects stay the input refs — expansion is for matching only.
  assert.deepEqual(byListing.subject_refs, [{ kind: "listing", id: LISTING_ID }]);

  const byInstrument = await loadLocalRuntimeEvidence(db, { subject_refs: [{ kind: "instrument", id: INSTRUMENT_ID }] });
  assert.deepEqual(byInstrument.claim_refs, [CLAIM_ID], "instrument universe should match too");

  const byIssuer = await loadLocalRuntimeEvidence(db, { subject_refs: [{ kind: "issuer", id: ISSUER_ID }] });
  assert.deepEqual(byIssuer.claim_refs, [CLAIM_ID], "issuer universe still matches (no regression)");

  const byOther = await loadLocalRuntimeEvidence(db, { subject_refs: [{ kind: "issuer", id: OTHER_ISSUER_ID }] });
  assert.deepEqual(byOther.claim_refs, [], "an unrelated issuer must not match");

  const excluded = await loadLocalRuntimeEvidence(db, {
    subject_refs: [{ kind: "listing", id: LISTING_ID }],
    exclude_claim_ids: [CLAIM_ID],
  });
  assert.deepEqual(excluded.claim_refs, [], "exclude_claim_ids still applies after expansion");
});

test("loadLocalRuntimeEvidence hides a superseded claim from fresh selection but preserves the row", async (t) => {
  if (!dockerAvailable()) {
    t.skip("docker unavailable");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "evidence-superseded");
  const client = await connectedClient(t, databaseUrl);
  const db = client as unknown as QueryExecutor;
  await seedIssuerAttributedClaim(db); // active CLAIM_ID attributed to ISSUER_ID

  // A second insider claim for the same issuer, soft-superseded as a 4/A supersede does.
  const SUPERSEDED_CLAIM = "a8888888-8888-4888-8888-888888888888";
  await db.query(
    `insert into claims
       (claim_id, document_id, predicate, text_canonical, polarity, modality, reported_by_source_id, confidence, status, superseded_at)
     values ($1, $2, 'insider.transaction', 'CEO bought shares (stale)', 'neutral', 'asserted', $3, 0.9, 'extracted', now())`,
    [SUPERSEDED_CLAIM, DOCUMENT_ID, SOURCE_ID],
  );
  await db.query(`insert into claim_arguments (claim_id, subject_kind, subject_id, role) values ($1, 'issuer', $2, 'subject')`, [
    SUPERSEDED_CLAIM,
    ISSUER_ID,
  ]);

  // Fresh subject->claims selection returns only the active claim.
  const fresh = await loadLocalRuntimeEvidence(db, { subject_refs: [{ kind: "issuer", id: ISSUER_ID }] });
  assert.deepEqual(fresh.claim_refs, [CLAIM_ID], "the superseded claim is hidden from fresh selection");

  // But its row is preserved (not deleted), so a sealed snapshot's claim_refs still rehydrate by id.
  const preserved = await db.query<{ n: number }>(
    `select count(*)::int as n from claims where claim_id = $1 and superseded_at is not null`,
    [SUPERSEDED_CLAIM],
  );
  assert.equal(preserved.rows[0]!.n, 1, "the superseded claim row is preserved for rehydration");
});
