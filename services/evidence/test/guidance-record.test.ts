import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";

import { guidanceRecord, type SplitHistory, type StoredFigure, type StoredRelease } from "../src/guidance-record.ts";
import { createEvidenceReviewServer } from "../src/review-http.ts";
import { bootstrapDatabase, connectedClient, connectedPool, dockerAvailable } from "../../../db/test/docker-pg.ts";

// NVIDIA-shaped releases: each reports a quarter and guides the next.
const Q1 = release("q1", "2025-04-27", "2025-05-28");
const Q2 = release("q2", "2025-07-27", "2025-08-27");

function release(document_id: string, quarter_end: string, filed_on: string): StoredRelease {
  return { document_id, quarter_end, filed_on, url: `https://www.sec.gov/${document_id}` };
}

function guide(of: StoredRelease, metric: StoredFigure["metric"], basis: StoredFigure["basis"], low: number, high: number): StoredFigure {
  return { document_id: of.document_id, claim_id: `claim-${of.document_id}-${metric}-${basis}`, kind: "guidance", metric, basis, low, high, quote: `${basis} ${metric} is expected to be ${low} to ${high}.` };
}

function result(of: StoredRelease, metric: StoredFigure["metric"], basis: StoredFigure["basis"], value: number): StoredFigure {
  return { document_id: of.document_id, claim_id: null, kind: "result", metric, basis, low: value, high: value, quote: `${basis} ${metric} was ${value}.` };
}

// Split history checked after every release here, with no split.
const NO_SPLITS: SplitHistory = { checked_through: "2099-12-31", splits: [] };

const row = (record: ReturnType<typeof guidanceRecord>, metric: string, basis: string) =>
  record.rows.find((entry) => entry.metric === metric && entry.basis === basis);

test("a non-GAAP guide is never compared with a GAAP actual: with no non-GAAP actual it is not comparable", () => {
  const record = guidanceRecord([Q1, Q2], [
    guide(Q1, "gross_margin", "non_gaap", 71.5, 72.5),
    guide(Q1, "gross_margin", "gaap", 71.3, 72.3),
    result(Q2, "gross_margin", "gaap", 72.4),
  ], NO_SPLITS);
  const nonGaap = row(record, "gross_margin", "non_gaap");
  assert.equal(nonGaap?.outcome, "not_comparable");
  assert.equal(nonGaap?.reason, "no_same_basis_actual");
  assert.equal(nonGaap?.actual, null);
  assert.equal(nonGaap?.quarter_end, "2025-07-27");
  // The GAAP guide is compared with the GAAP actual, citing both releases.
  const gaap = row(record, "gross_margin", "gaap");
  assert.equal(gaap?.outcome, "beat");
  assert.deepEqual(
    [gaap?.guided.source.document_id, gaap?.guided.source.claim_id, gaap?.actual?.source.document_id, gaap?.actual?.value],
    ["q1", "claim-q1-gross_margin-gaap", "q2", 72.4],
  );
});

test("a GAAP guide is never compared with a non-GAAP actual either", () => {
  const record = guidanceRecord([Q1, Q2], [
    guide(Q1, "operating_expenses", "gaap", 5.6e9, 5.6e9),
    result(Q2, "operating_expenses", "non_gaap", 4.1e9),
  ], NO_SPLITS);
  assert.equal(row(record, "operating_expenses", "gaap")?.outcome, "not_comparable");
  assert.equal(row(record, "operating_expenses", "gaap")?.actual, null);
});

test("a guide is for the quarter after its release's, which the next release reports; the latest release's guide is not yet reported", () => {
  const Q4 = release("q4", "2026-01-25", "2026-02-25");
  const record = guidanceRecord([Q1, Q2, Q4], [
    guide(Q1, "revenue", "gaap", 44.1e9, 45.9e9),
    result(Q2, "revenue", "gaap", 46.7e9),
    // Q2's guide has no release for its quarter on file, though a later one is.
    guide(Q2, "revenue", "gaap", 52.9e9, 55.1e9),
    result(Q4, "revenue", "gaap", 68.1e9),
    guide(Q4, "revenue", "gaap", 76.4e9, 79.6e9),
  ], NO_SPLITS);
  assert.deepEqual(record.rows.map((entry) => [entry.quarter_end, entry.guided.low, entry.outcome]), [
    [null, 76.4e9, "not_yet_reported"],
    ["2025-07-27", 44.1e9, "beat"],
  ]);
});

