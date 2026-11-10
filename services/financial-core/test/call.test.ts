// The Call's content (ADR 0005, ADR 0006, #604), assembled from certified
// inputs: AAPL's FY2026 inputs as ADR 0006's probe reads them, and each named
// input outcome that declines a Call under rule 0.

import assert from "node:assert/strict";
import test from "node:test";
import { assembleCall, DEFAULT_CALL_SETTINGS, parseCallSettings, type CallContent, type CallEvidence } from "../src/index.ts";

const TEN_K = "00000000-0000-4000-8000-0000000000a1";
const PRICE_SOURCE = "00000000-0000-4000-8000-0000000000b1";
const CONSENSUS_SOURCE = "00000000-0000-4000-8000-0000000000c1";
const filing = (period_end: string) => ({ source_id: TEN_K, accession: "0000320193-26-000026", period_end, date: "2026-11-03" });

// ADR 0006's AAPL probe: F0, N and SBC from the FY2026 10-K, the cover count, and Friday's close.
const AAPL: CallEvidence = {
  call_date: "2026-11-09",
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
};

const figures = (rows: CallContent["facts"]) => rows.map((row) => [row.id, row.kind, row.figure.text]);

test("AAPL: today's multiple is 36.15x, the price requires 7.3% a year, and the stance declines under rule 1", () => {
  const call = assembleCall(AAPL);
  assert.deepEqual(figures(call.facts), [
    ["free_cash_flow", "deterministic_result", "USD 136,056,000,000"],
    ["net_cash", "deterministic_result", "USD 56,824,000,000"],
    ["stock_based_compensation", "reported_fact", "USD 13,789,000,000"],
    ["shares_outstanding", "reported_fact", "14,532,182,000 shares"],
    ["share_price", "market_observation", "USD 342.37 per share"],
  ]);
  assert.deepEqual(figures(call.assumptions), [
    ["required_return", "owner_policy", "10%"],
    ["exit_multiple", "deterministic_result", "36.15x"],
    ["share_change", "agent_assumption", "0.277% a year"],
  ]);
  assert.deepEqual(figures(call.requires), [
    ["required_growth", "deterministic_result", "7.3% a year"],
    ["consensus", "attributed_consensus", "8.18%"],
  ]);
  assert.equal(call.assumptions[2]!.basis.startsWith("judgment:"), true, "d is the agent's judgment");
  assert.equal(call.requires[1]!.label, "Attributed consensus: Finviz EPS growth, next 5 years");
  assert.equal(call.facts[0]!.citations[0]!.text, "10-K 0000320193-26-000026, period ended 2026-09-26, public by 2026-11-03");
  assert.equal(call.facts[4]!.citations[0]!.text, "Close on 2026-11-06");
  assert.deepEqual(call.stance, {
    kind: "declined",
    rule: 1,
    text: "Declined under rule 1: the exit multiple has no anchor, so no stance is stated.",
    reasons: [{
      cites: "exit_multiple",
      text: "Today's multiple is the only exit multiple on file. Anchoring another needs about ten years of the company's own multiple history, which is not captured yet.",
    }],
  });
  assert.deepEqual(call.settings, { required_return: "0.1", margin_of_safety: "1.25", bear_loss_limit: "0.25", near_band: "0.1" });
});

test("NVDA: free cash flow blocked on its capex declines under rule 0, and what the price requires names that outcome", () => {
  const call = assembleCall({ ...AAPL, figures: { ...AAPL.figures, free_cash_flow: { kind: "gap", disposition: "blocked_dependency", reason_code: "blocked_by_dependency" } } });
  assert.deepEqual(call.facts[0]!.figure, { kind: "outcome", outcome: "blocked_dependency", reason_code: "blocked_by_dependency", text: "Not certified: blocked_dependency (blocked_by_dependency)" });
  assert.deepEqual(call.stance, {
    kind: "declined",
    rule: 0,
    text: "Declined under rule 0: an input has no certified value, so no stance is stated.",
    reasons: [{ cites: "free_cash_flow", text: "Free cash flow: Not certified: blocked_dependency (blocked_by_dependency)" }],
  });
  assert.deepEqual(call.requires[0]!.figure, { kind: "outcome", outcome: "blocked_dependency", reason_code: "blocked_by_dependency", text: "Not computed. Free cash flow: Not certified: blocked_dependency (blocked_by_dependency)" });
  assert.equal(call.assumptions[1]!.figure.kind, "outcome");
});

