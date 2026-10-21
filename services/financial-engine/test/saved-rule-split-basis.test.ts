// A saved rule's threshold names no split basis date (#387). EPS and share
// counts bind restated to the evaluation date, so a rule on one would flip on
// a split's date: it is unsupported until a rule carries its own basis date.

import assert from "node:assert/strict";
import test from "node:test";
import type { FinancialEvidencePort, FinancialPool } from "../src/ports.ts";
import { translateSavedRule, type SavedMetricRule } from "../src/saved-rule.ts";
import { authorityFor, IDS } from "./db-fixtures.ts";

const unused = async (): Promise<never> => {
  throw new Error("a rejected rule reads no evidence");
};
const pool: FinancialPool = { query: unused, connect: unused };
const evidence = (): FinancialEvidencePort => ({ listInputCandidates: unused, readSplitHistory: unused });

async function translated(rule: Pick<SavedMetricRule, "metric_key" | "unit" | "period_kind">): Promise<string> {
  const translation = await translateSavedRule(
    { pool, evidence },
    {
      authority: authorityFor(),
      subject: { kind: "issuer", id: IDS.issuerA },
      rule: { ...rule, operator: "gte", threshold: "5", max_age_days: 400 },
      as_of: "2026-10-01T00:00:00.000Z",
    },
  );
  return translation.ok ? "translated" : translation.reason;
}

test("a saved rule on EPS or a share count is unsupported; one on revenue translates", async () => {
  assert.deepEqual(
    await Promise.all([
      translated({ metric_key: "eps_diluted", unit: "USD", period_kind: "fiscal_y" }),
      translated({ metric_key: "eps_basic", unit: "USD", period_kind: "fiscal_q" }),
      translated({ metric_key: "weighted_average_diluted_shares", unit: "shares", period_kind: "fiscal_y" }),
      translated({ metric_key: "shares_outstanding", unit: "shares", period_kind: "fiscal_q" }),
    ]),
    ["threshold_has_no_split_basis", "threshold_has_no_split_basis", "threshold_has_no_split_basis", "threshold_has_no_split_basis"],
  );
  assert.equal(await translated({ metric_key: "revenue", unit: "USD", period_kind: "fiscal_y" }), "translated");
});
