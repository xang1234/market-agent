import { readFileSync } from "node:fs";
import { parseFinancialJson } from "../src/lossless-financial-json.ts";

/** Companyfacts trimmed to the Call-input tags (#594), by ticker: each value real, but not every tag the filer reports. */
export function callInputsCompanyFacts(): Record<string, unknown> {
  return parseFinancialJson(readFileSync(new URL("./sec-call-inputs.companyfacts.json", import.meta.url), "utf8")) as Record<string, unknown>;
}

// The fixture holds no cash and equivalents for any filer. This one is not
// from companyfacts: it is the value ADR 0006's hand audit read off AAPL's
// FY2026 10-K (accession 0000320193-26-000026), USD 36,305M at 2026-09-26,
// injected in companyfacts form.
const AAPL_FY2026_CASH = {
  label: "Cash and Cash Equivalents, at Carrying Value",
  description: "",
  units: {
    USD: [{ end: "2026-09-26", val: 36305000000, val_token: "36305000000", accn: "0000320193-26-000026", fy: 2026, fp: "FY", form: "10-K", filed: "2026-11-03", frame: "CY2026Q3I" }],
  },
};

/** AAPL's trimmed companyfacts plus the hand audit's FY2026 cash and equivalents, so its net cash forms. */
export function aaplWithCash(facts: Record<string, unknown> = callInputsCompanyFacts()): unknown {
  const aapl = facts.AAPL as { facts: { "us-gaap": Record<string, unknown> } };
  return { ...aapl, facts: { ...aapl.facts, "us-gaap": { ...aapl.facts["us-gaap"], CashAndCashEquivalentsAtCarryingValue: AAPL_FY2026_CASH } } };
}
