// A share price binds from a stored price observation as a certified input
// (#444): the subject's one listing's latest price known by the cutoff,
// restated to the listing's reference date.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { Client } from "pg";
import { dockerAvailable } from "../../../db/test/docker-pg.ts";
import Ajv2020 from "../../financial-core/node_modules/ajv/dist/2020.js";
import { validateFinancialPlan, type FinancialPlanV1, type PeriodSelector } from "../../financial-core/src/index.ts";
import { bindPlanInputs } from "../src/bind-inputs.ts";
import { createEvidenceFinancialPort } from "../src/evidence-adapter.ts";
import { finalizeUnit } from "../src/finalize.ts";
import { inspectCommittedResult } from "../src/inspection.ts";
import { authorityFor, engineDatabase, IDS, leasedRun, pinnedClients, readyRun, revenuePlan } from "./db-fixtures.ts";

const PRICE_IDS = {
  polygon: "4f000000-0000-4000-8000-0000000004c2",
  nvda: "4f000000-0000-4000-8000-0000000004a1",
  unlisted: "4f000000-0000-4000-8000-0000000004a2",
  unsynced: "4f000000-0000-4000-8000-0000000004a3",
} as const;
const listingOf = (issuer: string) => `${issuer.slice(0, -3)}e${issuer.slice(-2)}`;
// 10:00 on Monday 2024-06-10 in New York: NVDA's split has executed, Monday's session has not closed.
const MONDAY_MORNING = "2024-06-10T14:00:00.000Z";

/** NVDA's listing with its 2024-06-10 split synced on Monday, and Friday's 1200.00 close. */
async function seedPrices(db: Client): Promise<string> {
  await db.query(`insert into sources (source_id, provider, kind, trust_tier, license_class, retrieved_at) values ($1, 'polygon_market', 'market_data', 'primary', 'licensed', now())`, [PRICE_IDS.polygon]);
  for (const issuer of [PRICE_IDS.nvda, PRICE_IDS.unlisted, PRICE_IDS.unsynced]) {
    await db.query(`insert into issuers (issuer_id, legal_name) values ($1, $2)`, [issuer, `Issuer ${issuer.slice(-3)}`]);
    await db.query(`insert into instruments (instrument_id, issuer_id, asset_type) values ($1, $1, 'common_stock')`, [issuer]);
    if (issuer === PRICE_IDS.unlisted) continue;
    await db.query(
      `insert into listings (listing_id, instrument_id, mic, ticker, trading_currency, timezone) values ($1, $2, 'XNAS', $3, 'USD', 'America/New_York')`,
      [listingOf(issuer), issuer, `P${issuer.slice(-2)}`],
    );
  }
  const nvda = listingOf(PRICE_IDS.nvda);
  await db.query(`insert into listing_splits (listing_id, execution_date, split_from, split_to, source_id) values ($1, '2024-06-10', 1, 10, $2)`, [nvda, PRICE_IDS.polygon]);
  await db.query(`insert into listing_split_coverage (listing_id, checked_at, source_id) values ($1, '2024-06-10T12:00:00Z', $2)`, [nvda, PRICE_IDS.polygon]);
  return (await db.query<{ observation_id: string }>(
    `insert into price_observations (listing_id, source_id, kind, price_text, currency, observed_at, known_at, fetched_at, body_sha256)
     values ($1, $2, 'session_close', '1200.00', 'USD', '2024-06-07T20:00:00Z', '2024-06-07T20:15:00Z', '2024-06-07T20:15:00Z', $3)
     returning observation_id::text`,
    [nvda, PRICE_IDS.polygon, "d".repeat(64)],
  )).rows[0]!.observation_id;
}

/** The issuer's share price at the cutoff, alone in one unit. */
function pricePlan(issuer: string, cutoff: string, period: PeriodSelector = { kind: "at_cutoff" }): FinancialPlanV1 {
  const base = revenuePlan();
  const validated = validateFinancialPlan({
    ...base,
    plan_id: randomUUID(),
    subjects: { ...base.subjects, members: [{ ...base.subjects.members[0]!, subject_ref: { kind: "issuer", id: issuer } }] },
    time: { knowledge_cutoff: cutoff, cutoff_timezone: "America/New_York", time_mode: "public_information" },
    metric_definitions: [{ metric_key: "share_price", definition_version: "share_price.v1" }],
    operations: [{ node_id: "px", operation: "reported_metric", operation_version: "reported_metric.v1", subject_slot: "a", metric_key: "share_price", period }],
    outputs: [{ output_id: "out_px", node_id: "px", unit_id: "price_unit" }],
    publication_units: [{ unit_id: "price_unit", kind: "chat_section" }],
  });
  assert.ok(validated.ok, JSON.stringify(!validated.ok && validated.issues));
  return validated.value;
}

