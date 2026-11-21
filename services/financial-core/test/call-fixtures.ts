// ADR 0006's AAPL probe as a Call's evidence (#604, #605): F0, N and SBC from the FY2026 10-K, the cover count,
// Friday's close, and FY2017 to FY2026 as the engine certifies them from AAPL's 10-Ks with the closes a dev capture
// took (services/chat/test/financial-call-anchor.test.ts runs the same history through the engine).

import { DEFAULT_CALL_SETTINGS, type CallEvidence, type CallHistoryYear } from "../src/index.ts";

export const TEN_K = "00000000-0000-4000-8000-0000000000a1";
export const PRICE_SOURCE = "00000000-0000-4000-8000-0000000000b1";
export const CONSENSUS_SOURCE = "00000000-0000-4000-8000-0000000000c1";
export const CLOSE_SOURCE = "00000000-0000-4000-8000-00000000000b";
export const filing = (period_end: string) => ({ source_id: TEN_K, accession: "0000320193-26-000026", period_end, date: "2026-11-03" });

// Fiscal year, its end, free cash flow, net cash, diluted weighted-average shares on the Call date's split basis
// (FY2017 to FY2019's are their 10-Ks' counts times the 2020 4-for-1 split), and yfinance's split-adjusted close on
// the year's last session.
const YEARS: ReadonlyArray<readonly [number, string, string, string, string, string, string]> = [
  [2026, "2026-09-26", "136056000000", "56824000000", "14720306000", "2026-09-25", "341.07000732421875"],
  [2025, "2025-09-27", "98767000000", "33763000000", "15004697000", "2025-09-26", "255.4600067138672"],
  [2024, "2024-09-28", "108807000000", "50021000000", "15408095000", "2024-09-27", "227.7899932861328"],
  [2023, "2023-09-30", "99584000000", "51011000000", "15812547000", "2023-09-29", "171.2100067138672"],
  [2022, "2022-09-24", "111443000000", "49040000000", "16325819000", "2022-09-23", "150.42999267578125"],
  [2021, "2021-09-25", "92953000000", "65797000000", "16864919000", "2021-09-24", "146.9199981689453"],
  [2020, "2020-09-26", "73365000000", "79394000000", "17528214000", "2020-09-25", "112.27999877929688"],
  [2019, "2019-09-28", "58896000000", "97851000000", "18595652000", "2019-09-27", "54.70500183105469"],
  [2018, "2018-09-29", "64121000000", "-88570000000", "20000436000", "2018-09-28", "56.435001373291016"],
  [2017, "2017-09-30", "51774000000", "-95391000000", "21006768000", "2017-09-29", "38.529998779296875"],
];

export const AAPL_HISTORY: ReadonlyArray<CallHistoryYear> = YEARS.map(([fiscal_year, end, fcf, net, shares]) => ({
  fiscal_year,
  period_end: end,
  figures: {
    free_cash_flow: { kind: "value", value: fcf, currency: "USD" },
    net_cash: { kind: "value", value: net, currency: "USD" },
    shares: { kind: "value", value: shares, currency: null },
  },
  citations: { free_cash_flow: [filing(end)], net_cash: [filing(end)], shares: [filing(end)] },
}));

export const AAPL: CallEvidence = {
  call_date: "2026-11-09",
  listing_timezone: "America/New_York",
  subject: { issuer_id: "00000000-0000-4000-8000-0000000000d1", label: "AAPL" },
  settings: DEFAULT_CALL_SETTINGS,
  inputs: { snapshot_id: "00000000-0000-4000-8000-0000000000e1", run_id: "00000000-0000-4000-8000-0000000000e2", unit_id: "call", fingerprint: "f".repeat(64) },
  figures: {
    free_cash_flow: { kind: "value", value: "136056000000", currency: "USD" },
    net_cash: { kind: "value", value: "56824000000", currency: "USD" },
    stock_based_compensation: { kind: "value", value: "13789000000", currency: "USD" },
    shares_outstanding: { kind: "value", value: "14532182000", currency: null },
    share_price: { kind: "value", value: "342.37", currency: "USD" },
    market_cap: { kind: "value", value: "4975383151340", currency: "USD" },
  },
  citations: {
    free_cash_flow: [filing("2026-09-26")],
    net_cash: [filing("2026-09-26")],
    stock_based_compensation: [filing("2026-09-26")],
    shares_outstanding: [filing("2026-10-23")],
    share_price: [{ source_id: PRICE_SOURCE, accession: null, period_end: null, date: "2026-11-06" }],
  },
  fiscal_year_end: "2026-09-26",
  price_date: "2026-11-06",
  consensus: [{ source_id: CONSENSUS_SOURCE, captured_on: "2026-11-09", eps_growth_next_5y: "8.18" }],
  history: AAPL_HISTORY,
  closes: {
    source_id: CLOSE_SOURCE,
    captured_on: "2026-11-08",
    currency: "USD",
    closes: YEARS.map(([, , , , , trade_date, close_text]) => ({ trade_date, close_text })).reverse(),
  },
  splits: [{ execution_date: "2020-08-31", split_from: "1", split_to: "4" }],
};
