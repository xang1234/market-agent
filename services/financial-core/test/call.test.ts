// The Call's content (ADR 0005, ADR 0006, #604, #605), assembled from
// certified inputs: AAPL's FY2026 inputs as ADR 0006's probe reads them, its
// last ten fiscal years' EV/FCF, and each named input outcome that declines a
// Call under rule 0.

import assert from "node:assert/strict";
import test from "node:test";
import { assembleCall, DEFAULT_CALL_SETTINGS, parseCallSettings, type CallContent, type CallEvidence } from "../src/index.ts";

import { AAPL, AAPL_HISTORY, filing, PRICE_SOURCE } from "./call-fixtures.ts";

const figures = (rows: CallContent["facts"]) => rows.map((row) => [row.id, row.kind, row.figure.text]);

test("free cash flow from capex filed as productive assets names that concept in its basis (#731)", () => {
  const ppe = assembleCall(AAPL).facts[0]!;
  assert.equal(ppe.basis, "free_cash_flow.v1: operating cash flow less PP&E capex, as reported in the latest 10-K");
  const scoped = assembleCall({ ...AAPL, capex_scope: { kind: "productive_assets_capex", concept: "PaymentsToAcquireProductiveAssets" } }).facts[0]!;
  assert.equal(
    scoped.basis,
    "free_cash_flow.v1: operating cash flow less capex, as reported in the latest 10-K. Capex is filed as PaymentsToAcquireProductiveAssets, which may include purchased intangibles as well as PP&E.",
  );
  assert.deepEqual({ ...scoped, basis: ppe.basis }, ppe, "only the basis moves");
});

const CONTINUING_OPERATIONS = { kind: "continuing_operations_ocf", concept: "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations" } as const;
const CONTINUING_NOTE = "Operating cash flow is filed as NetCashProvidedByUsedInOperatingActivitiesContinuingOperations, which excludes discontinued operations.";

test("free cash flow from OCF filed for continuing operations names that concept in its basis, and with productive-assets capex names both (#743)", () => {
  const ppe = assembleCall(AAPL);
  const continuing = assembleCall({ ...AAPL, ocf_scope: CONTINUING_OPERATIONS });
  assert.equal(continuing.facts[0]!.basis, `free_cash_flow.v1: operating cash flow less PP&E capex, as reported in the latest 10-K. ${CONTINUING_NOTE}`);
  const both = assembleCall({ ...AAPL, ocf_scope: CONTINUING_OPERATIONS, capex_scope: { kind: "productive_assets_capex", concept: "PaymentsToAcquireProductiveAssets" } });
  assert.equal(
    both.facts[0]!.basis,
    `free_cash_flow.v1: operating cash flow less capex, as reported in the latest 10-K. ${CONTINUING_NOTE} Capex is filed as PaymentsToAcquireProductiveAssets, which may include purchased intangibles as well as PP&E.`,
  );
  for (const call of [continuing, both]) {
    assert.deepEqual({ ...call, facts: call.facts.map((row) => ({ ...row, basis: ppe.facts.find((entry) => entry.id === row.id)!.basis })) }, ppe, "only the basis moves, the anchored exit multiple included");
  }
});

test("evidence from a caller that predates the capex and OCF scopes assembles as PP&E capex and total OCF (#731, #743)", () => {
  const { capex_scope: _, ocf_scope: __, ...unscoped } = AAPL;
  assert.deepEqual(assembleCall(unscoped as CallEvidence), assembleCall(AAPL));
});

