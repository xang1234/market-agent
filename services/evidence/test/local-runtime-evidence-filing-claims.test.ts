import test from "node:test";
import assert from "node:assert/strict";

import { CLAIMS_PER_READ, FILERS_PER_READ, loadLatestFilingClaims } from "../src/local-runtime-evidence.ts";
import type { QueryExecutor } from "../src/types.ts";
import { bootstrapDatabase, connectedClient, dockerAvailable } from "../../../db/test/docker-pg.ts";

const NVDA = "c1111111-1111-4111-8111-111111111111";
const AMD = "c2222222-2222-4222-8222-222222222222";
const MU = "c3333333-3333-4333-8333-333333333333";
const INTC = "c3333333-3333-4333-8333-333333333334";
const SOURCE = "c4444444-4444-4444-8444-444444444444";
const OLD_10K = "c5555555-5555-4555-8555-555555555551";
const NEW_10K = "c5555555-5555-4555-8555-555555555552";
const MU_10K = "c5555555-5555-4555-8555-555555555553";
const MU_OLD_10K = "c5555555-5555-4555-8555-555555555554";
const NVDA_FILE_10K = "c5555555-5555-4555-8555-555555555555";
const AVGO = "c3333333-3333-4333-8333-333333333335";
const QCOM = "c3333333-3333-4333-8333-333333333336";
const AVGO_OLD_10K = "c5555555-5555-4555-8555-555555555556";
const AVGO_NEW_10K = "c5555555-5555-4555-8555-555555555557";
const QCOM_10K = "c5555555-5555-4555-8555-555555555558";
const KO_LIKE = "c3333333-3333-4333-8333-333333333337";
const LINK = "https://www.sec.gov/Archives/edgar/data/1045810/000104581026000021/0001045810-26-000021-index.htm";
const READ = JSON.stringify({ "1": { state: "read" }, "1A": { state: "read" } });