test("an actual within the range is in line, below it a miss; for costs, below the range is the beat", () => {
  const record = guidanceRecord([Q1, Q2], [
    guide(Q1, "revenue", "gaap", 44.1e9, 45.9e9),
    result(Q2, "revenue", "gaap", 44.1e9),
    guide(Q1, "eps", "non_gaap", 1.0, 1.0),
    result(Q2, "eps", "non_gaap", 0.99),
    guide(Q1, "operating_expenses", "non_gaap", 4.0e9, 4.0e9),
    result(Q2, "operating_expenses", "non_gaap", 3.9e9),
    guide(Q1, "capex", "gaap", 1.0e9, 1.2e9),
    result(Q2, "capex", "gaap", 1.3e9),
  ], NO_SPLITS);
  assert.deepEqual(record.rows.map((entry) => [entry.metric, entry.outcome]), [
    ["revenue", "in_line"],
    ["operating_expenses", "beat"],
    ["eps", "miss"],
    ["capex", "miss"],
  ]);
});

test("the same guide repeated in two exhibits is one guide; different ranges or different actuals for one quarter are not comparable", () => {
  const twice = guidanceRecord([Q1, Q2], [
    guide(Q1, "revenue", "gaap", 44.1e9, 45.9e9),
    { ...guide(Q1, "revenue", "gaap", 44.1e9, 45.9e9), quote: "Revenue is expected to be $45.0 billion, plus or minus 2%." },
    result(Q2, "revenue", "gaap", 46.7e9),
    result(Q2, "revenue", "gaap", 46.7e9),
  ], NO_SPLITS);
  assert.deepEqual(twice.rows.map((entry) => entry.outcome), ["beat"]);
  const conflicting = guidanceRecord([Q1, Q2], [
    guide(Q1, "revenue", "gaap", 44.1e9, 45.9e9),
    guide(Q1, "revenue", "gaap", 37.1e9, 38.6e9),
    result(Q2, "revenue", "gaap", 46.7e9),
    guide(Q1, "gross_margin", "non_gaap", 71.5, 72.5),
    result(Q2, "gross_margin", "non_gaap", 72.7),
    result(Q2, "gross_margin", "non_gaap", 72.3),
  ], NO_SPLITS);
  assert.deepEqual(conflicting.rows.map((entry) => [entry.metric, entry.outcome, entry.reason]), [
    ["revenue", "not_comparable", "conflicting_guidance"],
    ["gross_margin", "not_comparable", "conflicting_actuals"],
  ]);
});

test("the hit rate counts in-line and beaten guides over the last 8 reported quarters, per metric and basis, leaving out ones not comparable", () => {
  // Ten quarters, 91 days apart, each guiding the next.
  const releases = Array.from({ length: 10 }, (_, n) => {
    const end = new Date(Date.UTC(2023, 0, 29) + n * 91 * 86_400_000).toISOString().slice(0, 10);
    return release(`r${n}`, end, end);
  });
  const figures = releases.flatMap((of, n) => [
    ...(n > 0 ? [result(of, "revenue", "gaap", n % 3 === 0 ? 9 : 11), result(of, "gross_margin", "gaap", 60)] : []),
    guide(of, "revenue", "gaap", 10, 10),
    guide(of, "gross_margin", "non_gaap", 59, 61),
  ]);
  const record = guidanceRecord(releases, figures, NO_SPLITS);
  // Quarters 2 to 9 are the last 8: quarters 3, 6 and 9 missed revenue; no
  // non-GAAP margin was reported, so none of those guides is compared.
  assert.deepEqual(record.hit_rates, [{ metric: "revenue", basis: "gaap", hits: 5, compared: 8 }]);
  assert.equal(record.rows.filter((entry) => entry.reason === "no_same_basis_actual").length, 8);
  assert.equal(record.rows.filter((entry) => entry.outcome === "not_yet_reported").length, 2);
});

