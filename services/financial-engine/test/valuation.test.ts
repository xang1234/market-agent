// Market cap and P/E end to end (#444): NVDA's Friday close, its 10-Q cover
// count, and its FY2024 diluted EPS bind restated after its 2024-06-10 split,
// the deterministic plan's unit seals and inspects, and an authority without
// market data gets a named gap instead of a price.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { Client } from "pg";
import { dockerAvailable } from "../../../db/test/docker-pg.ts";
import { recordFactPrecisionAttestation, recordSourcePublicationAttestation } from "../../evidence/src/financial-attestations.ts";
import { recordFactFinancialContext } from "../../evidence/src/financial-context.ts";
import Ajv2020 from "../../financial-core/node_modules/ajv/dist/2020.js";
import type { FinancialPlanV1, FinancialRuntimeAuthority } from "../../financial-core/src/index.ts";
import { POLYGON_MARKET_SOURCE_ID } from "../../market/src/provider-sources.ts";
import { finalizeUnit } from "../src/finalize.ts";
import { inspectCommittedResult } from "../src/inspection.ts";
import { buildDeterministicPlan } from "../src/planner.ts";
import { authorityFor, engineDatabase, HASH, IDS as FIXTURE_IDS, pinnedClients, readyRun } from "./db-fixtures.ts";

const IDS = {
  nvda: "4f000000-0000-4000-8000-0000000005a1",
  listing: "4f000000-0000-4000-8000-0000000005e1",
  tenK: "4f000000-0000-4000-8000-0000000005c1",
  tenQ: "4f000000-0000-4000-8000-0000000005c2",
  polygon: POLYGON_MARKET_SOURCE_ID,
} as const;
// 10:00 on Monday 2024-06-10 in New York: the split has executed, and Friday's session is the last one closed.
const MONDAY_MORNING = "2024-06-10T14:00:00.000Z";

async function seedFiling(db: Client, sourceId: string, contentHash: string, publicBy: string): Promise<void> {
  await db.query(
    `insert into sources (source_id, provider, kind, trust_tier, license_class, retrieved_at, content_hash) values ($1, 'sec_edgar', 'filing', 'primary', 'public', '2026-10-01T00:00:00Z', $2)`,
    [sourceId, contentHash],
  );
  await recordSourcePublicationAttestation(db, {
    source_id: sourceId, document_id: null, source_version_hash: contentHash, available_not_before: null,
    available_no_later_than: publicBy, timing_precision: "date", source_timezone: "America/New_York",
    proof_method: "accession_bound_archive", proof_ref: `proof:${sourceId}`, proof_hash: HASH.proof, mapping_version: "test-accession-archive.v1",
  });
}

/** One SEC value certified as filed on `asFiledOn`. */
async function seedAsFiled(db: Client, fact: {
  metric: string; unit: "currency_per_share" | "shares"; value: string; source: string; asFiledOn: string; reportedAt: string;
  period: { kind: "fiscal_y" | "point"; start: string | null; end: string; fiscal_year: number; fiscal_period: string };
}): Promise<void> {
  const metricId = (await db.query<{ metric_id: string }>(
    `insert into metrics (metric_id, metric_key, display_name, unit_class, aggregation, interpretation, canonical_source_class)
     values (gen_random_uuid(), $1, $1, $2, 'point_in_time', 'neutral', 'gaap')
     on conflict (metric_key) do update set metric_key = excluded.metric_key
     returning metric_id::text`,
    [fact.metric, fact.unit === "shares" ? "count" : "currency"],
  )).rows[0]!.metric_id;
  const factId = (await db.query<{ fact_id: string }>(
    `insert into facts (subject_kind, subject_id, metric_id, period_kind, period_start, period_end, fiscal_year, fiscal_period,
                        value_num, unit, currency, scale, as_of, reported_at, observed_at, source_id, method, verification_status,
                        freshness_class, coverage_level, confidence)
     values ('issuer', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 1, '2026-10-01T00:00:00Z', $11, '2026-10-01T00:00:00Z', $12,
             'reported', 'authoritative', 'filing_time', 'full', 1)
     returning fact_id::text`,
    [IDS.nvda, metricId, fact.period.kind, fact.period.start, fact.period.end, fact.period.fiscal_year, fact.period.fiscal_period,
      fact.value, fact.unit, fact.unit === "shares" ? null : "USD", fact.reportedAt, fact.source],
  )).rows[0]!.fact_id;
  await recordFactPrecisionAttestation(db, {
    fact_id: factId, precision_class: "source_token_preserved", raw_token: fact.value, token_proof_hash: HASH.proof, source_locator: `locator:${factId}`, validation_method: "fixture",
  });
  await recordFactFinancialContext(db, {
    fact_id: factId, context_version: "context.v1", period_type: fact.period.start === null ? "instant" : "duration", dimension_scope: "consolidated", dimension_members: [],
    reporting_basis: "as_reported", adjustment_basis: "as_filed", as_filed_on: fact.asFiledOn, share_basis: fact.unit === "shares" ? "not_applicable" : "diluted",
    fiscal_calendar_version: "fiscal-calendar.v1", disclosure_relation: "original", source_context_ref: null,
  });
}

