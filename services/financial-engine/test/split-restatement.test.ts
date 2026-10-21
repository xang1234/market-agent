// SEC EPS and share counts are stored as filed and bound restated to the
// plan's reference date from the listing's recorded splits (#387).

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { Client } from "pg";
import { dockerAvailable } from "../../../db/test/docker-pg.ts";
import { recordFactPrecisionAttestation, recordSourcePublicationAttestation } from "../../evidence/src/financial-attestations.ts";
import { recordFactFinancialContext } from "../../evidence/src/financial-context.ts";
import Ajv2020 from "../../financial-core/node_modules/ajv/dist/2020.js";
import { validateFinancialPlan, type FinancialPlanV1 } from "../../financial-core/src/index.ts";
import { bindPlanInputs } from "../src/bind-inputs.ts";
import { createEvidenceFinancialPort } from "../src/evidence-adapter.ts";
import { finalizeUnit } from "../src/finalize.ts";
import { inspectCommittedResult } from "../src/inspection.ts";
import { authorityFor, engineDatabase, HASH, IDS as FIXTURE_IDS, leasedRun, pinnedClients, readyRun, revenuePlan } from "./db-fixtures.ts";

const IDS = {
  tenK: "4f000000-0000-4000-8000-0000000003c1",
  polygon: "4f000000-0000-4000-8000-0000000003c2",
  nvda: "4f000000-0000-4000-8000-0000000003a1",
  uncovered: "4f000000-0000-4000-8000-0000000003a2",
  stale: "4f000000-0000-4000-8000-0000000003a3",
  twoListings: "4f000000-0000-4000-8000-0000000003a4",
  fetchedTheEveningBefore: "4f000000-0000-4000-8000-0000000003a5",
} as const;
/** The issuer's index-th listing: its id with the last three digits "e<issuer digit><index>". */
const listingOf = (issuer: string, index = 1) => `${issuer.slice(0, -3)}e${issuer.slice(-1)}${index}`;

async function seedIssuer(db: Client, issuer: string, options: { listings?: number; checked_at?: string | null; splits?: Array<[string, string, string]> } = {}): Promise<void> {
  await db.query(`insert into issuers (issuer_id, legal_name) values ($1, $2)`, [issuer, `Issuer ${issuer.slice(-3)}`]);
  await db.query(`insert into instruments (instrument_id, issuer_id, asset_type) values ($1, $1, 'common_stock')`, [issuer]);
  for (let index = 1; index <= (options.listings ?? 1); index += 1) {
    await db.query(
      `insert into listings (listing_id, instrument_id, mic, ticker, trading_currency, timezone) values ($1, $2, 'XNAS', $3, 'USD', 'America/New_York')`,
      [listingOf(issuer, index), issuer, `T${issuer.slice(-2)}${index}`],
    );
  }
  const listing = listingOf(issuer);
  for (const [date, from, to] of options.splits ?? []) {
    await db.query(`insert into listing_splits (listing_id, execution_date, split_from, split_to, source_id) values ($1, $2, $3, $4, $5)`, [listing, date, from, to, IDS.polygon]);
  }
  if (options.checked_at) {
    await db.query(`insert into listing_split_coverage (listing_id, checked_at, source_id) values ($1, $2, $3)`, [listing, options.checked_at, IDS.polygon]);
  }
}