test("conflicting guides for the next quarter are not comparable before it is reported too, and count in no hit rate", () => {
  const record = guidanceRecord([Q1, Q2], [
    guide(Q2, "revenue", "gaap", 45e9, 45e9),
    { ...guide(Q2, "revenue", "gaap", 46e9, 46e9), quote: "Revenue is expected to be $46.0 billion." },
    guide(Q2, "gross_margin", "non_gaap", 71.5, 72.5),
  ], NO_SPLITS);
  assert.deepEqual(record.rows.map((entry) => [entry.quarter_end, entry.metric, entry.actual, entry.outcome, entry.reason]), [
    [null, "revenue", null, "not_comparable", "conflicting_guidance"],
    [null, "gross_margin", null, "not_yet_reported", undefined],
  ]);
  assert.deepEqual(record.hit_rates, []);
});

test("EPS is compared only on one share count: not across a recorded split, nor without split history through the actual's release", () => {
  const figures = [guide(Q1, "eps", "non_gaap", 10, 11), result(Q2, "eps", "non_gaap", 1.2), guide(Q1, "revenue", "gaap", 44e9, 46e9), result(Q2, "revenue", "gaap", 47e9)];
  const outcomes = (splits: SplitHistory) => guidanceRecord([Q1, Q2], figures, splits).rows.map((entry) => [entry.metric, entry.outcome, entry.reason]);
  // A 10-for-1 split between the guide's release and the actual's.
  assert.deepEqual(outcomes({ checked_through: "2025-09-01", splits: ["2025-06-10"] }), [
    ["revenue", "beat", undefined],
    ["eps", "not_comparable", "split_between_releases"],
  ]);
  // Split history never checked, or checked before the actual was filed.
  for (const checked_through of [null, "2025-08-01"]) {
    assert.deepEqual(outcomes({ checked_through, splits: [] }), [["revenue", "beat", undefined], ["eps", "not_comparable", "split_history_missing"]]);
  }
  // A split before the guide or after the actual leaves both on one share count.
  assert.deepEqual(outcomes({ checked_through: "2026-01-01", splits: ["2024-06-10", "2025-12-01"] }), [["revenue", "beat", undefined], ["eps", "miss", undefined]]);
});