/** NVDA: its listing with the 2024-06-10 split synced that morning, Friday's 1200.00 close, the FY2024 10-K's diluted EPS, and the Q1 FY2025 10-Q's cover count. */
async function seedNvda(db: Client): Promise<void> {
  await db.query(`insert into sources (source_id, provider, kind, trust_tier, license_class, retrieved_at) values ($1, 'polygon_market', 'market_data', 'primary', 'licensed', now())`, [IDS.polygon]);
  await seedFiling(db, IDS.tenK, "4".repeat(64), "2024-02-21T23:59:59.999-05:00");
  await seedFiling(db, IDS.tenQ, "5".repeat(64), "2024-05-29T23:59:59.999-04:00");
  await db.query(`insert into issuers (issuer_id, legal_name) values ($1, 'NVIDIA Corporation')`, [IDS.nvda]);
  await db.query(`insert into instruments (instrument_id, issuer_id, asset_type) values ($1, $1, 'common_stock')`, [IDS.nvda]);
  await db.query(`insert into listings (listing_id, instrument_id, mic, ticker, trading_currency, timezone) values ($1, $2, 'XNAS', 'NVDA', 'USD', 'America/New_York')`, [IDS.listing, IDS.nvda]);
  await db.query(`insert into listing_splits (listing_id, execution_date, split_from, split_to, source_id) values ($1, '2024-06-10', 1, 10, $2)`, [IDS.listing, IDS.polygon]);
  await db.query(`insert into listing_split_coverage (listing_id, checked_at, source_id) values ($1, '2024-06-10T12:00:00Z', $2)`, [IDS.listing, IDS.polygon]);
  await db.query(
    `insert into price_observations (listing_id, source_id, kind, price_text, currency, observed_at, known_at, fetched_at, body_sha256)
     values ($1, $2, 'session_close', '1200.00', 'USD', '2024-06-07T20:00:00Z', '2024-06-07T20:15:00Z', '2024-06-07T20:15:00Z', $3)`,
    [IDS.listing, IDS.polygon, "d".repeat(64)],
  );
  await seedAsFiled(db, {
    metric: "eps_diluted", unit: "currency_per_share", value: "11.93", source: IDS.tenK, asFiledOn: "2024-02-21", reportedAt: "2024-02-21T00:00:00Z",
    period: { kind: "fiscal_y", start: "2023-01-30", end: "2024-01-28", fiscal_year: 2024, fiscal_period: "FY" },
  });
  await seedAsFiled(db, {
    metric: "shares_outstanding", unit: "shares", value: "2464000000", source: IDS.tenQ, asFiledOn: "2024-05-17", reportedAt: "2024-05-29T00:00:00Z",
    period: { kind: "point", start: null, end: "2024-05-17", fiscal_year: 2025, fiscal_period: "Q1" },
  });
}

/** The deterministic plan a surface builds for NVDA's market cap and P/E, publishing their inputs beside them. */
function valuationPlan(authority: FinancialRuntimeAuthority): FinancialPlanV1 {
  const reported = (node_id: string, metric_key: string, period: Record<string, unknown>) => ({ node_id, operation: "reported_metric", subject_slot: "a", metric_key, period });
  const planned = buildDeterministicPlan({
    plan_id: randomUUID(),
    origin: { kind: "chat_request", ref: "chat:turn:valuation" },
    knowledge_cutoff: MONDAY_MORNING,
    cutoff_timezone: "America/New_York",
    reporting_basis: "as_reported",
    freshness_max_age_days: null,
    authority,
    parent_limits: {},
    max_model_calls: 0,
    requested_subjects: [{ mention: "NVDA", resolution: { status: "resolved", subject_ref: { kind: "issuer", id: IDS.nvda }, label: "NVIDIA Corporation" } }],
    publication_unit_kind: "chat_section",
  }, {
    subjects: [{ slot_id: "a", mention: "NVDA" }],
    operations: [
      reported("px", "share_price", { kind: "at_cutoff" }),
      reported("shares", "shares_outstanding", { kind: "latest", period_type: "quarterly", offset: 0 }),
      reported("eps", "eps_diluted", { kind: "latest", period_type: "annual", offset: 0 }),
      { node_id: "cap", operation: "market_cap", price: "px", shares: "shares" },
      { node_id: "pe", operation: "pe_ratio", price: "px", earnings: "eps" },
    ],
    outputs: ["px", "shares", "eps", "cap", "pe"].map((node) => ({ output_id: `out_${node}`, node_id: node })),
    thresholds: [],
  });
  assert.ok(planned.outcome === "ready", JSON.stringify(planned));
  return planned.plan;
}