/** A FY2024 value from the 10-K filed 2024-02-21, certified as filed. */
async function seedAsFiled(db: Client, issuer: string, metricKey: string, value: string): Promise<string> {
  const perShare = metricKey.startsWith("eps_");
  const metricId = (await db.query<{ metric_id: string }>(
    `insert into metrics (metric_id, metric_key, display_name, unit_class, aggregation, interpretation, canonical_source_class)
     values (gen_random_uuid(), $1, $1, $2, $3, 'neutral', 'gaap')
     on conflict (metric_key) do update set metric_key = excluded.metric_key
     returning metric_id::text`,
    [metricKey, perShare ? "currency" : "count", perShare ? "derived" : "avg"],
  )).rows[0]!.metric_id;
  const factId = (await db.query<{ fact_id: string }>(
    `insert into facts (subject_kind, subject_id, metric_id, period_kind, period_start, period_end, fiscal_year, fiscal_period,
                        value_num, unit, currency, scale, as_of, observed_at, source_id, method, verification_status,
                        freshness_class, coverage_level, confidence)
     values ('issuer', $1, $2, 'fiscal_y', '2023-01-30', '2024-01-28', 2024, 'FY', $3, $4, $5, 1,
             '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z', $6, 'reported', 'authoritative', 'filing_time', 'full', 1)
     returning fact_id::text`,
    [issuer, metricId, value, perShare ? "currency_per_share" : "shares", perShare ? "USD" : null, IDS.tenK],
  )).rows[0]!.fact_id;
  await recordFactPrecisionAttestation(db, {
    fact_id: factId, precision_class: "source_token_preserved", raw_token: value, token_proof_hash: HASH.proof, source_locator: `locator:${factId}`, validation_method: "fixture",
  });
  await recordFactFinancialContext(db, {
    fact_id: factId, context_version: "context.v1", period_type: "duration", dimension_scope: "consolidated", dimension_members: [],
    reporting_basis: "as_reported", adjustment_basis: "as_filed", as_filed_on: "2024-02-21", share_basis: "diluted",
    fiscal_calendar_version: "fiscal-calendar.v1", disclosure_relation: "original", source_context_ref: null,
  });
  return factId;
}

/** Diluted EPS and weighted-average diluted shares for FY2024, at a UTC cutoff. */
function sharePlan(issuer: string, cutoff: string): FinancialPlanV1 {
  const base = revenuePlan();
  const node = (nodeId: string, metricKey: string) => ({
    node_id: nodeId, operation: "reported_metric" as const, operation_version: "reported_metric.v1", subject_slot: "a", metric_key: metricKey,
    period: { kind: "fiscal_period" as const, fiscal_year: 2024, fiscal_period: "FY" as const },
  });
  const validated = validateFinancialPlan({
    ...base,
    plan_id: randomUUID(),
    subjects: { ...base.subjects, members: [{ ...base.subjects.members[0]!, subject_ref: { kind: "issuer", id: issuer } }] },
    time: { knowledge_cutoff: cutoff, cutoff_timezone: "UTC", time_mode: "public_information" },
    metric_definitions: [
      { metric_key: "eps_diluted", definition_version: "eps_diluted.v1" },
      { metric_key: "weighted_average_diluted_shares", definition_version: "weighted_average_diluted_shares.v1" },
    ],
    operations: [node("eps", "eps_diluted"), node("shares", "weighted_average_diluted_shares")],
    outputs: [{ output_id: "out_eps", node_id: "eps", unit_id: "share_unit" }, { output_id: "out_shares", node_id: "shares", unit_id: "share_unit" }],
    publication_units: [{ unit_id: "share_unit", kind: "chat_section" }],
  });
  assert.ok(validated.ok, JSON.stringify(!validated.ok && validated.issues));
  return validated.value;
}

async function resultValues(db: Client, runId: string): Promise<Record<string, unknown>> {
  const rows = (await db.query<{ output_id: string; payload: { value?: string; reason_code?: string } }>(
    `select output_id, payload from financial_results where run_id = $1 order by output_id`,
    [runId],
  )).rows;
  return Object.fromEntries(rows.map((row) => [row.output_id, row.payload.value ?? row.payload.reason_code]));
}