test("an issuer's record is a public read: each guide beside the next release's actual on its basis, both linked to their filings", { skip: !dockerAvailable(), timeout: 180_000 }, async (t) => {
  const { databaseUrl } = await bootstrapDatabase(t, "guidance-record");
  const client = await connectedClient(t, databaseUrl);
  const { rows: [ids] } = await client.query<{ issuer_id: string; source_id: string }>(
    `with issuer as (insert into issuers (legal_name, cik) values ('NVIDIA Corp', '0001045810') returning issuer_id),
          source as (insert into sources (provider, kind, trust_tier, license_class, retrieved_at) values ('sec_edgar', 'filing', 'primary', 'public', now()) returning source_id)
     select issuer.issuer_id::text, source.source_id::text from issuer, source`,
  );
  const seedRelease = async (accession: string, quarterEnd: string, filedOn: string) => {
    const documentId = (await client.query<{ id: string }>(
      `insert into documents (source_id, kind, provider_doc_id, content_hash, raw_blob_id) values ($1, 'filing', $2, $2, $2) returning document_id::text as id`,
      [ids!.source_id, accession],
    )).rows[0]!.id;
    await client.query(`insert into earnings_release_quarters (document_id, issuer_id, quarter_end, filed_on) values ($1, $2, $3, $4)`, [documentId, ids!.issuer_id, quarterEnd, filedOn]);
    return documentId;
  };
  const q1 = await seedRelease("0001045810-25-000115", "2025-04-27", "2025-05-28");
  const q2 = await seedRelease("0001045810-25-000207", "2025-07-27", "2025-08-27");
  const guideClaim = async (quote: string, superseded = false) => (await client.query<{ id: string }>(
    `insert into claims (document_id, predicate, text_canonical, polarity, modality, reported_by_source_id, confidence, status, superseded_at)
     values ($1, 'guidance.revenue', $2, 'neutral', 'quoted', $3, 0.8, 'extracted', $4) returning claim_id::text as id`,
    [q1, quote, ids!.source_id, superseded ? new Date() : null],
  )).rows[0]!.id;
  const figure = (documentId: string, claimId: string | null, kind: string, basis: string, low: number, high: number, quote: string, metric = "revenue") => client.query(
    `insert into earnings_release_figures (document_id, claim_id, kind, metric, basis, low, high, quote) values ($1, $2, $3, $8, $4, $5, $6, $7)`,
    [documentId, claimId, kind, basis, low, high, quote, metric],
  );
  const guide = "Revenue is expected to be $45.0 billion, plus or minus 2%.";
  const claimId = await guideClaim(guide);
  await figure(q1, claimId, "guidance", "gaap", 44.1e9, 45.9e9, guide);
  // A guidance claim no longer current guides nothing.
  await figure(q1, await guideClaim("Revenue is expected to be $40.0 billion.", true), "guidance", "non_gaap", 40e9, 40e9, "Revenue is expected to be $40.0 billion.");
  await figure(q2, null, "result", "gaap", 46.7e9, 46.7e9, "Revenue was $46.7 billion.");
  // A 10-for-1 split between the two releases, as Polygon records it.
  await figure(q1, await guideClaim("Non-GAAP diluted EPS is expected to be $10.50."), "guidance", "non_gaap", 10.5, 10.5, "Non-GAAP diluted EPS is expected to be $10.50.", "eps");
  await figure(q2, null, "result", "non_gaap", 1.2, 1.2, "Non-GAAP diluted EPS was $1.20.", "eps");
  await client.query(
    `with instrument as (insert into instruments (issuer_id, asset_type) values ($1, 'common_stock') returning instrument_id),
          listing as (insert into listings (instrument_id, mic, ticker, trading_currency, timezone) select instrument_id, 'XNAS', 'NVDA', 'USD', 'America/New_York' from instrument returning listing_id),
          coverage as (insert into listing_split_coverage (listing_id, checked_at, source_id) select listing_id, '2025-09-01T00:00:00Z', $2 from listing)
     insert into listing_splits (listing_id, execution_date, split_from, split_to, source_id) select listing_id, '2025-06-10', 1, 10, $2 from listing`,
    [ids!.issuer_id, ids!.source_id],
  );

  const pool = await connectedPool(t, databaseUrl);
  const server = createEvidenceReviewServer(pool);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/evidence/guidance-record?issuer_id=${ids!.issuer_id}`);
  assert.equal(response.status, 200);
  const body = await response.json() as { issuer_id: string; quarters: number; record: ReturnType<typeof guidanceRecord> };
  assert.equal(body.issuer_id, ids!.issuer_id);
  assert.equal(body.quarters, 8);
  assert.deepEqual(body.record.rows.slice(0, 1), [{
    quarter_end: "2025-07-27",
    metric: "revenue",
    basis: "gaap",
    unit: "usd",
    guided: { low: 44.1e9, high: 45.9e9, source: { document_id: q1, claim_id: claimId, filed_on: "2025-05-28", url: "https://www.sec.gov/Archives/edgar/data/1045810/000104581025000115/0001045810-25-000115-index.htm", quote: guide } },
    actual: { value: 46.7e9, source: { document_id: q2, claim_id: null, filed_on: "2025-08-27", url: "https://www.sec.gov/Archives/edgar/data/1045810/000104581025000207/0001045810-25-000207-index.htm", quote: "Revenue was $46.7 billion." } },
    outcome: "beat",
  }]);
  assert.deepEqual(body.record.rows.slice(1).map((entry) => [entry.metric, entry.outcome, entry.reason]), [["eps", "not_comparable", "split_between_releases"]]);
  assert.deepEqual(body.record.hit_rates, [{ metric: "revenue", basis: "gaap", hits: 1, compared: 1 }]);
  const bad = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/evidence/guidance-record?issuer_id=nvda`);
  assert.equal(bad.status, 400);
});
