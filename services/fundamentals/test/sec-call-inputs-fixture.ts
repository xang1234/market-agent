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

const AAPL_FY2026_10K = { accn: "0000320193-26-000026", fy: 2026, fp: "FY", form: "10-K", filed: "2026-11-03" };
const fy2026 = (val: string) => ({ label: "", description: "", units: { USD: [{ start: "2025-09-28", end: "2026-09-26", val: Number(val), val_token: val, ...AAPL_FY2026_10K, frame: "CY2026" }] } });

/**
 * AAPL's FY2026 Call inputs: aaplWithCash plus the operating cash flow, PP&E
 * capex and cover-page share count the hand audit read off the same 10-K
 * (ADR 0006's probe). The trimmed companyfacts hold none of the three.
 */
export function aaplCallInputs(facts: Record<string, unknown> = callInputsCompanyFacts()): unknown {
  const aapl = aaplWithCash(facts) as { facts: Record<string, Record<string, unknown>> };
  return {
    ...aapl,
    facts: {
      ...aapl.facts,
      "us-gaap": {
        ...aapl.facts["us-gaap"],
        NetCashProvidedByUsedInOperatingActivities: fy2026("145097000000"),
        PaymentsToAcquirePropertyPlantAndEquipment: fy2026("9041000000"),
      },
      dei: {
        ...aapl.facts.dei,
        EntityCommonStockSharesOutstanding: {
          label: "", description: "",
          units: { shares: [{ end: "2026-10-23", val: 14532182000, val_token: "14532182000", ...AAPL_FY2026_10K }] },
        },
      },
    },
  };
}