async function results(db: Client, runId: string): Promise<Record<string, [string, string | undefined]>> {
  const rows = (await db.query<{ output_id: string; disposition: string; payload: { value?: string; reason_code?: string } }>(
    `select output_id, disposition, payload from financial_results where run_id = $1 order by output_id`,
    [runId],
  )).rows;
  return Object.fromEntries(rows.map((row) => [row.output_id, [row.disposition, row.payload.value ?? row.payload.reason_code]]));
}

test("market cap and P/E", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for valuation coverage");
    return;
  }
  const db = await engineDatabase(t, "fin-valuation");
  await seedNvda(db);

  await t.test("with market data allowed, NVDA's market cap is 2,956,800,000,000 and its P/E 120 / 1.193, and the unit seals", async () => {
    const authority = authorityFor(FIXTURE_IDS.owner, { allowed_source_classes: ["sec_filing", "market_data"] });
    const { runId, lease } = await readyRun(db, valuationPlan(authority), authority);
    assert.deepEqual(await results(db, runId), {
      out_cap: ["computed", "2956800000000"],
      out_eps: ["computed", "1.193"],
      out_pe: ["computed", "100.58675607711651299245599329421626152556580050293"],
      out_px: ["computed", "120"],
      out_shares: ["computed", "24640000000"],
    });
    const [client] = await pinnedClients(t, db, 1);
    const sealed = await finalizeUnit({ client: client!, lease, authority, unit_id: "answer", snapshot_id: randomUUID(), persistParent: async () => {} });
    assert.equal(sealed.status, "published", JSON.stringify(sealed));

    const resultId = (await db.query(`select result_id::text from financial_results where run_id = $1 and output_id = 'out_pe'`, [runId])).rows[0]!.result_id;
    const inspection = await inspectCommittedResult(db, FIXTURE_IDS.owner, resultId);
    const ajv = new Ajv2020({ strict: false, validateFormats: false });
    for (const file of ["finance_research_block_schema.json", "financial_plan_schema.json", "financial_result_schema.json", "financial_answer_http_schema.json"]) {
      ajv.addSchema(JSON.parse(readFileSync(new URL(`../../../spec/${file}`, import.meta.url), "utf8")));
    }
    const valid = ajv.getSchema("https://example.com/schemas/financial_answer_http_schema.json#/$defs/FinancialResultInspection")!;
    assert.ok(valid(inspection), JSON.stringify(valid.errors));
    assert.ok(inspection?.availability === "available");
    assert.deepEqual([inspection.disposition, inspection.formula], ["verified", { operation: "pe_ratio", operation_version: "pe_ratio.v1", numeric_policy_version: "numeric-policy.v1" }]);
    assert.deepEqual(inspection.inputs.map((input) => input.status === "bound" && [input.input_slot, input.value, input.split_adjustment?.adjusted_native_value]), [
      ["eps", "11.93", { numerator: "1193", denominator: "1000" }],
      ["px", "1200", { numerator: "120", denominator: "1" }],
    ]);
  });

  await t.test("without market data, the price is a named gap and both figures are blocked, never computed from another price", async () => {
    const authority = authorityFor();
    const { runId } = await readyRun(db, valuationPlan(authority), authority);
    assert.deepEqual(await results(db, runId), {
      out_cap: ["blocked_dependency", "blocked_by_dependency"],
      out_eps: ["computed", "1.193"],
      out_pe: ["blocked_dependency", "blocked_by_dependency"],
      out_px: ["unsupported", "source_class_not_allowed"],
      out_shares: ["computed", "24640000000"],
    });
  });
});
