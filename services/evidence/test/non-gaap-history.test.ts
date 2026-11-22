import test from "node:test";
import assert from "node:assert/strict";

import { addBackCategory, loadNonGaapHistory, nonGaapHistory, type StoredRelease } from "../src/non-gaap-history.ts";
import { MemoryObjectStore, rawBlobIdFromBytes } from "../src/object-store.ts";
import { readReleaseReconciliations, releaseReconciliations, runReconciliationDrain } from "../src/sec-non-gaap-reconciliations.ts";
import { bootstrapDatabase, connectedClient, dockerAvailable } from "../../../db/test/docker-pg.ts";
import { EXAMPLE_ACCESSION, EXAMPLE_FILED_ON, RELEASE_SUBMISSION } from "./fixtures/sec-8k-release.ts";

test("a release keeps the quarter it reports: the latest three-month column ended by its filing", () => {
  const read = releaseReconciliations(RELEASE_SUBMISSION, EXAMPLE_FILED_ON);
  assert.equal(read.quarter_end, "2025-10-26");
  assert.deepEqual(read.revenue, { exhibit: "EX-99.1", label: "Revenue", value_num: 57_006, scale: "millions" });
  assert.deepEqual(read.reconciliations.map((line) => [line.measure_key, line.gaap.value_num, line.non_gaap.value_num]), [
    ["gross_profit", 41_849, 42_147],
    ["operating_expenses", 5_839, 4_325],
    ["operating_income", 36_010, 37_822],
    ["net_income", 31_910, 33_366],
    ["eps_diluted", 1.3, 1.36],
  ]);
  assert.ok(read.reconciliations.every((line) => line.exhibit === "EX-99.1" && line.scale === "millions"));
  // Filed before the quarter ended, or long after, it dates nothing.
  assert.equal(releaseReconciliations(RELEASE_SUBMISSION, "2025-10-20").quarter_end, "2025-07-27");
  assert.equal(releaseReconciliations(RELEASE_SUBMISSION, "2026-06-01").quarter_end, null);
  assert.deepEqual(releaseReconciliations(RELEASE_SUBMISSION, "2026-06-01").reconciliations, []);
});

test("an add-back's category comes from its label, else the label is its own", () => {
  assert.equal(addBackCategory("Stock-based compensation expense (B)").key, "stock_based_compensation");
  assert.equal(addBackCategory("Share-based compensation").key, "stock_based_compensation");
  assert.equal(addBackCategory("Amortization of acquisition-related intangibles").key, "amortization_of_intangibles");
  assert.equal(addBackCategory("Income tax impact of non-GAAP adjustments (D)").key, "income_tax_effect");
  assert.equal(addBackCategory("Restructuring charges").key, "restructuring");
  assert.deepEqual(addBackCategory("Other (C)"), { key: "other:other", label: "Other" });
});

