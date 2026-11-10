import { readFileSync } from "node:fs";
import { parseFinancialJson } from "../src/lossless-financial-json.ts";

/** Real companyfacts for the Call's inputs (#594), by ticker. */
export function callInputsCompanyFacts(): Record<string, unknown> {
  return parseFinancialJson(readFileSync(new URL("./sec-call-inputs.companyfacts.json", import.meta.url), "utf8")) as Record<string, unknown>;
}

// The fixture holds no cash and equivalents. ADR 0006's hand audit read AAPL's
// from its FY2026 10-K (accession 0000320193-26-000026): USD 36,305M at 2026-09-26.
const AAPL_FY2026_CASH = {
  label: "Cash and Cash Equivalents, at Carrying Value",
  description: "",
  units: {
    USD: [{ end: "2026-09-26", val: 36305000000, val_token: "36305000000", accn: "0000320193-26-000026", fy: 2026, fp: "FY", form: "10-K", filed: "2026-11-03", frame: "CY2026Q3I" }],
  },
};

/** AAPL's companyfacts with its FY2026 10-K's cash and equivalents, so its net cash forms. */
export function aaplWithCash(facts: Record<string, unknown> = callInputsCompanyFacts()): unknown {
  const aapl = facts.AAPL as { facts: { "us-gaap": Record<string, unknown> } };
  return { ...aapl, facts: { ...aapl.facts, "us-gaap": { ...aapl.facts["us-gaap"], CashAndCashEquivalentsAtCarryingValue: AAPL_FY2026_CASH } } };
}