test("a close more than 5 trading days before the Call date declines under rule 0 as stale_input", () => {
  const call = assembleCall({ ...AAPL, price_date: "2026-10-30" });
  assert.equal(call.stance.rule, 0);
  assert.deepEqual(call.stance.reasons, [{ cites: "share_price", text: "Share price: No price within 5 trading days of the Call date." }]);
  assert.deepEqual(call.requires[0]!.figure, { kind: "outcome", outcome: "stale_price", reason_code: "stale_input", text: "Not computed. Share price: No price within 5 trading days of the Call date." });
});

test("missing shares decline under rule 0 with the engine's reason", () => {
  const call = assembleCall({
    ...AAPL,
    figures: { ...AAPL.figures, shares_outstanding: { kind: "gap", disposition: "missing", reason_code: "missing_input" }, market_cap: { kind: "gap", disposition: "blocked_dependency", reason_code: "missing_input" } },
  });
  assert.deepEqual(call.stance.reasons, [{ cites: "shares_outstanding", text: "Shares outstanding: Not certified: missing (missing_input)" }]);
});

test("net cash from another filing than free cash flow's 10-K is incompatible_period, under rule 0", () => {
  const call = assembleCall({ ...AAPL, citations: { ...AAPL.citations, net_cash: [{ ...filing("2026-06-27"), source_id: PRICE_SOURCE }] } });
  assert.deepEqual(call.facts[1]!.figure, { kind: "outcome", outcome: "incompatible_period", reason_code: "incompatible_period", text: "Not from free cash flow's 10-K and balance-sheet date" });
  assert.deepEqual(call.stance.reasons.map((reason) => reason.cites), ["net_cash"]);
});

test("no consensus captured within 7 days reads so, and the Call is otherwise unchanged", () => {
  const call = assembleCall({ ...AAPL, consensus: [{ ...AAPL.consensus[0]!, captured_on: "2026-11-01" }] });
  assert.deepEqual(call.requires[1]!.figure, { kind: "outcome", outcome: "no_consensus", reason_code: null, text: "no consensus within 7 days" });
  assert.deepEqual(call.requires[1]!.citations, []);
  const fresh = assembleCall(AAPL);
  assert.deepEqual({ ...call, requires: [call.requires[0]] }, { ...fresh, requires: [fresh.requires[0]] });
});

test("owner settings save only inside ADR 0005's ranges, as canonical decimals", () => {
  assert.deepEqual(parseCallSettings({ required_return: "0.08", margin_of_safety: "1", bear_loss_limit: "0.5", near_band: "0.05" }), { required_return: "0.08", margin_of_safety: "1", bear_loss_limit: "0.5", near_band: "0.05" });
  const outside = [
    { required_return: "0" },
    { margin_of_safety: "0.99" },
    { bear_loss_limit: "0" },
    { bear_loss_limit: "1" },
    { near_band: "0" },
    { required_return: "0.10" },
    { required_return: 0.1 },
    { extra: "1" },
  ];
  for (const change of outside) assert.equal(parseCallSettings({ ...DEFAULT_CALL_SETTINGS, ...change }), null, JSON.stringify(change));
  assert.equal(parseCallSettings({ required_return: "0.1" }), null, "every setting is required");
});

test("a non-USD filer declines under rule 0 citing free cash flow, not the USD price", () => {
  const call = assembleCall({ ...AAPL, figures: { ...AAPL.figures, free_cash_flow: { kind: "value", value: "136056000000", currency: "EUR" } } });
  assert.deepEqual([call.stance.rule, call.stance.reasons.map((r) => r.cites)], [0, ["free_cash_flow"]]);
});

test("a share change at or below -100% declines under rule 0 citing the share change", () => {
  const call = assembleCall({ ...AAPL, figures: { ...AAPL.figures, stock_based_compensation: { kind: "value", value: "-6000000000000", currency: "USD" } } });
  assert.deepEqual([call.stance.rule, call.stance.reasons.map((r) => r.cites)], [0, ["share_change"]]);
});