async function seed(db: QueryExecutor): Promise<void> {
  await db.query(`insert into issuers (issuer_id, legal_name) values ($1, 'NVIDIA Corp'), ($2, 'Advanced Micro Devices Inc'), ($3, 'Micron Technology Inc'), ($4, 'Intel Corp'), ($5, 'Broadcom Inc'), ($6, 'Qualcomm Inc')`, [NVDA, AMD, MU, INTC, AVGO, QCOM]);
  await db.query(`insert into instruments (instrument_id, issuer_id, asset_type) values (gen_random_uuid(), $1, 'common_stock')`, [NVDA]);
  await db.query(
    `insert into listings (instrument_id, mic, ticker, trading_currency, timezone)
     select instrument_id, 'XNAS', 'NVDA', 'USD', 'America/New_York' from instruments where issuer_id = $1`,
    [NVDA],
  );
  await db.query(`insert into instruments (instrument_id, issuer_id, asset_type) values (gen_random_uuid(), $1, 'common_stock')`, [MU]);
  await db.query(
    `insert into listings (instrument_id, mic, ticker, trading_currency, timezone, active_from)
     select instrument_id, 'XNAS', 'MU', 'USD', 'America/New_York', '2027-01-01' from instruments where issuer_id = $1`,
    [MU],
  );
  await db.query(`insert into sources (source_id, provider, kind, canonical_url, trust_tier, license_class, retrieved_at) values ($1, 'sec_edgar', 'filing', $2, 'primary', 'public', now())`, [SOURCE, LINK]);
  const documents: Array<[string, string, string | null, string | null, string, string | null]> = [
    [OLD_10K, NVDA, "0001045810-25-000023", "2025-02-26", "2025-03-01", READ],
    [NEW_10K, NVDA, "0001045810-26-000021", "2026-02-25", "2026-03-01", JSON.stringify({ "1": { state: "read" }, "1A": { state: "cut", prompts: 11, of: 13 } })],
    [MU_10K, MU, null, null, "2026-03-02", READ],
    [MU_OLD_10K, MU, null, null, "2025-03-02", READ],
    [NVDA_FILE_10K, NVDA, null, null, "2026-03-05", READ],
    [AVGO_OLD_10K, AVGO, "0001730168-25-000010", "2025-02-01", "2025-02-02", READ],
    [AVGO_NEW_10K, AVGO, "0001730168-26-000010", "2026-02-01", "2026-02-02", JSON.stringify({ "1": { state: "read" }, "1A": { state: "unread" } })],
    [QCOM_10K, QCOM, "0000804328-26-000005", "2026-01-05", "2026-01-06", JSON.stringify({ "1": { state: "read" }, "1A": { state: "not_found" } })],
  ];
  for (const [document, filer, accession, filed, created, readState] of documents) {
    await db.query(
      `insert into documents (document_id, source_id, kind, title, provider_doc_id, published_at, content_hash, raw_blob_id, parse_status, created_at, read_state)
       values ($1::uuid, $2, 'filing', '10-K', $3, $4::timestamptz, $7, $7, 'parsed', $5::timestamptz, $6::jsonb)`,
      [document, SOURCE, accession, filed, created, readState, `h-${document}`],
    );
    await db.query(`insert into mentions (document_id, subject_kind, subject_id, prominence, confidence) values ($1, 'issuer', $2, 'headline', 1)`, [document, filer]);
  }
  const claims: Array<{ document: string; filer: string; predicate: string; text: string; start: number; competitor?: string }> = [
    { document: OLD_10K, filer: NVDA, predicate: "business.competition", text: "AMD competed with us last year.", start: 10, competitor: AMD },
    { document: OLD_10K, filer: NVDA, predicate: "business.competition", text: "Intel competed with us last year.", start: 15, competitor: INTC },
    { document: NEW_10K, filer: NVDA, predicate: "business.products", text: "Networking is our second product.", start: 100 },
    { document: NEW_10K, filer: NVDA, predicate: "business.products", text: "GPUs are our first product.", start: 20 },
    { document: NEW_10K, filer: NVDA, predicate: "business.competition", text: "AMD competes with us.", start: 300, competitor: AMD },
    { document: NEW_10K, filer: NVDA, predicate: "risk.factor", text: "Supply may be constrained.", start: 400 },
    { document: NVDA_FILE_10K, filer: NVDA, predicate: "business.products", text: "An undated copy stored from a file.", start: 5 },
    { document: MU_OLD_10K, filer: MU, predicate: "risk.factor", text: "Memory prices fell last year.", start: 40 },
    { document: MU_10K, filer: MU, predicate: "business.competition", text: "AMD buys our memory and competes in some markets.", start: 50, competitor: AMD },
    { document: AVGO_OLD_10K, filer: AVGO, predicate: "business.products", text: "We sold modems last year.", start: 10 },
    { document: AVGO_OLD_10K, filer: AVGO, predicate: "risk.factor", text: "Customer concentration is high.", start: 500 },
    { document: AVGO_NEW_10K, filer: AVGO, predicate: "business.products", text: "We sell custom accelerators.", start: 10 },
    { document: QCOM_10K, filer: QCOM, predicate: "business.products", text: "We license wireless patents.", start: 10 },
  ];
  for (const { document, filer, predicate, text, start, competitor } of claims) {
    const { rows: [claim] } = await db.query<{ claim_id: string }>(
      `insert into claims (document_id, predicate, text_canonical, polarity, modality, reported_by_source_id, attributed_to_type, attributed_to_id, confidence, status, created_at)
       values ($1, $2, $3, 'neutral', 'quoted', $4, 'issuer', $5, 0.9, 'extracted', '2026-03-03') returning claim_id::text`,
      [document, predicate, text, SOURCE, filer],
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
    loadLatestFilingClaims(db, { issuer_ids: [issuer], role, predicates, as_of });

  const own = await read(NVDA, "subject", ["business.products", "business.competition"]);
  assert.deepEqual(own.claims.map((claim) => [claim.filer_label, claim.accession, claim.text_canonical]), [
    ["NVDA", "0001045810-26-000021", "GPUs are our first product."],
    ["NVDA", "0001045810-26-000021", "Networking is our second product."],
    ["NVDA", "0001045810-26-000021", "AMD competes with us."],
  ], "the dated 2026 10-K is read, not the 2025 one or a newer undated copy; start 20 comes before start 100");
  assert.equal(own.claims[0]!.published_at, "2026-02-25T00:00:00.000Z");
  assert.equal(own.claims[0]!.link, LINK);

  const named = await read(AMD, "competitor", ["business.competition"]);
  assert.deepEqual(named.claims.map((claim) => [claim.filer_label, claim.text_canonical]), [
    ["Micron Technology Inc", "AMD buys our memory and competes in some markets."],
    ["NVDA", "AMD competes with us."],
  ], "each filer's latest 10-K; MU's listing starts after the cutoff, so it is named by its legal name");

  assert.deepEqual((await read(INTC, "competitor", ["business.competition"])).claims, [], "NVDA's latest 10-K no longer names Intel");
  const muRisks = await read(MU, "subject", ["risk.factor"]);
  assert.deepEqual([muRisks.claims, muRisks.reads.map((r) => [r.item, r.state, r.filing.document_id, r.newer_unread])], [[], [["1A", "read", MU_10K, null]]],
    "MU's latest 10-K read Item 1A and found no risk factors, and an older one's do not stand in");
  assert.deepEqual((await read(AMD, "subject", ["business.competition"])).claims, [], "AMD files no claims of its own");
  assert.deepEqual((await read(NVDA, "subject", ["risk.factor"], "2000-01-01T23:59:59Z")).claims, [], "nothing was on file in 2000");
  const shape = (r: Awaited<ReturnType<typeof read>>) => [
    r.claims.map((claim) => [claim.accession, claim.text_canonical]),
    r.reads.map(({ item, state, cut, filing, newer_unread }) => [item, state, cut, filing.accession, newer_unread && [newer_unread.accession, newer_unread.state]]),
  ];
  assert.deepEqual(shape(await read(NVDA, "subject", ["risk.factor"])), [
    [["0001045810-26-000021", "Supply may be constrained."]],
    [["1A", "cut", { prompts: 11, of: 13 }, "0001045810-26-000021", null]],
  ], "a cut item's claims are served, and the read says it was cut");
  assert.deepEqual(shape(await read(AVGO, "subject", ["business.products", "risk.factor"])), [
    [["0001730168-26-000010", "We sell custom accelerators."], ["0001730168-25-000010", "Customer concentration is high."]],
    [["1", "read", null, "0001730168-26-000010", null], ["1A", "read", null, "0001730168-25-000010", ["0001730168-26-000010", "unread"]]],
  ], "Item 1 from the 2026 10-K; Item 1A from the 2025 one, since 2026 left it unread, and the read names the unread newer filing");
  assert.deepEqual(shape(await read(QCOM, "subject", ["risk.factor"])), [[], [["1A", "not_found", null, "0000804328-26-000005", null]]],
    "no claims, and the read says Item 1A was never found rather than read empty");
  assert.deepEqual((await read(KO_LIKE, "subject", ["risk.factor"])).reads, [], "an issuer with no stored 10-K has no reads");
  const capped = await loadLatestFilingClaims(db, { issuer_ids: [NVDA], role: "subject", predicates: ["business.products"], as_of: "2026-11-15T00:00:00Z", limit: 1 });
  assert.deepEqual([capped.claims.length, capped.truncated], [1, true]);
  const perFiler = await loadLatestFilingClaims(db, { issuer_ids: [AMD], role: "competitor", predicates: ["business.competition"], as_of: "2026-11-15T00:00:00Z", limit: 1 });
  assert.deepEqual([perFiler.claims.map((claim) => claim.filer_label), perFiler.truncated], [["Micron Technology Inc", "NVDA"], false], "the limit is each filer's");
});

test("a competitor read finds filers only by claims the user may cite at the cutoff, and a read is bounded whatever the filer count", async (t) => {
  if (!dockerAvailable()) return t.skip("docker unavailable");
  const { databaseUrl } = await bootstrapDatabase(t, "evidence-filing-claims-bounds");
  const db = await connectedClient(t, databaseUrl);
  await seed(db);
  const [OWNER, OTHER, PRIVATE] = ["c6666666-6666-4666-8666-666666666661", "c6666666-6666-4666-8666-666666666662", "c6666666-6666-4666-8666-666666666663"];
  await db.query(`insert into users (user_id, email) values ($1, 'owner@example.invalid'), ($2, 'other@example.invalid')`, [OWNER, OTHER]);
  await db.query(`insert into sources (source_id, provider, kind, trust_tier, license_class, retrieved_at, user_id) values ($1, 'upload', 'reference_data', 'secondary', 'private', now(), $2)`, [PRIVATE, OWNER]);
  const intelAsCompetitor = (as_of: string, user_id: string | null = null) =>
    loadLatestFilingClaims(db, { issuer_ids: [INTC], role: "competitor", predicates: ["risk.factor"], as_of, user_id });
  assert.deepEqual((await intelAsCompetitor("2026-11-15T00:00:00Z")).reads.map((read) => read.filer_issuer_id), [NVDA], "NVDA's 2025 10-K named Intel");

  await db.query(`update claims set created_at = '2027-01-01' where text_canonical = 'Intel competed with us last year.'`);
  assert.deepEqual(await intelAsCompetitor("2026-11-15T00:00:00Z"), { claims: [], truncated: false, reads: [], no_filing: [] }, "a claim stored after the cutoff names no filer");
  await db.query(`update claims set created_at = '2026-03-03', reported_by_source_id = $1 where text_canonical = 'Intel competed with us last year.'`, [PRIVATE]);
  assert.deepEqual((await intelAsCompetitor("2026-11-15T00:00:00Z", OTHER)).reads, [], "another user's private claim names no filer");
  assert.deepEqual((await intelAsCompetitor("2026-11-15T00:00:00Z", OWNER)).reads.map((read) => read.filer_issuer_id), [NVDA], "its owner's read still finds NVDA");

  await db.query(`insert into issuers (issuer_id, legal_name) values ($1, 'Coca-Cola Co')`, [KO_LIKE]);
  assert.deepEqual(await loadLatestFilingClaims(db, { issuer_ids: [KO_LIKE, MU], role: "subject", predicates: ["risk.factor"], as_of: "2026-11-15T00:00:00Z" }).then((r) => [r.no_filing, r.reads.map((read) => read.filer_issuer_id)]),
    [[{ issuer_id: KO_LIKE, label: "Coca-Cola Co" }], [MU]], "an issuer with no 10-K on file is named as such");
  assert.deepEqual((await loadLatestFilingClaims(db, { issuer_ids: [NVDA], role: "subject", predicates: ["risk.factor"], as_of: "2000-01-01T00:00:00Z" })).no_filing, [{ issuer_id: NVDA, label: "NVDA" }], "nor in 2000, before its first 10-K");

  // Many filers each name AMD, and five of them in 50 claims each.
  await db.query(`create temporary table bulk as select gen_random_uuid() as issuer, gen_random_uuid() as document, g from generate_series(1, ${FILERS_PER_READ + 10}) g`);
  await db.query(`insert into issuers (issuer_id, legal_name) select issuer, 'Bulk ' || lpad(g::text, 3, '0') from bulk`);
  await db.query(
    `insert into documents (document_id, source_id, kind, title, published_at, created_at, content_hash, raw_blob_id, parse_status, read_state)
     select document, $1, 'filing', '10-K', '2026-01-01', '2026-01-02', document::text, document::text, 'parsed', '{"1":{"state":"read"}}'::jsonb from bulk`,
    [SOURCE],
  );
  await db.query(`insert into mentions (document_id, subject_kind, subject_id, prominence, confidence) select document, 'issuer', issuer, 'headline', 1 from bulk`);
  await db.query(
    `with made as (
       insert into claims (document_id, predicate, text_canonical, polarity, modality, reported_by_source_id, attributed_to_type, attributed_to_id, confidence, status, created_at)
       select document, 'business.competition', 'AMD competes with us, ' || n, 'neutral', 'quoted', $1, 'issuer', issuer::text, 1, 'extracted', '2026-01-02'
         from bulk cross join generate_series(1, 50) n where g <= 5 or n = 1
       returning claim_id, attributed_to_id::uuid as issuer
     )
     insert into claim_arguments (claim_id, subject_kind, subject_id, role)
     select claim_id, 'issuer'::subject_kind, issuer, 'subject' from made union all select claim_id, 'issuer'::subject_kind, $2::uuid, 'competitor' from made`,
    [SOURCE, AMD],
  );
  const bulk = await loadLatestFilingClaims(db, { issuer_ids: [AMD], role: "competitor", predicates: ["business.competition"], as_of: "2026-11-15T00:00:00Z" });
  assert.deepEqual([bulk.claims.length, new Set(bulk.reads.map((r) => r.filer_issuer_id)).size, bulk.truncated], [CLAIMS_PER_READ, FILERS_PER_READ, true],
    "32 filers and 277 claims name AMD; one read returns the first 20 filers and 200 claims, and says it left some out");
  assert.deepEqual(bulk.reads.slice(0, 2).map((r) => r.filer_label), ["Bulk 001", "Bulk 002"], "filers in label order");
  await db.query(`update claims set predicate = 'business.products' where text_canonical like 'AMD competes with us, %' and text_canonical <> 'AMD competes with us, 1'`);
  const oneEach = await loadLatestFilingClaims(db, { issuer_ids: [AMD], role: "competitor", predicates: ["business.competition"], as_of: "2026-11-15T00:00:00Z" });
  assert.deepEqual([oneEach.claims.length, oneEach.truncated], [FILERS_PER_READ, true], "one claim from each of the first 20 filers, and the read says 12 filers were left out");
});
