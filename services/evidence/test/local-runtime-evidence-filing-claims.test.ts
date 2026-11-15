import test from "node:test";
import assert from "node:assert/strict";

import { loadFilingClaims } from "../src/local-runtime-evidence.ts";
import type { QueryExecutor } from "../src/types.ts";
import { bootstrapDatabase, connectedClient, dockerAvailable } from "../../../db/test/docker-pg.ts";

const NVDA = "c1111111-1111-4111-8111-111111111111";
const AMD = "c2222222-2222-4222-8222-222222222222";
const MU = "c3333333-3333-4333-8333-333333333333";
const SOURCE = "c4444444-4444-4444-8444-444444444444";
const OLD_10K = "c5555555-5555-4555-8555-555555555551";
const NEW_10K = "c5555555-5555-4555-8555-555555555552";
const MU_10K = "c5555555-5555-4555-8555-555555555553";

async function seed(db: QueryExecutor): Promise<void> {
  await db.query(`insert into issuers (issuer_id, legal_name) values ($1, 'NVIDIA Corp'), ($2, 'Advanced Micro Devices Inc'), ($3, 'Micron Technology Inc')`, [NVDA, AMD, MU]);
  await db.query(`insert into instruments (instrument_id, issuer_id, asset_type) values (gen_random_uuid(), $1, 'common_stock')`, [NVDA]);
  await db.query(
    `insert into listings (instrument_id, mic, ticker, trading_currency, timezone)
     select instrument_id, 'XNAS', 'NVDA', 'USD', 'America/New_York' from instruments where issuer_id = $1`,
    [NVDA],
  );
  await db.query(`insert into sources (source_id, provider, kind, trust_tier, license_class, retrieved_at) values ($1, 'sec_edgar', 'filing', 'primary', 'public', now())`, [SOURCE]);
  await db.query(
    `insert into documents (document_id, source_id, kind, title, provider_doc_id, published_at, content_hash, raw_blob_id, parse_status, created_at) values
       ($1, $4, 'filing', '10-K', '0001045810-25-000023', '2025-02-26', 'h-old', 'sha256:old', 'parsed', '2025-03-01'),
       ($2, $4, 'filing', '10-K', '0001045810-26-000021', '2026-02-25', 'h-new', 'sha256:new', 'parsed', '2026-03-01'),
       ($3, $4, 'filing', '10-K', null, null, 'h-mu', 'sha256:mu', 'parsed', '2026-03-02')`,
    [OLD_10K, NEW_10K, MU_10K, SOURCE],
  );
  // [document, filer, predicate, text, locator start, competitor]
  const claims: Array<[string, string, string, string, number, string | null]> = [
    [OLD_10K, NVDA, "business.competition", "AMD competed with us last year.", 10, AMD],
    [NEW_10K, NVDA, "business.products", "Networking is our second product.", 100, null],
    [NEW_10K, NVDA, "business.products", "GPUs are our first product.", 20, null],
    [NEW_10K, NVDA, "business.competition", "AMD competes with us.", 300, AMD],
    [NEW_10K, NVDA, "risk.factor", "Supply may be constrained.", 400, null],
    [MU_10K, MU, "business.competition", "AMD buys our memory and competes in some markets.", 50, AMD],
  ];
  for (const [document, filer, predicate, text, start, competitor] of claims) {
    const { rows: [claim] } = await db.query<{ claim_id: string }>(
      `insert into claims (document_id, predicate, text_canonical, polarity, modality, reported_by_source_id, confidence, status, created_at)
       values ($1, $2, $3, 'neutral', 'quoted', $4, 0.9, 'extracted', '2026-03-03') returning claim_id::text`,
      [document, predicate, text, SOURCE],
    );
    await db.query(`insert into claim_arguments (claim_id, subject_kind, subject_id, role) values ($1, 'issuer', $2, 'subject')`, [claim!.claim_id, filer]);
    if (competitor) await db.query(`insert into claim_arguments (claim_id, subject_kind, subject_id, role) values ($1, 'issuer', $2, 'competitor')`, [claim!.claim_id, competitor]);
    await db.query(`insert into claim_evidence (claim_id, document_id, locator, confidence) values ($1, $2, $3, 1)`, [claim!.claim_id, document, JSON.stringify({ item: "1", start, end: start + 10 })]);
  }
}

test("filing claims come from each filer's latest 10-K, in document order, and a competitor read names the filer", async (t) => {
  if (!dockerAvailable()) return t.skip("docker unavailable");
  const { databaseUrl } = await bootstrapDatabase(t, "evidence-filing-claims");
  const db = await connectedClient(t, databaseUrl);
  await seed(db);
  const read = (issuer: string, role: "subject" | "competitor", predicates: string[], as_of = "2026-11-15T00:00:00Z") =>
    loadFilingClaims(db, { issuer_ids: [issuer], role, predicates, as_of });

  const own = await read(NVDA, "subject", ["business.products", "business.competition"]);
  assert.deepEqual(own.claims.map((claim) => [claim.filer_label, claim.accession, claim.text_canonical]), [
    ["NVDA", "0001045810-26-000021", "GPUs are our first product."],
    ["NVDA", "0001045810-26-000021", "Networking is our second product."],
    ["NVDA", "0001045810-26-000021", "AMD competes with us."],
  ], "the 2025 10-K's claim stays out, and start 20 comes before start 100");
  assert.equal(own.claims[0]!.published_at, "2026-02-25T00:00:00.000Z");

  const named = await read(AMD, "competitor", ["business.competition"]);
  assert.deepEqual(named.claims.map((claim) => [claim.filer_label, claim.text_canonical]), [
    ["Micron Technology Inc", "AMD buys our memory and competes in some markets."],
    ["NVDA", "AMD competes with us."],
  ], "each filer's latest 10-K; a filer with no listing is named by its legal name");

  assert.deepEqual((await read(AMD, "subject", ["business.competition"])).claims, [], "AMD files no claims of its own");
  assert.deepEqual((await read(NVDA, "subject", ["risk.factor"], "2000-01-01T23:59:59Z")).claims, [], "nothing was on file in 2000");
  const capped = await loadFilingClaims(db, { issuer_ids: [NVDA], role: "subject", predicates: ["business.products"], as_of: "2026-11-15T00:00:00Z", limit: 1 });
  assert.deepEqual([capped.claims.length, capped.truncated], [1, true]);
});