test("as-filed share figures bound on a split basis", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for split restatement coverage");
    return;
  }
  const db = await engineDatabase(t, "fin-split-basis");
  const authority = authorityFor();
  await db.query(`
    insert into sources (source_id, provider, kind, trust_tier, license_class, retrieved_at, content_hash) values
      ('${IDS.tenK}', 'sec_edgar', 'filing', 'primary', 'public', '2026-10-01T00:00:00Z', '${"4".repeat(64)}'),
      ('${IDS.polygon}', 'polygon_market', 'market_data', 'primary', 'licensed', '2026-10-01T00:00:00Z', null);
  `);
  await recordSourcePublicationAttestation(db, {
    source_id: IDS.tenK, document_id: null, source_version_hash: "4".repeat(64), available_not_before: null,
    available_no_later_than: "2024-02-21T23:59:59.999-05:00", timing_precision: "date", source_timezone: "America/New_York",
    proof_method: "accession_bound_archive", proof_ref: "proof:nvda-10k", proof_hash: HASH.proof, mapping_version: "test-accession-archive.v1",
  });
  // NVDA's splits, the 2024 one after the 10-K was filed, and one announced for after the reference dates.
  await seedIssuer(db, IDS.nvda, { checked_at: "2026-10-01T12:00:00Z", splits: [["2021-07-20", "1", "4"], ["2024-06-10", "1", "10"], ["2026-11-02", "1", "2"]] });
  await seedIssuer(db, IDS.uncovered, { checked_at: null });
  await seedIssuer(db, IDS.stale, { checked_at: "2024-12-31T12:00:00Z", splits: [["2024-06-10", "1", "10"]] });
  await seedIssuer(db, IDS.twoListings, { listings: 2, checked_at: "2026-10-01T12:00:00Z" });
  // Fetched at 22:00 in New York on 2024-06-09, the evening before NVDA's split executed there.
  await seedIssuer(db, IDS.fetchedTheEveningBefore, { checked_at: "2024-06-10T02:00:00Z", splits: [["2024-06-10", "1", "10"]] });
  const eps = await seedAsFiled(db, IDS.nvda, "eps_diluted", "11.93");
  await seedAsFiled(db, IDS.nvda, "weighted_average_diluted_shares", "2494000000");
  for (const issuer of [IDS.uncovered, IDS.stale, IDS.twoListings, IDS.fetchedTheEveningBefore]) await seedAsFiled(db, issuer, "eps_diluted", "11.93");

  await t.test("after the split, NVDA's FY2024 diluted EPS and shares bind restated, and the unit seals", async () => {
    const plan = sharePlan(IDS.nvda, "2025-01-01T12:00:00.000Z");
    const { runId, lease } = await readyRun(db, plan, authority);
    const payload = (await db.query(`select bound_payload from financial_run_inputs where run_id = $1 and input_slot = 'eps'`, [runId])).rows[0]!.bound_payload;
    assert.deepEqual([payload.fact_id, payload.numeric.raw_token, payload.basis.adjustment], [eps, "11.93", "split_adjusted"]);
    assert.deepEqual(payload.split_adjustment, {
      version: "split_adjustment.v1",
      as_filed_on: "2024-02-21",
      reference_date: "2025-01-01",
      listing_id: listingOf(IDS.nvda),
      splits: [{ execution_date: "2024-06-10", split_from: "1", split_to: "10" }],
      factor: { numerator: "10", denominator: "1" },
      adjusted_native_value: { numerator: "1193", denominator: "1000" },
    });
    assert.deepEqual(await resultValues(db, runId), { out_eps: "1.193", out_shares: "24940000000" });
    const [client] = await pinnedClients(t, db, 1);
    const sealed = await finalizeUnit({ client: client!, lease, authority, unit_id: "share_unit", snapshot_id: randomUUID(), persistParent: async () => {} });
    assert.equal(sealed.status, "published", JSON.stringify(sealed));

    const resultId = (await db.query(`select result_id::text from financial_results where run_id = $1 and output_id = 'out_eps'`, [runId])).rows[0]!.result_id;
    const inspection = await inspectCommittedResult(db, FIXTURE_IDS.owner, resultId);
    const ajv = new Ajv2020({ strict: false, validateFormats: false });
    for (const file of ["finance_research_block_schema.json", "financial_plan_schema.json", "financial_result_schema.json", "financial_answer_http_schema.json"]) {
      ajv.addSchema(JSON.parse(readFileSync(new URL(`../../../spec/${file}`, import.meta.url), "utf8")));
    }
    const valid = ajv.getSchema("https://example.com/schemas/financial_answer_http_schema.json#/$defs/FinancialResultInspection")!;
    assert.ok(valid(inspection), JSON.stringify(valid.errors));
    const [input] = inspection?.availability === "available" ? inspection.inputs : [];
    assert.deepEqual(input?.status === "bound" && [input.value, input.split_adjustment?.factor, input.split_adjustment?.adjusted_native_value], [
      "11.93", { numerator: "10", denominator: "1" }, { numerator: "1193", denominator: "1000" },
    ], "the inspected input is the value as filed, with the adjustment that restates it");
  });

  await t.test("before the split, they bind as filed: factor one, no split", async () => {
    const { runId } = await readyRun(db, sharePlan(IDS.nvda, "2024-05-01T12:00:00.000Z"), authority);
    const payload = (await db.query(`select bound_payload from financial_run_inputs where run_id = $1 and input_slot = 'eps'`, [runId])).rows[0]!.bound_payload;
    assert.deepEqual([payload.split_adjustment.splits, payload.split_adjustment.factor], [[], { numerator: "1", denominator: "1" }]);
    assert.deepEqual(await resultValues(db, runId), { out_eps: "11.93", out_shares: "2494000000" });
  });

  await t.test("a listing never checked, checked before the reference date, or not the only one is a gap", async () => {
    const gapOf = async (issuer: string) => {
      const plan = sharePlan(issuer, "2025-01-01T12:00:00.000Z");
      const { lease } = await leasedRun(db, plan, authority);
      const binding = (await bindPlanInputs({ client: db, lease, plan, authority, evidence: createEvidenceFinancialPort })).bindings.get("eps");
      return binding?.status === "gap" ? binding.reason_code : binding?.status;
    };
    assert.equal(await gapOf(IDS.uncovered), "split_history_missing");
    assert.equal(await gapOf(IDS.stale), "split_history_stale");
    assert.equal(await gapOf(IDS.twoListings), "split_listing_unresolved");
  });

  await t.test("a split counts from its execution date in the listing's market, not the cutoff's UTC date", async () => {
    // 02:00 UTC on 2024-06-10 is 22:00 on 2024-06-09 in New York, before NVDA's split executed there.
    const plan = sharePlan(IDS.nvda, "2024-06-10T02:00:00.000Z");
    const { runId, lease } = await readyRun(db, plan, authority);
    const payload = (await db.query(`select bound_payload from financial_run_inputs where run_id = $1 and input_slot = 'eps'`, [runId])).rows[0]!.bound_payload;
    assert.deepEqual(payload.split_adjustment, {
      version: "split_adjustment.v2",
      as_filed_on: "2024-02-21",
      reference_date: "2024-06-09",
      listing_id: listingOf(IDS.nvda),
      listing_timezone: "America/New_York",
      splits: [],
      factor: { numerator: "1", denominator: "1" },
      adjusted_native_value: { numerator: "1193", denominator: "100" },
    });
    assert.deepEqual(await resultValues(db, runId), { out_eps: "11.93", out_shares: "2494000000" });
    const [client] = await pinnedClients(t, db, 1);
    const sealed = await finalizeUnit({ client: client!, lease, authority, unit_id: "share_unit", snapshot_id: randomUUID(), persistParent: async () => {} });
    assert.equal(sealed.status, "published", JSON.stringify(sealed));

    // 12:00 UTC on 2024-06-10 is the split's own day in New York, and the list was fetched the evening before.
    const late = sharePlan(IDS.fetchedTheEveningBefore, "2024-06-10T12:00:00.000Z");
    const { lease: lateLease } = await leasedRun(db, late, authority);
    const binding = (await bindPlanInputs({ client: db, lease: lateLease, plan: late, authority, evidence: createEvidenceFinancialPort })).bindings.get("eps");
    assert.equal(binding?.status === "gap" ? binding.reason_code : binding?.status, "split_history_stale");
  });

  await t.test("a split re-dated after binding withholds the seal", async () => {
    const plan = sharePlan(IDS.nvda, "2025-01-01T12:00:00.000Z");
    const { lease } = await readyRun(db, plan, authority);
    await db.query(`update listing_splits set execution_date = '2024-03-01' where listing_id = $1 and execution_date = '2024-06-10'`, [listingOf(IDS.nvda)]);
    try {
      const [client] = await pinnedClients(t, db, 1);
      const sealed = await finalizeUnit({ client: client!, lease, authority, unit_id: "share_unit", snapshot_id: randomUUID(), persistParent: async () => {} });
      assert.equal(sealed.status === "rejected" && sealed.reason_code, "verification_failed");
      assert.deepEqual(
        sealed.status === "rejected" && sealed.failures.map((failure) => [failure.reason_code, failure.details.reason]),
        [["financial_input_ineligible", "splits_changed"], ["financial_input_ineligible", "splits_changed"]],
      );
    } finally {
      await db.query(`update listing_splits set execution_date = '2024-06-10' where listing_id = $1 and execution_date = '2024-03-01'`, [listingOf(IDS.nvda)]);
    }
  });
});
