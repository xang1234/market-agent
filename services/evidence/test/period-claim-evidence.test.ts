import test from "node:test";
import assert from "node:assert/strict";

import { createClaim, listClaimsForDocument, type ClaimPeriod } from "../src/claim-repo.ts";
import { joinedEvidence, loadPeriodClaimEvidence, lockCitableClaims } from "../src/local-runtime-evidence.ts";
import type { QueryExecutor } from "../src/types.ts";
import { bootstrapDatabase, connectedClient, dockerAvailable } from "../../../db/test/docker-pg.ts";

// A period lookup (#542), end to end against Postgres: a company's claims
// bound to the fiscal quarter or year asked, by its kind and end date, and no
// other claim. Not one filed near it, not one bound to a period that ends the
// same day, and not one written, published or bound after the cutoff.

const FILINGS = "c2222222-2222-4222-8222-222222222222";
const PRIVATE = "c2222222-2222-4222-8222-222222222223";
const OWNER = "c3333333-3333-4333-8333-333333333333";
const Q2: ClaimPeriod = { kind: "fiscal_q", end: "2025-06-28" };
const Q3: ClaimPeriod = { kind: "fiscal_q", end: "2025-09-27" };
const EXPLANATION = "management.explanation.";
const GROSS_MARGIN = "management.explanation.gross_margin";
const REVENUE = "management.explanation.revenue";

let companies = 0;
let written = 0;
async function company(db: QueryExecutor): Promise<string> {
  const issuer = `c1111111-1111-4111-8111-${String(++companies).padStart(12, "0")}`;
  await db.query(`insert into issuers (issuer_id, legal_name) values ($1, $2)`, [issuer, `Company ${companies}`]);
  return issuer;
}

// A claim about the issuer, in a document of its own published when it was
// said. A bound claim's period was bound when the claim was written.
async function claim(
  db: QueryExecutor,
  issuer: string,
  input: {
    predicate: string; text: string; at: string; period?: ClaimPeriod;
    published?: string; created?: string; bound?: string; source?: string; role?: string; ir?: boolean;
  },
): Promise<string> {
  const n = String(++written).padStart(12, "0");
  const [id, document] = [`c9000000-0000-4000-8000-${n}`, `c6000000-0000-4000-8000-${n}`];
  const created = input.created ?? input.at;
  await db.query(
    `insert into documents (document_id, source_id, kind, content_hash, raw_blob_id, published_at, created_at)
     values ($1, $2, 'filing', $3, $4, $5, $5)`,
    [document, input.source ?? FILINGS, `hash-${document}`, `sha256:${document}`, input.published ?? input.at],
  );
  await db.query(
    `insert into claims (claim_id, document_id, predicate, text_canonical, polarity, modality, reported_by_source_id,
                         effective_time, confidence, status, created_at, period_kind, period_end, period_bound_at)
     values ($1, $2, $3, $4, 'negative', 'asserted', $5, $6, 0.9, 'extracted', $7, $8, $9, $10)`,
    [id, document, input.predicate, input.text, input.source ?? FILINGS, input.at, created,
     input.period?.kind ?? null, input.period?.end ?? null, input.period ? input.bound ?? created : null],
  );
  await db.query(
    `insert into claim_arguments (claim_id, subject_kind, subject_id, role) values ($1, 'issuer', $2, $3)`,
    [id, issuer, input.role ?? "subject"],
  );
  if (input.ir) {
    await db.query(
      `insert into ir_document_assets (issuer_id, document_id, source_id, asset_kind, canonical_url, discovered_at, fetched_at)
       values ($1, $2, $3, 'press_release', $4, $5, $5)`,
      [issuer, document, input.source ?? FILINGS, `https://ir.example.com/${n}`, input.published ?? input.at],
    );
  }
  return id;
}