function release(quarterEnd: string | null, n: number, lines: ReadonlyArray<[string, number]>, filedOn = quarterEnd ?? "2025-01-01"): StoredRelease {
  return {
    document_id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    source_id: `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    accession: `0000000000-25-${String(n).padStart(6, "0")}`,
    filed_on: filedOn,
    quarter_end: quarterEnd,
    revenue: { exhibit: "EX-99.1", label: "Revenue", value_num: 1_000, scale: "millions" },
    reconciliations: [
      { exhibit: "EX-99.1", measure_key: "operating_income", gaap: { label: "GAAP operating income", value_num: 200 }, non_gaap: { label: "Non-GAAP operating income", value_num: 250 }, adjustments: lines.map(([label, value_num]) => ({ label, value_num })), unit: "currency", scale: "millions" },
      { exhibit: "EX-99.1", measure_key: "net_income", gaap: { label: "GAAP net income", value_num: 150 }, non_gaap: { label: "Non-GAAP net income", value_num: 200 }, adjustments: [], unit: "currency", scale: "millions" },
      { exhibit: "EX-99.1", measure_key: "eps_diluted", gaap: { label: "GAAP diluted EPS", value_num: 1.3 }, non_gaap: { label: "Non-GAAP diluted EPS", value_num: 1.45 }, adjustments: [], unit: "currency", scale: "millions" },
    ],
  };
}

test("the history reads the last 8 quarters: spreads, each category's quarters, SBC's share", () => {
  const ends = ["2023-07-31", "2023-10-31", "2024-01-31", "2024-04-30", "2024-07-31", "2024-10-31", "2025-01-31", "2025-04-30", "2025-07-31"];
  const rows = ends.map((end, n) => release(end, n, [
    ["Stock-based compensation", 40],
    // In the five latest quarters: recurring.
    ...(n >= 4 ? [["Restructuring charges", 5] as [string, number]] : []),
    // In four of the eight: not.
    ...(n % 2 === 0 ? [["Litigation settlement", 5] as [string, number]] : []),
    // A zero is no add-back.
    ["Impairment", 0],
  ]));
  rows.push(release(null, 99, [["Stock-based compensation", 40]]));
  const history = nonGaapHistory(rows);
  assert.deepEqual(history.quarters.map((quarter) => quarter.quarter_end), ends.slice(1).reverse());
  assert.equal(history.undated, 1);
  const latest = history.quarters[0]!;
  assert.deepEqual(latest.eps, { gaap: 1.3, non_gaap: 1.45, spread: 0.15 });
  assert.deepEqual(latest.operating_margin, { revenue: 1_000, gaap_pct: 20, non_gaap_pct: 25, spread_pp: 5 });
  assert.deepEqual(latest.sbc, { value: 40, basis: "operating_income", non_gaap_net_income: 200, share_pct: 20 });
  assert.equal(latest.document_id, rows[8]!.document_id);
  assert.deepEqual(history.categories.map((category) => [category.key, category.quarters, category.of, category.recurring]), [
    ["stock_based_compensation", 8, 8, true],
    ["restructuring", 5, 8, true],
    ["litigation", 4, 8, false],
  ]);
});

test("the history leaves a margin unshown when revenue is missing or in another scale, and keeps the first release of a quarter", () => {
  const first = release("2025-04-30", 1, [["Stock-based compensation", 40]], "2025-05-20");
  const amended = { ...release("2025-04-30", 2, [], "2025-06-01") };
  const noRevenue = { ...release("2025-01-31", 3, []), revenue: null };
  const otherScale = { ...release("2024-10-31", 4, []), revenue: { exhibit: "EX-99.1", label: "Revenue", value_num: 1_000_000, scale: "thousands" as const } };
  const history = nonGaapHistory([amended, first, noRevenue, otherScale]);
  assert.deepEqual(history.quarters.map((quarter) => [quarter.quarter_end, quarter.document_id]), [
    ["2025-04-30", first.document_id],
    ["2025-01-31", noRevenue.document_id],
    ["2024-10-31", otherScale.document_id],
  ]);
  assert.equal(history.quarters[1]!.operating_margin, null);
  assert.equal(history.quarters[2]!.operating_margin, null);
  // No SBC line: none.
  assert.equal(history.quarters[1]!.sbc, null);
});

// --- Against Postgres -------------------------------------------------------

async function seedRelease(
  client: { query: (text: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, string>> }> },
  store: MemoryObjectStore,
  input: { cik: number; accession: string; filedOn: string; bytes: Uint8Array | null; userId?: string },
): Promise<{ issuerId: string; documentId: string }> {
  const issuer = (await client.query(`insert into issuers (legal_name, cik) values ('Example Corp', $1) returning issuer_id::text as id`, [String(input.cik).padStart(10, "0")])).rows[0]!.id!;
  const source = (await client.query(
    `insert into sources (provider, kind, trust_tier, license_class, retrieved_at, user_id)
     values ('sec_edgar', 'filing', 'primary', 'public', now(), $1::uuid) returning source_id::text as id`,
    [input.userId ?? null],
  )).rows[0]!.id!;
  let blobId = `ephemeral:${source}`;
  if (input.bytes) {
    blobId = (await store.put(input.bytes)).blob.raw_blob_id;
  }
  const document = (await client.query(
    `insert into documents (source_id, kind, provider_doc_id, content_hash, raw_blob_id)
     values ($1, 'filing', $2, $3, $3) returning document_id::text as id`,
    [source, input.accession, blobId],
  )).rows[0]!.id!;
  const claim = (await client.query(
    `insert into claims
       (document_id, predicate, text_canonical, polarity, modality, reported_by_source_id,
        attributed_to_type, attributed_to_id, effective_time, confidence, status)
     values ($1, 'material_event.guidance_update', 'Material event reported via 8-K: guidance update (2.02).',
             'neutral', 'asserted', $2, 'issuer', $3, $4::timestamptz, 0.9, 'extracted')
     returning claim_id::text as id`,
    [document, source, issuer, `${input.filedOn}T00:00:00Z`],
  )).rows[0]!.id!;
  await client.query(`insert into claim_arguments (claim_id, subject_kind, subject_id, role) values ($1, 'issuer', $2, 'subject')`, [claim, issuer]);
  return { issuerId: issuer, documentId: document };
}

test("a stored release is read once from its bytes, and the history reads it at a cutoff the user may see", { skip: !dockerAvailable(), timeout: 180_000 }, async (t) => {
  const { databaseUrl } = await bootstrapDatabase(t, "non-gaap-history");
  const client = await connectedClient(t, databaseUrl);
  const store = new MemoryObjectStore();
  const { issuerId, documentId } = await seedRelease(client, store, {
    cik: 9999999, accession: EXAMPLE_ACCESSION, filedOn: EXAMPLE_FILED_ON, bytes: new TextEncoder().encode(RELEASE_SUBMISSION),
  });
  // Bytes never retained: left unread, not stored as reconciling nothing.
  await seedRelease(client, store, { cik: 8888888, accession: "0008888888-25-000001", filedOn: EXAMPLE_FILED_ON, bytes: null });

  assert.deepEqual(await runReconciliationDrain({ db: client, objectStore: store }), { read: 1, undated: 0, no_bytes: 1, noop: 0, failed: 0 });
  assert.deepEqual(await runReconciliationDrain({ db: client, objectStore: store }), { read: 0, undated: 0, no_bytes: 1, noop: 0, failed: 0 });
  const stored = await client.query(`select quarter_end::text as quarter_end, jsonb_array_length(reconciliations) as lines from non_gaap_reconciliations`);
  assert.deepEqual(stored.rows, [{ quarter_end: "2025-10-26", lines: 5 }]);
  // A second read of the same release stores nothing more.
  assert.equal(await readReleaseReconciliations({ db: client, objectStore: store }, {
    documentId, rawBlobId: rawBlobIdFromBytes(new TextEncoder().encode(RELEASE_SUBMISSION)), accession: EXAMPLE_ACCESSION, filedAt: `${EXAMPLE_FILED_ON}T00:00:00.000Z`,
  }), "noop");

  const history = await loadNonGaapHistory(client, { issuer_id: issuerId, as_of: "2025-12-31T00:00:00Z" });
  assert.equal(history.quarters.length, 1);
  const quarter = history.quarters[0]!;
  assert.equal(quarter.accession, EXAMPLE_ACCESSION);
  assert.equal(quarter.filed_on, EXAMPLE_FILED_ON);
  assert.deepEqual(quarter.eps, { gaap: 1.3, non_gaap: 1.36, spread: 0.06 });
  assert.deepEqual(quarter.operating_margin, { revenue: 57_006, gaap_pct: 63.2, non_gaap_pct: 66.3, spread_pp: 3.2 });
  // No SBC line in net or operating income: the gross profit and operating expense lines together.
  assert.deepEqual(quarter.sbc, { value: 1_652, basis: "gross_profit_and_operating_expenses", non_gaap_net_income: 33_366, share_pct: 5 });
  // Before the release was filed, nothing.
  assert.equal((await loadNonGaapHistory(client, { issuer_id: issuerId, as_of: "2025-11-18T00:00:00Z" })).quarters.length, 0);

  // A source only another user may see is no release of this one's.
  const other = "22222222-2222-4222-a222-222222222222";
  await client.query(`insert into users (user_id, email) values ($1, 'other@example.com') on conflict do nothing`, [other]);
  const hidden = await seedRelease(client, store, {
    cik: 7777777, accession: "0007777777-25-000001", filedOn: EXAMPLE_FILED_ON, bytes: new TextEncoder().encode(`${RELEASE_SUBMISSION} `), userId: other,
  });
  await runReconciliationDrain({ db: client, objectStore: store });
  assert.equal((await loadNonGaapHistory(client, { issuer_id: hidden.issuerId, as_of: "2025-12-31T00:00:00Z" })).quarters.length, 0);
  assert.equal((await loadNonGaapHistory(client, { issuer_id: hidden.issuerId, as_of: "2025-12-31T00:00:00Z", user_id: other })).quarters.length, 1);
});
