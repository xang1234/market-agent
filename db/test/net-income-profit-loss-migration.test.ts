import assert from "node:assert/strict";
import test from "node:test";
import { dockerAvailable } from "./docker-pg.ts";
import { applyCanonicalSchema, applyMigration, createDatabase, startServer } from "./financial-migration-helpers.ts";

const ISSUER = "0f000000-0000-4000-8000-0000000000a9";
const SOURCE = "0f000000-0000-4000-8000-0000000000c9";
const METRICS = {
  net_income: "0f000000-0000-4000-8000-0000000000bb",
  net_margin: "0f000000-0000-4000-8000-0000000000bc",
  net_margin_spread: "0f000000-0000-4000-8000-0000000000bd",
} as const;
const FACTS = {
  parent: "0f000000-0000-4000-8000-0000000000e1",
  profitLoss: "0f000000-0000-4000-8000-0000000000e2",
  derivedProfitLoss: "0f000000-0000-4000-8000-0000000000e3",
  restatedProfitLoss: "0f000000-0000-4000-8000-0000000000e4",
  restatedParent: "0f000000-0000-4000-8000-0000000000e5",
  marginOfParent: "0f000000-0000-4000-8000-0000000000e6",
  marginOfProfitLoss: "0f000000-0000-4000-8000-0000000000e7",
  spreadOfMargins: "0f000000-0000-4000-8000-0000000000e8",
} as const;

test("0076 invalidates net income facts stored from ProfitLoss, and the facts derived from them", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for migration coverage");
    return;
  }
  const server = await startServer(t, "net-income-0076");
  const db = await createDatabase(t, server, "net_income_0076");
  await applyCanonicalSchema(db);
  const fact = (id: string, metric: keyof typeof METRICS, year: number, period: string, method: string, qualityFlags: unknown[], supersedes: string | null = null) =>
    `('${id}', 'issuer', '${ISSUER}', '${METRICS[metric]}', '${period === "FY" ? "fiscal_y" : "fiscal_q"}', '${year}-01-01', '${year}-12-31', ${year}, '${period}', 70, 'currency', 'USD', 1,
      '2024-01-10T00:00:00Z', '2024-01-10T00:00:00Z', '2024-02-01T00:00:00Z', '${SOURCE}', '${method}', 'authoritative', 'filing_time', 'full', 1,
      '${JSON.stringify(qualityFlags)}', ${supersedes === null ? "null" : `'${supersedes}'`})`;
  const proof = (id: string, concept: string) =>
    `('${id}', '${SOURCE}', 'source_token_preserved', '70', '${"0".repeat(64)}', '70', '1',
      'sec_edgar:companyfacts:CIK0000000342#${concept}|USD|0000000342-24-000010|2023-01-01..2023-12-31', 'sec_companyfacts_lossless_json.v1')`;
  const derivedFrom = (metric: string, ...inputs: string[]) => [{ kind: "derivation", metric, input_fact_ids: inputs }];
  await db.query(`
    insert into metrics (metric_id, metric_key, display_name, unit_class, aggregation, interpretation, canonical_source_class) values
      ('${METRICS.net_income}', 'net_income', 'Net income', 'currency', 'sum', 'higher_is_better', 'gaap'),
      ('${METRICS.net_margin}', 'net_margin', 'Net margin', 'percent', 'derived', 'higher_is_better', 'derived'),
      ('${METRICS.net_margin_spread}', 'net_margin_spread', 'Net margin spread', 'percent', 'derived', 'neutral', 'derived');
    insert into sources (source_id, provider, kind, trust_tier, license_class, retrieved_at) values ('${SOURCE}', 'sec_edgar', 'filing', 'primary', 'public', now());
    insert into facts (fact_id, subject_kind, subject_id, metric_id, period_kind, period_start, period_end, fiscal_year, fiscal_period,
                       value_num, unit, currency, scale, as_of, reported_at, observed_at, source_id, method,
                       verification_status, freshness_class, coverage_level, confidence, quality_flags, supersedes) values
      ${fact(FACTS.parent, "net_income", 2023, "FY", "reported", [])},
      ${fact(FACTS.profitLoss, "net_income", 2022, "FY", "reported", [])},
      ${fact(FACTS.derivedProfitLoss, "net_income", 2022, "Q4", "reported", [{ kind: "sec_period_difference", concept: "ProfitLoss", unit: "USD" }])},
      ${fact(FACTS.restatedProfitLoss, "net_income", 2022, "FY", "restated", [], FACTS.profitLoss)},
      ${fact(FACTS.restatedParent, "net_income", 2023, "FY", "restated", [], FACTS.parent)},
      ${fact(FACTS.marginOfParent, "net_margin", 2023, "FY", "derived", derivedFrom("net_margin", FACTS.parent))},
      ${fact(FACTS.marginOfProfitLoss, "net_margin", 2022, "Q4", "derived", derivedFrom("net_margin", FACTS.derivedProfitLoss))},
      ${fact(FACTS.spreadOfMargins, "net_margin_spread", 2022, "Q4", "derived", derivedFrom("net_margin_spread", FACTS.marginOfParent, FACTS.marginOfProfitLoss))};
    insert into fact_precision_attestations (fact_id, source_id, precision_class, raw_token, token_proof_hash, value_text, scale_text,
                                             source_locator, validation_method) values
      ${proof(FACTS.parent, "NetIncomeLoss")}, ${proof(FACTS.profitLoss, "ProfitLoss")},
      ${proof(FACTS.restatedProfitLoss, "ProfitLoss")}, ${proof(FACTS.restatedParent, "NetIncomeLoss")};
  `);
  const active = async () => (await db.query(`select fact_id::text from facts where invalidated_at is null order by fact_id`)).rows.map((row) => row.fact_id);
  const kept = [FACTS.parent, FACTS.restatedParent, FACTS.marginOfParent];

  await applyMigration(db, "0076", "up");
  assert.deepEqual(await active(), kept, "ProfitLoss facts, their restatements, and every fact derived from one, at any depth, are invalidated");
  await applyMigration(db, "0076", "down");
  await applyMigration(db, "0076", "up");
  assert.deepEqual(await active(), kept);
});