test("AAPL: today's multiple is 36.15x, the anchored exit multiple 17.33x, and the stance declines under rule 1 for the bear case", () => {
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
    ["anchored_exit_multiple", "agent_assumption", "17.33x"],
    ["share_change", "agent_assumption", "0.277% a year"],
    ["bear_case", "agent_assumption", "Not anchored"],
  ]);
  assert.deepEqual(figures(call.requires), [
    ["required_growth", "deterministic_result", "7.3% a year"],
    ["required_growth_anchored", "deterministic_result", "22.5% a year"],
    ["consensus", "attributed_consensus", "8.18%"],
  ]);
  assert.equal(call.assumptions[3]!.basis.startsWith("judgment:"), true, "d is the agent's judgment");
  // The cap binds: 1.04 / (10% - 4%) = 52/3, below the median and today's multiple.
  assert.equal(
    call.assumptions[2]!.basis,
    "anchored: the lowest of today's multiple 36.15x, the FY2017 to FY2026 median EV/FCF 25.85x (range 15.61x to 38.47x) and 17.33x, the multiple whose implied perpetual growth at your 10% required return is 4%. Each year's EV is its last close on or before its fiscal year end times its diluted weighted-average shares on the closes' split basis, less its net cash. "
      + "A past 10-K's cover count never binds, while today's multiple uses the latest one. FY2026's diluted average is 1.29% above it, so the years' multiples read high against today's.",
  );
  assert.equal(call.assumptions[2]!.citations[2]!.text, "FY2019: 15.61x, (close 54.71 on 2019-09-27 × 18,595,652,000 shares − net cash USD 97,851,000,000) ÷ free cash flow USD 58,896,000,000; free cash flow, net cash and diluted shares from 10-K 0000320193-26-000026, period ended 2019-09-28, public by 2026-11-03");
  // Retrieved at 20:00 on 2026-11-07 in New York: the capture is dated on the listing's calendar, as split dates are.
  assert.equal(call.assumptions[2]!.citations.at(-1)!.text, "yfinance split-adjusted daily closes, captured 2026-11-07; dev only, never certified");
  assert.equal(call.requires[2]!.label, "Attributed consensus: Finviz EPS growth, next 5 years");
  assert.equal(call.facts[0]!.citations[0]!.text, "10-K 0000320193-26-000026, period ended 2026-09-26, public by 2026-11-03");
  assert.equal(call.facts[4]!.citations[0]!.text, "Close on 2026-11-06");
  assert.deepEqual(call.stance, {
    kind: "declined",
    rule: 1,
    text: "Declined under rule 1: the exit multiple is anchored, but the bear case is not, so no stance is stated.",
    reasons: [{ cites: "bear_case", text: "No bear case is anchored yet, so the bear value per share is not computed." }],
  });
  assert.deepEqual(call.settings, { required_return: "0.1", margin_of_safety: "1.25", bear_loss_limit: "0.25", near_band: "0.1" });
});

const anchored = (evidence: CallEvidence) => assembleCall(evidence).assumptions.find((row) => row.id === "anchored_exit_multiple")!;
const year = (fiscalYear: number, change: (entry: CallEvidence["history"][number]) => CallEvidence["history"][number]) =>
  AAPL_HISTORY.map((entry) => entry.fiscal_year === fiscalYear ? change(entry) : entry);

test("the median binds when it is the lowest, and today's multiple when it is; at a required return of 4% nothing caps it", () => {
  assert.equal(anchored({ ...AAPL, settings: { ...DEFAULT_CALL_SETTINGS, required_return: "0.05" } }).figure.text, "25.85x");
  // At USD 150 today's multiple is (150 × 14,532,182,000 − 56,824,000,000) ÷ 136,056,000,000 = 15.60x.
  const cheap = anchored({ ...AAPL, settings: { ...DEFAULT_CALL_SETTINGS, required_return: "0.04" }, figures: { ...AAPL.figures, share_price: { kind: "value", value: "150", currency: "USD" } } });
  assert.equal(cheap.figure.text, "15.60x");
  assert.match(cheap.basis, /\(range 15\.61x to 38\.47x\), with no cap: at your 4% required return no multiple implies perpetual growth above 4%\. /u);
});

test("a split after the capture restates each share count back to the closes' basis", () => {
  // Closes captured before a 2-for-1 split that executes before the Call trade at twice the counts' basis.
  const closes = { ...AAPL.closes!, retrieved_at: "2026-10-30T20:00:00.000Z", closes: AAPL.closes!.closes.map((close) => ({ ...close, close_text: String(Number(close.close_text) * 2) })) };
  const split = anchored({ ...AAPL, closes, splits: [...AAPL.splits!, { execution_date: "2026-11-02", split_from: "1", split_to: "2" }] });
  assert.deepEqual([split.figure.text, split.citations.slice(0, -1).map((citation) => citation.text.slice(0, 14))], [anchored(AAPL).figure.text, anchored(AAPL).citations.slice(0, -1).map((citation) => citation.text.slice(0, 14))]);
  assert.match(split.citations[2]!.text, /× 9,297,826,000 shares/u);
});

test("each year cites every filing its free cash flow, net cash and diluted shares came from", () => {
  const later = { ...filing("2019-09-28"), source_id: "00000000-0000-4000-8000-0000000000a2", accession: "0000320193-21-000105", date: "2021-10-29" };
  const row = anchored({ ...AAPL, history: year(2019, (entry) => ({ ...entry, citations: { free_cash_flow: [filing("2019-09-28"), later], net_cash: [later], shares: [later] } })) });
  assert.deepEqual(row.citations.filter((citation) => citation.text.startsWith("FY2019")).map((citation) => [citation.source_id, citation.text]), [
    [filing("2019-09-28").source_id, "FY2019: 15.61x, (close 54.71 on 2019-09-27 × 18,595,652,000 shares − net cash USD 97,851,000,000) ÷ free cash flow USD 58,896,000,000; free cash flow from 10-K 0000320193-26-000026, period ended 2019-09-28, public by 2026-11-03"],
    [later.source_id, "FY2019: free cash flow, net cash and diluted shares from 10-K 0000320193-21-000105, period ended 2019-09-28, public by 2021-10-29"],
  ]);
});

