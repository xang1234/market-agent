import assert from "node:assert/strict";
import test from "node:test";
import { dockerAvailable } from "../../../db/test/docker-pg.ts";
import { translateSavedRule, type SavedMetricRule } from "../src/saved-rule.ts";
import { engineDatabase, IDS } from "./db-fixtures.ts";

const CUTOFF = "2024-03-01T00:00:00.000Z";
const RULE: SavedMetricRule = { metric_key: "gross_profit", unit: "currency", period_kind: "fiscal_y", operator: "gt", threshold: "1", max_age_days: 730 };

test("a generic currency rule takes its currency only from facts the engine could bind at the cutoff", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for saved-rule coverage");
    return;
  }
  const db = await engineDatabase(t, "saved-rule-currency");
  const thresholdUnit = async () => {
    const translation = await translateSavedRule(db, IDS.issuerA, RULE, CUTOFF);
    return translation.ok ? translation.draft.thresholds[0]!.unit : translation.reason;
  };
  const euroFact = (fact: { source: string; year?: number; at?: string; invalidated?: boolean }) => db.query(
    `insert into facts (subject_kind, subject_id, metric_id, period_kind, period_start, period_end, fiscal_year, fiscal_period,
                        value_num, unit, currency, scale, as_of, reported_at, observed_at, source_id, method, verification_status,
                        freshness_class, coverage_level, confidence, invalidated_at)
     values ('issuer', $1, $2, 'fiscal_y', make_date($6, 1, 1), make_date($6, 12, 31), $6, 'FY', 1, 'currency', 'EUR', 1, $3, $3, $3, $4,
             'reported', 'authoritative', 'filing_time', 'full', 1, $5)`,
    [IDS.issuerA, IDS.grossProfit, fact.at ?? "2024-02-01T00:00:00Z", fact.source, fact.invalidated ? "2024-02-15T00:00:00Z" : null, fact.year ?? 2023],
  );

  assert.deepEqual(await thresholdUnit(), { kind: "currency", currency: "USD" });
  await euroFact({ source: IDS.privateSource });
  await euroFact({ source: IDS.sourceV1, invalidated: true });
  await euroFact({ source: IDS.sourceV2, at: "2024-06-01T00:00:00Z" });
  assert.deepEqual(await thresholdUnit(), { kind: "currency", currency: "USD" }, "private, invalidated, and later facts never bind");
  await euroFact({ source: IDS.sourceV2, year: 2022 });
  assert.equal(await thresholdUnit(), "unit_does_not_match_definition", "a second bindable currency is still ambiguous");
});
