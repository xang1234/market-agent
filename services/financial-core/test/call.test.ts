// The Call's content (ADR 0005, ADR 0006, #604, #605), assembled from
// certified inputs: AAPL's FY2026 inputs as ADR 0006's probe reads them, its
// last ten fiscal years' EV/FCF, and each named input outcome that declines a
// Call under rule 0.

import assert from "node:assert/strict";
import test from "node:test";
import { assembleCall, DEFAULT_CALL_SETTINGS, parseCallSettings, parseFinancialDecimal, rationalFromDecimal, STANCE_WORDS, type CallContent, type CallEvidence, type ExactRational } from "../src/index.ts";

import { AAPL, AAPL_HISTORY, BASE_RATES, filing, PRICE_SOURCE } from "./call-fixtures.ts";

function q(text: string): ExactRational {
  const parsed = parseFinancialDecimal(text);
  assert.ok(parsed.ok);
  return rationalFromDecimal(parsed.value)!;
}

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

test("AAPL: today's multiple is 36.15x, the anchored exit multiple 17.33x, the base case 4.24% and the bear case -4.93% a year, and it falls short of your hurdle", () => {
  const call = assembleCall(AAPL);
  assert.deepEqual(figures(call.facts), [
    ["free_cash_flow", "deterministic_result", "USD 136,056,000,000"],
    ["net_cash", "deterministic_result", "USD 56,824,000,000"],
    ["stock_based_compensation", "reported_fact", "USD 13,789,000,000"],
    ["shares_outstanding", "reported_fact", "14,532,182,000 shares"],
    ["share_price", "market_observation", "USD 342.37 per share"],
    ["revenue", "reported_fact", "USD 478,834,000,000"],
  ]);
  assert.deepEqual(figures(call.assumptions), [
    ["required_return", "owner_policy", "10%"],
    ["exit_multiple", "deterministic_result", "36.15x"],
    ["anchored_exit_multiple", "agent_assumption", "17.33x"],
    ["share_change", "agent_assumption", "0.277% a year"],
    ["base_case", "agent_assumption", "Growth 4.24% a year at 17.33x: base value USD 165.86 per share"],
    ["bear_case", "agent_assumption", "Growth -4.93% a year at 17.33x: bear value USD 111.73 per share"],
  ]);
  assert.deepEqual(figures(call.requires), [
    ["required_growth", "deterministic_result", "7.3% a year"],
    ["required_growth_anchored", "deterministic_result", "22.5% a year"],
    ["base_rate", "deterministic_result", "Of 430 five-year windows that began at a similar size (starting revenue USD 50.0B and up), 168 (39.1%) delivered free cash flow growth of at least 7.33% a year. Beside it, revenue grew at least that fast in 180 of 650 (27.7%)."],
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
  assert.equal(call.requires[3]!.label, "Attributed consensus: Finviz EPS growth, next 5 years");
  assert.equal(call.facts[0]!.citations[0]!.text, "10-K 0000320193-26-000026, period ended 2026-09-26, public by 2026-11-03");
  assert.equal(call.facts[4]!.citations[0]!.text, "Close on 2026-11-06");
  // H = min(V / 1.25, B / 0.75) = min(132.68, 148.97): the value test binds, and the price is more than 10% above it under every move.
  assert.deepEqual(call.stance, {
    kind: "stated",
    rule: 6,
    text: "Falls short of your hurdle.",
    reasons: [
      { cites: "base_case", text: "The base value V is USD 165.86 per share. The value test holds up to V ÷ your margin of safety 1.25 = USD 132.68." },
      { cites: "bear_case", text: "The bear value B is USD 111.73 per share. The bear-loss test holds up to B ÷ (1 − your 25% bear-loss limit) = USD 148.97." },
      { cites: "share_price", text: "The hurdle price H is USD 132.68, the lower of the two. The price, USD 342.37, is above H × (1 + your 10% near band) = USD 145.95." },
      { cites: "base_case", text: "Growth one point in the base and bear cases together: higher, H USD 138.36; lower, H USD 127.21. No tested move changes the stance." },
      { cites: "share_change", text: "The share change one point in both cases: higher, H USD 127.06; lower, H USD 138.65. No tested move changes the stance." },
      { cites: "required_return", text: "Your required return one point: higher, H USD 127.54; lower, H USD 138.11. No tested move changes the stance." },
      { cites: "anchored_exit_multiple", text: "The exit multiple 1x in both cases: higher, H USD 138.33; lower, H USD 127.04. No tested move changes the stance." },
    ],
    not_shown: [
      { part: "skew", text: "ADR 0005 and ADR 0006 define no bull case, so the difference from a bull value is not shown." },
      { part: "falsifiers", text: "ADR 0005 and ADR 0006 define no falsifiers, so what would change the stance is not shown." },
    ],
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

test("a year whose operating cash flow is filed for continuing operations names that scope in its citation (#743)", () => {
  const texts = (evidence: CallEvidence) => anchored(evidence).citations.map((citation) => citation.text);
  const scoped = texts({ ...AAPL, history: year(2019, (entry) => ({ ...entry, ocf_scope: CONTINUING_OPERATIONS })) });
  assert.deepEqual(scoped, texts(AAPL).map((text) => text.startsWith("FY2019: 15.61x, ") ? `${text}. ${CONTINUING_NOTE}` : text));
  assert.deepEqual(texts({ ...AAPL, history: year(2019, (entry) => ({ ...entry, ocf_scope: null })) }), texts(AAPL), "a total OCF year reads as before");
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
      { cites: "bear_case", text: "Both cases use the anchored exit multiple, which is not anchored." },
    ],
  ]);
  assert.equal(call.assumptions[4]!.figure.text, "Not anchored: both cases use the anchored exit multiple, which is not anchored.");
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
  assert.deepEqual([call.assumptions[2]!.figure.text, call.requires[1]!.figure.text, call.assumptions[5]!.figure.text], [notComputed, notComputed, notComputed]);
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
  assert.deepEqual(call.requires[3]!.figure, { kind: "outcome", outcome: "no_consensus", reason_code: null, text: "no consensus within 7 days" });
  assert.deepEqual(call.requires[3]!.citations, []);
  const fresh = assembleCall(AAPL);
  assert.deepEqual({ ...call, requires: call.requires.slice(0, 3) }, { ...fresh, requires: fresh.requires.slice(0, 3) });
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

const baseRate = (evidence: CallEvidence) => assembleCall(evidence).requires.find((row) => row.id === "base_rate")!;
// The committed table with each bucket's total free cash flow points changed.
const withFcf = (change: (points: ReadonlyArray<ExactRational>) => ReadonlyArray<ExactRational>) =>
  ({ ...BASE_RATES, buckets: BASE_RATES.buckets.map((bucket) => ({ ...bucket, metrics: { ...bucket.metrics, fcf: { ...bucket.metrics.fcf, points: change(bucket.metrics.fcf.points) } } })) });

test("the base rate cites the dataset and what it left out, and is a frequency, never a probability", () => {
  const row = baseRate(AAPL);
  assert.deepEqual(row.from, ["required_growth", "revenue"]);
  assert.match(row.basis, /^A frequency of reported history, not a probability\./u);
  assert.match(row.basis, /companyfacts archive of 2026-11-24 \(sha256 72bc1c52670fe57a3d701f13cbab55763c122388b314d1eaca921bb18ddfbacd\)/u);
  assert.match(row.basis, /in total free cash flow, before any change in share count, as the model's g is/u);
  assert.match(row.basis, /Not among the 430: 38 that ended early \(the filer stopped filing before year 5\), 6 with no year-5 figure, 95 whose two ends use different capex or cash flow concepts, 1 whose cash flow and capex at one end cover different periods and 45 that started at zero or negative free cash flow\. 37 of the 430 ended at or below zero and count as -100%$/u);
});

test("revenue the engine did not certify leaves the base rate and the bear case without a bucket, under rule 1, never rule 0; a thin bucket says how thin", () => {
  const gapped = assembleCall({ ...AAPL, figures: { ...AAPL.figures, revenue: { kind: "gap", disposition: "missing", reason_code: "missing_input" } } });
  assert.deepEqual(gapped.requires.find((row) => row.id === "base_rate")!.figure, {
    kind: "outcome", outcome: "missing", reason_code: "missing_input", text: "Not computed: revenue is not certified (missing, missing_input).",
  });
  assert.deepEqual(gapped.stance, {
    kind: "declined", rule: 1,
    text: "Declined under rule 1: the exit multiple is anchored, but the bear case is not, so no stance is stated.",
    reasons: [{ cites: "bear_case", text: "Revenue is not certified (missing, missing_input), so no size bucket holds the Call." }],
  });
  assert.equal(gapped.assumptions[4]!.figure.text, "Not anchored: revenue is not certified (missing, missing_input), so no size bucket holds the Call.");
  const thin = withFcf((points) => points.slice(0, 12));
  assert.equal(baseRate({ ...AAPL, base_rates: thin }).figure.text, "Not computed: only 12 windows began in starting revenue USD 50.0B and up, fewer than the 100 a base rate needs.");
  assert.match(baseRate({ ...AAPL, figures: { ...AAPL.figures, free_cash_flow: { kind: "gap", disposition: "blocked_dependency", reason_code: "blocked_by_dependency" } } }).figure.text, /^Not computed\. Free cash flow: Not certified/u);
});

test("the base rate counts the required growth rounded to the table's 4 stored places, and states that cutoff", () => {
  // AAPL requires about 7.3349% a year: a point at 7.33% meets the stated cutoff, one at 7.30% does not.
  const call = assembleCall({ ...AAPL, base_rates: withFcf((points) => points.map((_, index) => q(index === points.length - 1 ? "0.0733" : index === points.length - 2 ? "0.0730" : "-1"))) });
  assert.equal(call.requires.find((row) => row.id === "required_growth")!.figure.text, "7.3% a year");
  assert.match(call.requires.find((row) => row.id === "base_rate")!.figure.text, /^Of 430 five-year windows that began at a similar size \(starting revenue USD 50\.0B and up\), 1 \(0\.2%\) delivered free cash flow growth of at least 7\.33% a year\./u);
});

test("a call.v3 names the base-rate table it read, or null when none is loaded", () => {
  assert.equal(assembleCall(AAPL).base_rate_table, BASE_RATES.table_sha256);
  assert.equal(assembleCall({ ...AAPL, base_rates: null }).base_rate_table, null);
});

const caseRow = (evidence: CallEvidence, id: "base_case" | "bear_case") => assembleCall(evidence).assumptions.find((row) => row.id === id)!;

test("the base and bear cases are anchored on their bucket's median and 25th percentile of total free cash flow growth, and say they are a frequency, not a probability", () => {
  const tail = "of total free cash flow growth over five-year windows that began at starting revenue USD 50.0B and up, "
    + "from SEC's companyfacts archive of 2026-11-24 (sha256 72bc1c52670fe57a3d701f13cbab55763c122388b314d1eaca921bb18ddfbacd). It is a frequency of reported history, not a probability. "
    + "Total, not per share: buybacks are left out of g, as d leaves them out. The exit multiple is the anchored exit multiple and the share change is d";
  const [base, bear] = [caseRow(AAPL, "base_case"), caseRow(AAPL, "bear_case")];
  assert.deepEqual([base.kind, base.basis, base.from], ["agent_assumption", `anchored: growth is the median, at rank 215 of 430, ${tail}`, ["revenue", "anchored_exit_multiple", "share_change"]]);
  assert.deepEqual([bear.kind, bear.basis, bear.from], ["agent_assumption", `anchored: growth is the 25th percentile, at rank 108 of 430, ${tail}`, ["revenue", "anchored_exit_multiple", "share_change"]]);
  // Per share is never read: a table whose per-share points all floor at -100% leaves both cases as they are.
  const perShareFloor = { ...BASE_RATES, buckets: BASE_RATES.buckets.map((bucket) => ({ ...bucket, metrics: { ...bucket.metrics, fcf_per_share: { ...bucket.metrics.fcf_per_share, points: bucket.metrics.fcf_per_share.points.map(() => q("-1")) } } })) };
  assert.deepEqual(assembleCall({ ...AAPL, base_rates: perShareFloor }), assembleCall(AAPL));
  const thin = withFcf((points) => points.slice(0, 99));
  for (const id of ["base_case", "bear_case"] as const) {
    assert.equal(caseRow({ ...AAPL, base_rates: thin }, id).figure.text, "Not anchored: only 99 windows began in starting revenue USD 50.0B and up, fewer than the 100 a base rate needs.");
  }
});

test("a bucket whose 25th percentile is the -100% floor leaves B without a value, under rule 0, and the base rate still reads", () => {
  // Rank 108 of 430 is the 25th percentile; rank 215 the median.
  const call = assembleCall({ ...AAPL, base_rates: withFcf((points) => points.map((point, index) => index < 120 ? q("-1") : point)) });
  assert.deepEqual(call.stance, { kind: "declined", rule: 0, text: "Declined under rule 0: an input has no certified value, so no stance is stated.", reasons: [{ cites: "bear_case", text: "Bear case: Annual growth must be above -100%." }] });
  assert.equal(call.assumptions[4]!.figure.text, "Growth 4.24% a year at 17.33x: base value USD 165.86 per share");
  assert.equal(baseRate({ ...AAPL, base_rates: withFcf((points) => points.map((point, index) => index < 120 ? q("-1") : point)) }).figure.kind, "value");
  const both = assembleCall({ ...AAPL, base_rates: withFcf((points) => points.map((point, index) => index < 220 ? q("-1") : point)) });
  assert.deepEqual(both.stance.reasons, [{ cites: "base_case", text: "Base case: Annual growth must be above -100%." }, { cites: "bear_case", text: "Bear case: Annual growth must be above -100%." }]);
});

const priced = (price: string, settings: Partial<CallEvidence["settings"]> = {}) =>
  assembleCall({ ...AAPL, settings: { ...DEFAULT_CALL_SETTINGS, ...settings }, figures: { ...AAPL.figures, share_price: { kind: "value", value: price, currency: "USD" } } });

test("at USD 50 AAPL clears your hurdle: today's multiple 4.92x is the anchored exit multiple, and every move keeps the price under H", () => {
  const call = priced("50");
  assert.equal(call.assumptions[2]!.figure.text, "4.92x");
  assert.deepEqual([call.stance.kind, call.stance.rule, call.stance.text], ["stated", 4, "Clears your hurdle."]);
  assert.match(call.stance.reasons[2]!.text, /^The hurdle price H is USD \d+\.\d\d, the lower of the two\. The price, USD 50\.00, is at or below H\.$/u);
});

test("at USD 150 with a 50% near band AAPL is near your hurdle; at the default 10% band the same price falls short", () => {
  const near = priced("150", { near_band: "0.5" });
  assert.deepEqual([near.stance.kind, near.stance.rule, near.stance.text], ["stated", 5, "Near your hurdle."]);
  assert.equal(near.stance.reasons[2]!.text, "The hurdle price H is USD 122.92, the lower of the two. The price, USD 150.00, is above H and at or below H × (1 + your 50% near band) = USD 184.38.");
  assert.deepEqual([priced("150").stance.rule, priced("150").stance.text], [6, "Falls short of your hurdle."]);
});

test("rule 2: net debt that leaves the bear value at or below zero declines, naming B and no hurdle price", () => {
  const call = assembleCall({ ...AAPL, figures: { ...AAPL.figures, net_cash: { kind: "value", value: "-2000000000000", currency: "USD" } } });
  assert.deepEqual(call.stance, {
    kind: "declined",
    rule: 2,
    text: "Declined under rule 2: the base or bear value per share is zero or negative, so there is no positive hurdle price and no stance is stated.",
    reasons: [{ cites: "bear_case", text: "The bear value B is USD -29.81 per share." }],
  });
});

test("rule 3: at USD 100 a move changes the stance, so it declines naming the move and shows no hurdle price", () => {
  const call = priced("100");
  assert.deepEqual(call.stance, {
    kind: "declined",
    rule: 3,
    text: "Declined under rule 3: a one-point move in growth, the share change or your required return, or a 1x move in the exit multiple, changes the stance, so no stance is stated.",
    reasons: [
      { cites: "base_case", text: "Growth one point lower in the base and bear cases together changes the stance." },
      { cites: "share_change", text: "The share change one point higher in both cases changes the stance." },
      { cites: "required_return", text: "Your required return one point higher changes the stance." },
      { cites: "anchored_exit_multiple", text: "The exit multiple 1x lower in both cases changes the stance." },
    ],
  });
  assert.equal(STANCE_WORDS.test(JSON.stringify(call)), false, "a declined Call says no stance wording");
});