test("share price binding", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for price binding coverage");
    return;
  }
  const db = await engineDatabase(t, "fin-price-binding");
  const authority = authorityFor(IDS.owner, { allowed_source_classes: ["sec_filing", "market_data"] });
  const friday = await seedPrices(db);

  await t.test("Friday's 1200.00 close binds restated after Monday's split and computes as 120", async () => {
    const { runId } = await readyRun(db, pricePlan(PRICE_IDS.nvda, MONDAY_MORNING), authority);
    const row = (await db.query(
      `select price_observation_id::text, fact_id, selection_policy_version, candidate_count, bound_payload from financial_run_inputs where run_id = $1`,
      [runId],
    )).rows[0]!;
    assert.deepEqual([row.price_observation_id, row.fact_id, row.selection_policy_version, row.candidate_count], [friday, null, "price-at-cutoff-selection.v1", 1]);
    const payload = row.bound_payload;
    assert.deepEqual(
      [payload.schema_version, payload.observation_id, payload.numeric, payload.observed_at, payload.known_at, payload.unit],
      ["financial_bound_price_input.v1", friday, { raw_token: "1200.00", value: "1200" }, "2024-06-07T20:00:00.000Z", "2024-06-07T20:15:00.000Z", { kind: "currency_per_share", currency: "USD" }],
    );
    assert.deepEqual([payload.split_adjustment.as_filed_on, payload.split_adjustment.reference_date, payload.split_adjustment.factor, payload.split_adjustment.adjusted_native_value],
      ["2024-06-07", "2024-06-10", { numerator: "10", denominator: "1" }, { numerator: "120", denominator: "1" }]);
    const result = (await db.query(`select disposition, payload from financial_results where run_id = $1`, [runId])).rows[0]!;
    assert.deepEqual([result.disposition, result.payload.value, result.payload.unit], ["computed", "120", { kind: "currency_per_share", currency: "USD" }]);
  });

  await t.test("the price unit seals, and its result inspects with the observation it bound", async () => {
    const { runId, lease } = await readyRun(db, pricePlan(PRICE_IDS.nvda, MONDAY_MORNING), authority);
    const [client] = await pinnedClients(t, db, 1);
    const sealed = await finalizeUnit({ client: client!, lease, authority, unit_id: "price_unit", snapshot_id: randomUUID(), persistParent: async () => {} });
    assert.equal(sealed.status, "published", JSON.stringify(sealed));
    const resultId = (await db.query(`select result_id::text from financial_results where run_id = $1`, [runId])).rows[0]!.result_id;
    const inspection = await inspectCommittedResult(db, IDS.owner, resultId);
    const ajv = new Ajv2020({ strict: false, validateFormats: false });
    for (const file of ["finance_research_block_schema.json", "financial_plan_schema.json", "financial_result_schema.json", "financial_answer_http_schema.json"]) {
      ajv.addSchema(JSON.parse(readFileSync(new URL(`../../../spec/${file}`, import.meta.url), "utf8")));
    }
    const valid = ajv.getSchema("https://example.com/schemas/financial_answer_http_schema.json#/$defs/FinancialResultInspection")!;
    assert.ok(valid(inspection), JSON.stringify(valid.errors));
    assert.ok(inspection?.availability === "available");
    const [input] = inspection.inputs;
    assert.deepEqual(input && "observation_id" in input && [input.observation_id, input.value, input.split_adjustment.adjusted_native_value, input.observation], [
      friday, "1200", { numerator: "120", denominator: "1" }, { kind: "session_close", observed_at: "2024-06-07T20:00:00.000Z", known_at: "2024-06-07T20:15:00.000Z" },
    ]);
  });

  await t.test("a retry reuses the persisted price binding", async () => {
    const plan = pricePlan(PRICE_IDS.nvda, MONDAY_MORNING);
    const { lease } = await leasedRun(db, plan, authority);
    const first = await bindPlanInputs({ client: db, lease, plan, authority, evidence: createEvidenceFinancialPort });
    const retry = await bindPlanInputs({ client: db, lease, plan, authority, evidence: createEvidenceFinancialPort });
    assert.equal(retry.reused, true);
    assert.deepEqual(retry.bindings.get("px"), first.bindings.get("px"));
  });

  await t.test("a price the subject's listing, its splits, or the cutoff cannot ground is a named gap", async () => {
    const gapOf = async (plan: FinancialPlanV1) => {
      const { lease } = await leasedRun(db, plan, authority);
      const binding = (await bindPlanInputs({ client: db, lease, plan, authority, evidence: createEvidenceFinancialPort })).bindings.get("px");
      return binding?.status === "gap" ? binding.reason_code : binding?.status;
    };
    assert.equal(await gapOf(pricePlan(PRICE_IDS.unlisted, MONDAY_MORNING)), "split_listing_unresolved");
    assert.equal(await gapOf(pricePlan(PRICE_IDS.unsynced, MONDAY_MORNING)), "split_history_missing");
    // Friday's close was known at 16:15 in New York; ten minutes earlier nothing was.
    assert.equal(await gapOf(pricePlan(PRICE_IDS.nvda, "2024-06-07T20:05:00.000Z")), "missing_input");
    assert.equal(await gapOf(pricePlan(PRICE_IDS.nvda, MONDAY_MORNING, { kind: "fiscal_period", fiscal_year: 2024, fiscal_period: "FY" })), "unsupported_period");
  });

  await t.test("a price never binds for an authority that does not allow market data", async () => {
    const plan = pricePlan(PRICE_IDS.nvda, MONDAY_MORNING);
    const filingsOnly = authorityFor();
    const { runId, lease } = await leasedRun(db, plan, filingsOnly);
    const binding = (await bindPlanInputs({ client: db, lease, plan, authority: filingsOnly, evidence: createEvidenceFinancialPort })).bindings.get("px");
    assert.deepEqual(binding?.status === "gap" && binding.reason_code, "source_class_not_allowed");
    const row = (await db.query(`select binding_status, gap_reason, price_observation_id from financial_run_inputs where run_id = $1`, [runId])).rows[0]!;
    assert.deepEqual([row.binding_status, row.gap_reason, row.price_observation_id], ["gap", "source_class_not_allowed", null]);
  });

  await t.test("a seal withholds the price when its subject's listing or that listing's splits changed since binding", async () => {
    const sealAfter = async (change: () => Promise<unknown>) => {
      const { lease } = await readyRun(db, pricePlan(PRICE_IDS.nvda, MONDAY_MORNING), authority);
      await change();
      const [client] = await pinnedClients(t, db, 1);
      const sealed = await finalizeUnit({ client: client!, lease, authority, unit_id: "price_unit", snapshot_id: randomUUID(), persistParent: async () => {} });
      return sealed.status === "rejected" && sealed.failures.map((failure) => [failure.reason_code, failure.details.reason]);
    };
    const nvda = listingOf(PRICE_IDS.nvda);
    const second = `${nvda.slice(0, -1)}2`;
    try {
      assert.deepEqual(await sealAfter(() => db.query(
        `insert into listings (listing_id, instrument_id, mic, ticker, trading_currency, timezone) values ($1, $2, 'XNYS', 'PA2', 'USD', 'America/New_York')`,
        [second, PRICE_IDS.nvda],
      )), [["financial_input_ineligible", "listing_changed"]], "a second common-stock listing makes the listing unresolved");
      await db.query(`delete from listings where listing_id = $1`, [second]);
      assert.deepEqual(await sealAfter(() => db.query(`update listing_splits set split_to = 20 where listing_id = $1`, [nvda])),
        [["financial_input_ineligible", "splits_changed"]], "a split restated since binding");
    } finally {
      await db.query(`delete from listings where listing_id = $1`, [second]);
      await db.query(`update listing_splits set split_to = 10 where listing_id = $1`, [nvda]);
    }
  });
});