test("a period lookup returns a company's claims bound to that period (#542)", async (t) => {
  if (!dockerAvailable()) return t.skip("docker unavailable");
  const { databaseUrl } = await bootstrapDatabase(t, "evidence-period-lookup");
  const db = (await connectedClient(t, databaseUrl)) as unknown as QueryExecutor;
  await db.query(`insert into users (user_id, email) values ($1, 'owner@example.com')`, [OWNER]);
  await db.query(
    `insert into sources (source_id, provider, kind, trust_tier, license_class, retrieved_at, user_id)
     values ($1, 'sec_edgar', 'filing', 'primary', 'public', now(), null),
            ($2, 'upload', 'upload', 'user', 'private', now(), $3)`,
    [FILINGS, PRIVATE, OWNER],
  );
  const lookup = async (
    issuer: string,
    period: ClaimPeriod,
    predicate_prefixes: ReadonlyArray<string | ReadonlyArray<string>>,
    options: { as_of?: string; limit?: number; user_id?: string; exclude_claim_ids?: ReadonlyArray<string>; first_claim_ids?: ReadonlyArray<string> } = {},
  ) => (await loadPeriodClaimEvidence(db, { issuer_id: issuer, period, predicate_prefixes, ...options })).claim_refs;
  const margin = (text: string, at: string, period?: ClaimPeriod) => ({ predicate: GROSS_MARGIN, text, at, period });

  await t.test("a quarter's lookup returns its own claim, not the next quarter's filed 84 days later, nor an unbound one filed in its window", async () => {
    const acme = await company(db);
    const own = await claim(db, acme, margin("Gross margin fell on an inventory charge.", "2025-08-05T20:00:00Z", Q2));
    const next = await claim(db, acme, margin("Gross margin recovered as the charge did not recur.", "2025-10-28T20:00:00Z", Q3));
    await claim(db, acme, margin("Gross margin was pressured by export controls.", "2025-08-02T20:00:00Z"));
    assert.deepEqual(await lookup(acme, Q2, [GROSS_MARGIN]), [own]);
    assert.deepEqual(await lookup(acme, Q3, [GROSS_MARGIN]), [next]);
  });

  await t.test("claims rank by their prefix's tier before recency, a group shares one tier, and one no prefix matches is not read", async () => {
    const acme = await company(db);
    const grossMargin = await claim(db, acme, margin("Gross margin fell on an inventory charge.", "2025-08-05T20:00:00Z", Q2));
    const revenue = await claim(db, acme, { predicate: REVENUE, text: "Revenue grew on data center sales.", at: "2025-08-06T20:00:00Z", period: Q2 });
    await claim(db, acme, { predicate: "management.explanation.operating_expenses", text: "Operating expenses rose on research.", at: "2025-08-07T20:00:00Z", period: Q2 });
    assert.deepEqual(await lookup(acme, Q2, [GROSS_MARGIN, REVENUE]), [grossMargin, revenue]);
    assert.deepEqual(await lookup(acme, Q2, [REVENUE, GROSS_MARGIN]), [revenue, grossMargin]);
    assert.deepEqual(await lookup(acme, Q2, [[GROSS_MARGIN, REVENUE]]), [revenue, grossMargin]);
  });

  await t.test("within one tier claims come newest first, so a limit of two keeps Aug 5 and Aug 4 over Jul 5", async () => {
    const acme = await company(db);
    const august5 = await claim(db, acme, margin("Gross margin fell on an inventory charge.", "2025-08-05T20:00:00Z", Q2));
    const august4 = await claim(db, acme, margin("Gross margin fell on lower utilization.", "2025-08-04T20:00:00Z", Q2));
    await claim(db, acme, { predicate: REVENUE, text: "Revenue grew on data center sales.", at: "2025-07-05T20:00:00Z", period: Q2 });
    assert.deepEqual(await lookup(acme, Q2, [EXPLANATION], { limit: 2 }), [august5, august4]);
  });

  await t.test("a statement bound to one period and filed again a calendar quarter later counts once, as its first filing", async () => {
    const acme = await company(db);
    const august = await claim(db, acme, margin("Gross margin fell on an inventory charge.", "2025-08-01T20:00:00Z", Q2));
    await claim(db, acme, margin("Gross margin fell on an inventory charge.", "2025-10-01T20:00:00Z", Q2));
    assert.deepEqual(await lookup(acme, Q2, [GROSS_MARGIN]), [august]);
  });

  await t.test("of a bound and an unbound copy of one sentence, the bound one returns, though the unbound was filed first", async () => {
    const acme = await company(db);
    await claim(db, acme, margin("Gross margin fell on an inventory charge.", "2025-08-01T20:00:00Z"));
    const bound = await claim(db, acme, margin("Gross margin fell on an inventory charge.", "2025-08-05T20:00:00Z", Q2));
    assert.deepEqual(await lookup(acme, Q2, [GROSS_MARGIN]), [bound]);
  });

  await t.test("an issuer-IR copy of a bound explanation is not read, though published first; the same sentence filed on an 8-K is", async () => {
    const acme = await company(db);
    await claim(db, acme, { ...margin("Gross margin fell on an inventory charge.", "2025-08-04T20:00:00Z", Q2), ir: true });
    await claim(db, acme, { ...margin("Gross margin fell on lower utilization.", "2025-08-04T20:00:00Z", Q2), ir: true });
    const filed = await claim(db, acme, margin("Gross margin fell on an inventory charge.", "2025-08-05T20:00:00Z", Q2));
    assert.deepEqual(await lookup(acme, Q2, [GROSS_MARGIN]), [filed]);
  });

  await t.test("at a fiscal year's end, the year and its fourth quarter are two periods", async () => {
    const acme = await company(db);
    const year: ClaimPeriod = { kind: "fiscal_y", end: "2025-12-27" };
    const fourth: ClaimPeriod = { kind: "fiscal_q", end: "2025-12-27" };
    const at = "2026-02-03T21:00:00Z";
    const yearClaim = await claim(db, acme, { predicate: REVENUE, text: "Full-year revenue grew on data center demand.", at, period: year });
    const fourthClaim = await claim(db, acme, { predicate: REVENUE, text: "Fourth-quarter revenue grew on client sales.", at, period: fourth });
    assert.deepEqual(await lookup(acme, year, [REVENUE]), [yearClaim]);
    assert.deepEqual(await lookup(acme, fourth, [REVENUE]), [fourthClaim]);
  });

  await t.test("a claim written before the cutoff but published after it returns once the cutoff passes its publication", async () => {
    const acme = await company(db);
    const id = await claim(db, acme, { ...margin("Gross margin fell on an inventory charge.", "2025-08-10T20:00:00Z", Q2), created: "2025-08-01T00:00:00Z" });
    assert.deepEqual(await lookup(acme, Q2, [GROSS_MARGIN], { as_of: "2025-08-07T00:00:00Z" }), []);
    assert.deepEqual(await lookup(acme, Q2, [GROSS_MARGIN], { as_of: "2025-08-11T00:00:00Z" }), [id]);
  });

  await t.test("a claim extracted again after the cutoff is not returned until the cutoff passes it", async () => {
    const acme = await company(db);
    const first = await claim(db, acme, margin("Gross margin fell on an inventory charge.", "2025-08-05T20:00:00Z", Q2));
    const late = await claim(db, acme, { ...margin("Gross margin fell on a charge for excess inventory.", "2025-08-05T20:00:00Z", Q2), created: "2025-09-15T00:00:00Z" });
    assert.deepEqual(await lookup(acme, Q2, [GROSS_MARGIN], { as_of: "2025-09-01T00:00:00Z" }), [first]);
    assert.deepEqual([...(await lookup(acme, Q2, [GROSS_MARGIN], { as_of: "2025-09-16T00:00:00Z" }))].sort(), [first, late].sort());
  });

  await t.test("a claim bound to the period after the cutoff is not returned until the cutoff passes its binding", async () => {
    const acme = await company(db);
    const rebound = await claim(db, acme, { ...margin("Gross margin fell on an inventory charge.", "2025-08-05T20:00:00Z", Q2), bound: "2025-09-15T00:00:00Z" });
    assert.deepEqual(await lookup(acme, Q2, [GROSS_MARGIN], { as_of: "2025-09-01T00:00:00Z" }), []);
    assert.deepEqual(await lookup(acme, Q2, [GROSS_MARGIN], { as_of: "2025-09-16T00:00:00Z" }), [rebound]);
  });

  await t.test("only the company's own claims a user may see: not another's, not one naming it as a competitor, not one excluded", async () => {
    const [acme, rival] = [await company(db), await company(db)];
    const own = await claim(db, acme, margin("Gross margin fell on an inventory charge.", "2025-08-05T20:00:00Z", Q2));
    const uploaded = await claim(db, acme, { ...margin("Gross margin fell on lower utilization.", "2025-08-06T20:00:00Z", Q2), source: PRIVATE });
    await claim(db, rival, margin("Gross margin rose on pricing.", "2025-08-07T20:00:00Z", Q2));
    await claim(db, acme, { ...margin("Gross margin rose as a rival's charge did not hit it.", "2025-08-08T20:00:00Z", Q2), role: "competitor" });
    assert.deepEqual(await lookup(acme, Q2, [GROSS_MARGIN]), [own]);
    assert.deepEqual(await lookup(acme, Q2, [GROSS_MARGIN], { user_id: OWNER }), [uploaded, own]);
    assert.deepEqual(await lookup(acme, Q2, [GROSS_MARGIN], { user_id: OWNER, exclude_claim_ids: [uploaded] }), [own]);
  });

  await t.test("createClaim binds a claim to its period when it writes it, and the period's lookup returns it", async () => {
    const acme = await company(db);
    const document = "c6000000-0000-4000-8000-0000000000f1";
    await db.query(
      `insert into documents (document_id, source_id, kind, content_hash, raw_blob_id, published_at)
       values ($1, $2, 'filing', 'hash-written', 'sha256:written', '2025-08-05T20:00:00Z')`,
      [document, FILINGS],
    );
    const write = (period: ClaimPeriod | null, text: string) => createClaim(db, {
      document_id: document,
      predicate: "management.explanation.operating_income",
      text_canonical: text,
      polarity: "negative",
      modality: "asserted",
      reported_by_source_id: FILINGS,
      effective_time: "2025-08-05T20:00:00Z",
      confidence: 0.9,
      status: "extracted",
      period,
    });
    const bound = await write(Q2, "Operating income fell on the inventory charge.");
    const unbound = await write(null, "Operating income fell on higher research spending.");
    assert.deepEqual(bound.period, { kind: "fiscal_q", end: "2025-06-28" });
    assert.deepEqual((await listClaimsForDocument(db, document)).map((row) => row.period), [{ kind: "fiscal_q", end: "2025-06-28" }, null]);
    const { rows } = await db.query<{ claim_id: string; bound_when_written: boolean | null }>(
      `select claim_id::text, period_bound_at = created_at as bound_when_written from claims where claim_id = any($1::uuid[]) order by created_at, claim_id`,
      [[bound.claim_id, unbound.claim_id]],
    );
    assert.deepEqual(
      Object.fromEntries(rows.map((row) => [row.claim_id, row.bound_when_written])),
      { [bound.claim_id]: true, [unbound.claim_id]: null },
    );
    await db.query(
      `insert into claim_arguments (claim_id, subject_kind, subject_id, role) values ($1, 'issuer', $3, 'subject'), ($2, 'issuer', $3, 'subject')`,
      [bound.claim_id, unbound.claim_id, acme],
    );
    assert.deepEqual(await lookup(acme, Q2, ["management.explanation.operating_income"]), [bound.claim_id]);
    assert.deepEqual(await lookup(acme, Q3, ["management.explanation.operating_income"]), []);
  });

  await t.test("a lock that skips what another session is changing checks the rest: a claim whose document is being written is unchecked, one deleted is not citable (#557)", async () => {
    const acme = await company(db);
    const [kept, written, deleted] = await Promise.all(["Gross margin fell on an inventory charge.", "Gross margin fell on lower utilization.", "Gross margin fell on pricing."]
      .map((text, i) => claim(db, acme, margin(text, `2025-08-0${i + 1}T20:00:00Z`, Q2))));
    const documentOf = async (claimId: string) => (await db.query<{ document_id: string }>(`select document_id::text from claims where claim_id = $1`, [claimId])).rows[0]!.document_id;
    await db.query(`update documents set deleted_at = now() where document_id = $1`, [await documentOf(deleted!)]);
    const writer = await connectedClient(t, databaseUrl);
    await writer.query("begin");
    await writer.query(`select 1 from documents where document_id = $1 for no key update`, [await documentOf(written!)]);
    await db.query("begin");
    try {
      const locked = await lockCitableClaims(db, { claim_ids: [kept!, written!, deleted!], skip_locked: true });
      assert.deepEqual([[...locked.citable], [...locked.unchecked]], [[kept], [written]]);
    } finally {
      await db.query("rollback");
      await writer.query("rollback");
    }
  });

  await t.test("a claim asked to come first is never another's repeat: its twin filed earlier does not take its place (#558)", async () => {
    const acme = await company(db);
    await claim(db, acme, margin("Gross margin fell on a reserve.", "2025-08-01T20:00:00Z", Q2));
    const quoted = await claim(db, acme, margin("Gross margin fell on a reserve.", "2025-08-05T20:00:00Z", Q2));
    assert.deepEqual(await lookup(acme, Q2, [GROSS_MARGIN], { first_claim_ids: [quoted] }), [quoted]);
  });

  await t.test("claims asked to come first that the company did not make raise no limit of its own (#558)", async () => {
    const [acme, beta] = [await company(db), await company(db)];
    const newest = await claim(db, acme, margin("Gross margin fell on a reserve.", "2025-08-05T20:00:00Z", Q2));
    await claim(db, acme, margin("Gross margin fell on lower yields.", "2025-08-04T20:00:00Z", Q2));
    const others = [
      await claim(db, beta, margin("Gross margin rose on mix.", "2025-08-03T20:00:00Z", Q2)),
      await claim(db, beta, margin("Gross margin rose on pricing.", "2025-08-02T20:00:00Z", Q2)),
    ];
    assert.deepEqual(await lookup(acme, Q2, [GROSS_MARGIN], { limit: 1, first_claim_ids: others }), [newest]);
  });

  await t.test("a period read says when more of the company's claims matched than its limit returned (#558)", async () => {
    const acme = await company(db);
    await claim(db, acme, margin("Gross margin fell on a reserve.", "2025-08-05T20:00:00Z", Q2));
    await claim(db, acme, margin("Gross margin fell on lower yields.", "2025-08-04T20:00:00Z", Q2));
    const read = async (limit: number) => (await loadPeriodClaimEvidence(db, { issuer_id: acme, period: Q2, predicate_prefixes: [GROSS_MARGIN], limit })).truncated;
    assert.deepEqual([await read(1), await read(2)], [true, false]);
  });

  await t.test("reads joined as one keep each claim as the first read returned it, and the stored contradictions among all their claims, across reads too (#558)", async () => {
    const [acme, beta] = [await company(db), await company(db)];
    const shared = await claim(db, acme, margin("Gross margin fell on lower yields.", "2025-08-04T20:00:00Z", Q2));
    await db.query(`insert into claim_arguments (claim_id, subject_kind, subject_id, role) values ($1, 'issuer', $2, 'subject')`, [shared, beta]);
    const acmeOnly = await claim(db, acme, margin("Gross margin fell on export controls.", "2025-08-05T20:00:00Z", Q2));
    const disputed = await claim(db, beta, margin("Gross margin was not hurt by export controls.", "2025-08-06T20:00:00Z", Q2));
    const { rows: [cluster] } = await db.query<{ cluster_id: string }>(
      `insert into claim_clusters (canonical_signature, first_seen_at, last_seen_at) values ('export controls #558', now(), now()) returning cluster_id::text`,
    );
    await db.query(
      `insert into claim_cluster_members (cluster_id, claim_id, relation) values ($1, $2, 'support'), ($1, $3, 'contradict')`,
      [cluster!.cluster_id, acmeOnly, disputed],
    );
    const read = (issuer: string) => loadPeriodClaimEvidence(db, { issuer_id: issuer, period: Q2, predicate_prefixes: [GROSS_MARGIN] });
    const joined = await joinedEvidence(db, [{ kind: "issuer", id: acme }, { kind: "issuer", id: beta }], [await read(acme), await read(beta)]);
    assert.deepEqual(joined.claims.map((row) => [row.claim_id, row.subject_id]), [[acmeOnly, acme], [shared, acme], [disputed, beta]]);
    assert.deepEqual(joined.contradictions, [[acmeOnly, disputed]]);
  });
});