test("the basis names the share-count gap between the years' diluted averages and today's cover count, either way", () => {
  // A cover count of 15,000,000,000 is above FY2026's diluted 14,720,306,000 by 1.86%.
  const above = anchored({ ...AAPL, figures: { ...AAPL.figures, shares_outstanding: { kind: "value", value: "15000000000", currency: null } } });
  assert.match(above.basis, /FY2026's diluted average is 1\.86% below it, so the years' multiples read low against today's\.$/u);
});

test("a year without an EV/FCF multiple leaves the exit multiple unanchored, and rule 1 names both anchors", () => {
  const unanchored = (history: CallEvidence["history"], change: Partial<CallEvidence> = {}) => anchored({ ...AAPL, history, ...change }).figure.text;
  const prefix = "Not anchored: only 9 of the last 10 fiscal years have an EV/FCF multiple. FY2019: ";
  assert.equal(unanchored(year(2019, (entry) => ({ ...entry, figures: { ...entry.figures, free_cash_flow: { kind: "gap", disposition: "blocked_dependency", reason_code: "blocked_by_dependency" } } }))), `${prefix}free cash flow not certified (blocked_dependency, blocked_by_dependency).`);
  assert.equal(unanchored(year(2019, (entry) => ({ ...entry, figures: { ...entry.figures, free_cash_flow: { kind: "value", value: "-1", currency: "USD" } } }))), `${prefix}free cash flow is not positive.`);
  assert.equal(unanchored(year(2019, (entry) => ({ ...entry, citations: { ...entry.citations, net_cash: [filing("2018-09-29")] } }))), `${prefix}net cash is not at its fiscal year end, 2019-09-28.`);
  assert.equal(unanchored(year(2019, (entry) => ({ ...entry, figures: { ...entry.figures, net_cash: { kind: "value", value: "2000000000000", currency: "USD" } } }))), `${prefix}net cash is at least the market cap.`);
  assert.equal(unanchored(AAPL_HISTORY, { closes: { ...AAPL.closes!, closes: AAPL.closes!.closes.filter((close) => close.trade_date !== "2019-09-27") } }), `${prefix}no captured close in the 5 trading days to 2019-09-28.`);
  // A capture that starts after the oldest year's end says so, rather than that no close was captured.
  assert.equal(unanchored(AAPL_HISTORY, { closes: { ...AAPL.closes!, closes: AAPL.closes!.closes.filter((close) => close.trade_date > "2017-09-30") } }),
    "Not anchored: only 9 of the last 10 fiscal years have an EV/FCF multiple. FY2017: the closes captured 2026-11-07 start on 2018-09-28, after its fiscal year end 2017-09-30.");
  assert.equal(unanchored(AAPL_HISTORY.slice(0, 7).concat(AAPL_HISTORY.slice(7).map((entry) => ({ ...entry, period_end: null, figures: { ...entry.figures, free_cash_flow: { kind: "gap", disposition: "missing", reason_code: "missing_input" } } })))),
    "Not anchored: only 7 of the last 10 fiscal years have an EV/FCF multiple. FY2019: free cash flow not certified (missing, missing_input). FY2018: free cash flow not certified (missing, missing_input). FY2017: free cash flow not certified (missing, missing_input).");
  assert.equal(unanchored(AAPL_HISTORY, { closes: null }), "Not anchored: no closes are captured for the listing by the Call's cutoff.");
  assert.equal(unanchored(AAPL_HISTORY, { splits: null }), "Not anchored: the listing's split history is unknown, so no share count can be put on the closes' split basis.");
  assert.equal(unanchored(AAPL_HISTORY, { figures: { ...AAPL.figures, net_cash: { kind: "value", value: "5000000000000", currency: "USD" } } }), "Not anchored: there is no positive multiple today.");
  const call = assembleCall({ ...AAPL, closes: null });
  assert.equal(call.requires[1]!.figure.text, "Not computed: the exit multiple is not anchored.");
  assert.deepEqual([call.stance.text, call.stance.reasons], [
    "Declined under rule 1: neither the exit multiple nor the bear case is anchored, so no stance is stated.",
    [
      { cites: "anchored_exit_multiple", text: "No closes are captured for the listing by the Call's cutoff." },
      { cites: "bear_case", text: "No bear case is anchored yet, so the bear value per share is not computed." },
    ],
  ]);
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
  const notComputed = "Not computed. Free cash flow: Not certified: blocked_dependency (blocked_by_dependency)";
  assert.deepEqual([call.assumptions[2]!.figure.text, call.requires[1]!.figure.text, call.assumptions[4]!.figure.text], [notComputed, notComputed, "Not anchored"]);
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
  assert.deepEqual(call.requires[2]!.figure, { kind: "outcome", outcome: "no_consensus", reason_code: null, text: "no consensus within 7 days" });
  assert.deepEqual(call.requires[2]!.citations, []);
  const fresh = assembleCall(AAPL);
  assert.deepEqual({ ...call, requires: call.requires.slice(0, 2) }, { ...fresh, requires: fresh.requires.slice(0, 2) });
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
