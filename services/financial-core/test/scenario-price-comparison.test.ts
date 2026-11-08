// A sealed P/E scenario set against one stored close (#224): the oracle, the
// rounding, each named gap, and the time a request means.

import assert from "node:assert/strict";
import test from "node:test";
import {
  COMPARISON_GAPS,
  COMPARISON_NOTE,
  compareScenarioToPrice,
  comparisonWindow,
  type ComparisonContent,
  type ComparisonGap,
  type ComparisonInput,
  type StoredClose,
} from "../src/index.ts";

const LISTING = "5f000000-0000-4000-8000-0000000003e1";
const POLYGON = "00000000-0000-4000-a000-000000000009";
const RECEIVED = "2024-06-10T14:00:00.000Z";
// The US regular close on an EDT date, 16:00 New York.
const closeAt = (date: string) => `${date}T20:00:00.000Z`;

const CLOSE: StoredClose = {
  observation_id: "5f000000-0000-4000-8000-0000000003d1",
  listing_id: LISTING,
  source_id: POLYGON,
  body_sha256: "d".repeat(64),
  kind: "session_close",
  price_text: "100.00",
  currency: "USD",
  observed_at: "2024-06-07T20:00:00.000Z",
  known_at: "2024-06-07T20:15:00.000Z",
  fetched_at: "2024-06-07T20:15:00.000Z",
  adjustment_basis: "unadjusted",
  source_kind: "market_data",
  source_name: "polygon_market",
};

function input(change: Partial<ComparisonInput> = {}, values: [string, string, string] = ["80", "100", "120"]): ComparisonInput {
  return {
    scenario: {
      ref: { snapshot_id: "6f000000-0000-4000-8000-0000000000f1", run_id: "6f000000-0000-4000-8000-0000000000a1", unit_id: "chat_unit", presentation_hash: "e".repeat(64) },
      rows: (["bear", "base", "bull"] as const).map((scenario, index) => ({
        scenario,
        result_id: `6f000000-0000-4000-8000-00000000010${index}`,
        multiple_text: `${20 + 5 * index}x`,
        value: { value: values[index]!, currency: "USD" },
      })),
      available: true,
      eps_publication: { available_no_later_than: "2024-02-21T23:59:59.999-05:00", timing_precision: "date", source_timezone: "America/New_York" },
      eps_anchor: { listing_id: LISTING, reference_date: "2024-06-10" },
      allowed_source_classes: ["sec_filing", "market_data"],
    },
    requested: { kind: "latest" },
    received_at: RECEIVED,
    listing: { listing_id: LISTING, ticker: "SCEN", timezone: "America/New_York", session_close_at: closeAt },
    closes: { candidates: [CLOSE], unknown_publication: false },
    splits: { checked_at: "2024-06-10T12:00:00.000Z", splits: [] },
    ...change,
  };
}

function rows(content: ComparisonContent) {
  assert.equal(content.outcome.kind, "comparison", JSON.stringify(content.outcome));
  return content.outcome.kind === "comparison" ? content.outcome.rows : [];
}

const gapOf = (content: ComparisonContent) => (content.outcome.kind === "gap" ? content.outcome.reason : null);
const withClose = (change: Partial<StoredClose>): Partial<ComparisonInput> => ({ closes: { candidates: [{ ...CLOSE, ...change }], unknown_publication: false } });

test("scenario values 80, 100 and 120 against a USD close of 100 differ by -20, 0 and +20 per share: -20.00%, 0.00% and +20.00%", () => {
  const content = compareScenarioToPrice(input());
  assert.deepEqual(rows(content).map((row) => [row.scenario, row.scenario_value.text, row.difference.text, row.difference.full_text, row.percent.text, row.percent.full_text, row.percent.value, row.percent.exact]), [
    ["bear", "USD 80.00 per share", "USD -20.00 per share", "USD -20 per share", "-20.00%", "-20%", "-0.2", true],
    ["base", "USD 100.00 per share", "USD 0.00 per share", "USD 0 per share", "0.00%", "0%", "0", true],
    ["bull", "USD 120.00 per share", "USD +20.00 per share", "USD +20 per share", "+20.00%", "+20%", "0.2", true],
  ]);
});

test("the price shows its observation, session, times, source version, listing, currency and basis", () => {
  const content = compareScenarioToPrice(input());
  assert.equal(content.outcome.kind, "comparison");
  if (content.outcome.kind !== "comparison") return;
  assert.deepEqual(content.outcome.price, {
    observation_id: CLOSE.observation_id,
    kind: "session_close",
    listing_id: LISTING,
    ticker: "SCEN",
    currency: "USD",
    session_date: "2024-06-07",
    observed_at: "2024-06-07T20:00:00.000Z",
    known_at: "2024-06-07T20:15:00.000Z",
    fetched_at: "2024-06-07T20:15:00.000Z",
    source_id: POLYGON,
    source_name: "polygon_market",
    body_sha256: "d".repeat(64),
    adjustment_basis: "unadjusted",
    heading: "Latest stored completed close: 2024-06-07",
    price: { value: "100", text: "USD 100.00 per share", full_text: "USD 100 per share" },
  });
  assert.deepEqual(content.outcome.basis, {
    eps_reference_date: "2024-06-10",
    price_session_date: "2024-06-07",
    split_history_checked_at: "2024-06-10T12:00:00.000Z",
    split_factor: "1",
    text: "Same share basis: the EPS is on the split basis of 2024-06-10 and the price on that of 2024-06-07, and SCEN's split history, checked 2024-06-10, has no split between them.",
  });
  assert.deepEqual(content.cutoff, { at: RECEIVED, inclusive: true, text: "The latest stored completed close known when you asked (2024-06-10 14:00 UTC)" });
  assert.equal(content.note, COMPARISON_NOTE);
});

test("display rounds half-even to two places from exact values; a repeating quotient keeps its policy digits", () => {
  const tie = rows(compareScenarioToPrice(input({}, ["100.125", "100.135", "100"])));
  assert.deepEqual(tie.map((row) => [row.difference.text, row.difference.value, row.percent.text, row.percent.value]), [
    ["USD +0.12 per share", "0.125", "+0.12%", "0.00125"],
    ["USD +0.14 per share", "0.135", "+0.14%", "0.00135"],
    ["USD 0.00 per share", "0", "0.00%", "0"],
  ]);
  const thirds = rows(compareScenarioToPrice({ ...input({}, ["100", "1", "3"]), ...withClose({ price_text: "3" }) }));
  assert.deepEqual(thirds.map((row) => [row.percent.text, row.percent.exact]), [["+3,233.33%", false], ["-66.67%", false], ["0.00%", true]]);
  assert.equal(thirds[0]!.percent.value, "32.333333333333333333333333333333333333333333333333");
});

test("display rounds from the exact value, never from one already rounded to the policy's digits", () => {
  // 99.995 less 10^-57: the difference from 100 is just over half a cent, beyond fifty significant digits.
  const [row] = rows(compareScenarioToPrice({ ...input({}, ["100", "100", "100"]), ...withClose({ price_text: `99.994${"9".repeat(54)}` }) }));
  assert.equal(row!.difference.text, "USD +0.01 per share");
  assert.equal(row!.difference.value, `0.005${"0".repeat(53)}1`, "the difference of two exact decimals is exact");
  assert.equal(row!.difference.full_text, `USD +0.005${"0".repeat(53)}1 per share`);
});

test("the price names its source by the name stored for it, beside its id and body hash", () => {
  const content = compareScenarioToPrice(input());
  assert.ok(content.outcome.kind === "comparison");
  assert.deepEqual([content.outcome.price.source_name, content.outcome.price.source_id, content.outcome.price.body_sha256], ["polygon_market", POLYGON, "d".repeat(64)]);
});

test("the cutoff names seconds, and milliseconds, when the time asked for has them", () => {
  assert.equal(compareScenarioToPrice(input({ requested: { kind: "instant", at: "2024-06-07T20:15:30.000Z" } })).cutoff?.text, "The latest stored completed close known at or before 2024-06-07 20:15:30 UTC");
  assert.equal(compareScenarioToPrice(input({ requested: { kind: "instant", at: "2024-06-07T20:15:00.250Z" } })).cutoff?.text, "The latest stored completed close known at or before 2024-06-07 20:15:00.250 UTC");
  assert.equal(compareScenarioToPrice(input({ requested: { kind: "instant", at: "2024-06-07T20:15:00.000Z" } })).cutoff?.text, "The latest stored completed close known at or before 2024-06-07 20:15 UTC");
});

test("each reason a comparison is not shown is a named gap with its fixed text", () => {
  const cases: Array<[ComparisonGap, Partial<ComparisonInput> | ((base: ComparisonInput) => ComparisonInput)]> = [
    ["scenario_unavailable", (base) => ({ ...base, scenario: { ...base.scenario, available: false } })],
    ["scenario_unavailable", (base) => ({ ...base, scenario: { ...base.scenario, rows: base.scenario.rows.map((row, index) => (index === 1 ? { ...row, value: null } : row)) } })],
    ["incompatible_basis", (base) => ({ ...base, scenario: { ...base.scenario, eps_anchor: null } })],
    ["incompatible_basis", { listing: null }],
    ["incompatible_basis", (base) => ({ ...base, scenario: { ...base.scenario, eps_anchor: { listing_id: CLOSE.observation_id, reference_date: "2024-06-10" } } })],
    ["incompatible_basis", withClose({ adjustment_basis: "split_adjusted" })],
    ["incompatible_basis", { splits: { checked_at: "2024-06-10T12:00:00.000Z", splits: [{ execution_date: "2024-06-10", split_from: "1", split_to: "10" }] } }],
    ["requested_time_after_question", { requested: { kind: "instant", at: "2024-06-10T14:00:00.001Z" } }],
    ["requested_time_after_question", { requested: { kind: "session_date", date: "2024-06-11" } }],
    ["scenario_not_public_at_cutoff", { requested: { kind: "session_date", date: "2024-02-20" } }],
    ["scenario_not_public_at_cutoff", (base) => ({ ...base, scenario: { ...base.scenario, eps_publication: { ...base.scenario.eps_publication, source_timezone: "Not/A_Zone" } } })],
    ["price_coverage_missing", { closes: { candidates: [], unknown_publication: false } }],
    ["publication_time_unknown", { closes: { candidates: [], unknown_publication: true } }],
    ["publication_time_unknown", withClose({ known_at: null })],
    ["publication_time_unknown", withClose({ known_at: "2024-06-10T14:00:00.001Z", fetched_at: "2024-06-10T14:00:00.001Z" })],
    ["conflicting_evidence", { closes: { candidates: [CLOSE, { ...CLOSE, observation_id: "5f000000-0000-4000-8000-0000000003d2", body_sha256: "c".repeat(64), price_text: "100.01" }], unknown_publication: false } }],
    ["session_incomplete", withClose({ observed_at: "2024-06-07T19:00:00.000Z" })],
    ["session_incomplete", withClose({ kind: "last_trade" })],
    ["session_incomplete", withClose({ observed_at: closeAt("2024-06-08"), known_at: "2024-06-08T20:15:00.000Z", fetched_at: "2024-06-08T20:15:00.000Z" })],
    ["publication_time_unknown", withClose({ known_at: "2024-06-07T19:59:59.999Z" })],
    ["session_policy_unsupported", (base) => ({ ...base, listing: { ...base.listing!, session_close_at: () => null } })],
    ["incompatible_currency", withClose({ currency: "EUR" })],
    ["split_history_missing", { splits: null }],
    ["split_history_stale", { splits: { checked_at: "2024-06-05T12:00:00.000Z", splits: [] } }],
    ["zero_denominator", withClose({ price_text: "0" })],
    ["non_positive_denominator", withClose({ price_text: "-1" })],
    ["price_timestamp_missing", withClose({ observed_at: null })],
    ["price_timestamp_invalid", withClose({ observed_at: "not a time" })],
    ["precision_unverified", withClose({ price_text: "100,00" })],
    ["source_class_not_allowed", withClose({ source_id: LISTING })],
    ["source_class_not_allowed", withClose({ source_kind: "article" })],
    ["source_class_not_allowed", (base) => ({ ...base, scenario: { ...base.scenario, allowed_source_classes: ["sec_filing"] } })],
  ];
  for (const [reason, change] of cases) {
    const base = input();
    const content = compareScenarioToPrice(typeof change === "function" ? change(base) : input(change));
    assert.deepEqual(content.outcome, { kind: "gap", reason, text: COMPARISON_GAPS[reason] }, `${reason}: ${JSON.stringify(change)}`);
  }
  assert.deepEqual(new Set(cases.map(([reason]) => reason)), new Set(Object.keys(COMPARISON_GAPS)), "every gap is reached");
});

test("a split before the EPS's reference date, but after the price's session, is a different share basis either way round", () => {
  const split = { checked_at: "2024-06-20T12:00:00.000Z", splits: [{ execution_date: "2024-06-14", split_from: "1", split_to: "2" }] };
  const later = { ...CLOSE, observed_at: "2024-06-17T20:00:00.000Z", known_at: "2024-06-17T20:15:00.000Z", fetched_at: "2024-06-17T20:15:00.000Z" };
  assert.equal(gapOf(compareScenarioToPrice(input({ splits: split, received_at: "2024-06-18T14:00:00.000Z", closes: { candidates: [later], unknown_publication: false } }))), "incompatible_basis");
  // A split and its reverse between the dates leave the basis as it was.
  const roundTrip = { checked_at: "2024-06-20T12:00:00.000Z", splits: [...split.splits, { execution_date: "2024-06-17", split_from: "2", split_to: "1" }] };
  assert.equal(gapOf(compareScenarioToPrice(input({ splits: roundTrip, received_at: "2024-06-18T14:00:00.000Z", closes: { candidates: [later], unknown_publication: false } }))), null);
});

test("of each source's newest close the newest decides, the lowest id among agreeing ones; only kind session_close is ever shown", () => {
  const older = { ...CLOSE, observation_id: "5f000000-0000-4000-8000-0000000003d0", observed_at: "2024-06-06T20:00:00.000Z", price_text: "90" };
  const twin = { ...CLOSE, observation_id: "5f000000-0000-4000-8000-0000000003d9", body_sha256: "c".repeat(64), price_text: "100.0" };
  const content = compareScenarioToPrice(input({ closes: { candidates: [twin, older, CLOSE], unknown_publication: true } }));
  assert.equal(content.outcome.kind === "comparison" && content.outcome.price.observation_id, CLOSE.observation_id);
});

test("a close is admitted only from a source whose price class the scenario's run allows: another source's newer close never hides it", () => {
  const dev = { ...CLOSE, observation_id: "5f000000-0000-4000-8000-0000000003d8", source_id: LISTING, observed_at: "2024-06-10T20:00:00.000Z", price_text: "130" };
  const content = compareScenarioToPrice(input({ closes: { candidates: [dev, CLOSE], unknown_publication: false } }));
  assert.equal(content.outcome.kind === "comparison" && content.outcome.price.observation_id, CLOSE.observation_id);
});

test("times keep the database's microseconds: a close a microsecond past its session's close, or known a microsecond past the cutoff, is not used", () => {
  assert.equal(gapOf(compareScenarioToPrice(input(withClose({ observed_at: "2024-06-07T20:00:00.000001Z" })))), "session_incomplete");
  assert.equal(gapOf(compareScenarioToPrice(input(withClose({ known_at: "2024-06-10T14:00:00.000001Z", fetched_at: "2024-06-10T14:00:00.000001Z" })))), "publication_time_unknown");
  const exact = compareScenarioToPrice(input(withClose({ observed_at: "2024-06-07T20:00:00.000000Z", known_at: "2024-06-07T20:15:00.123456Z", fetched_at: "2024-06-07T20:15:00.654321Z" })));
  assert.deepEqual(exact.outcome.kind === "comparison" && [exact.outcome.price.observed_at, exact.outcome.price.known_at, exact.outcome.price.fetched_at],
    ["2024-06-07T20:00:00.000Z", "2024-06-07T20:15:00.123456Z", "2024-06-07T20:15:00.654321Z"]);
  assert.equal(gapOf(compareScenarioToPrice(input(withClose({ fetched_at: "2024-06-07T20:15:00.1234567Z" })))), "price_timestamp_invalid", "finer than the database keeps");
});

test("a date means the whole of it on the listing's calendar, to the next local midnight exclusive, and never past the question", () => {
  const zone = "America/New_York";
  assert.deepEqual(comparisonWindow({ kind: "session_date", date: "2024-06-07" }, RECEIVED, zone), { at: "2024-06-08T04:00:00.000Z", inclusive: false });
  assert.deepEqual(comparisonWindow({ kind: "session_date", date: "2024-03-09" }, RECEIVED, zone), { at: "2024-03-10T05:00:00.000Z", inclusive: false }, "the day before DST starts");
  assert.deepEqual(comparisonWindow({ kind: "session_date", date: "2024-03-10" }, RECEIVED, zone), { at: "2024-03-11T04:00:00.000Z", inclusive: false }, "the day DST starts");
  assert.deepEqual(comparisonWindow({ kind: "session_date", date: "2024-06-10" }, RECEIVED, zone), { at: RECEIVED, inclusive: true }, "today runs to the question");
  assert.equal(comparisonWindow({ kind: "session_date", date: "2024-06-11" }, RECEIVED, zone), "future");
  assert.deepEqual(comparisonWindow({ kind: "instant", at: "2024-06-07T20:15:00.000Z" }, RECEIVED, zone), { at: "2024-06-07T20:15:00.000Z", inclusive: true });
  const dated = compareScenarioToPrice(input({ requested: { kind: "session_date", date: "2024-06-07" } }));
  assert.equal(dated.outcome.kind === "comparison" && dated.outcome.price.heading, "Stored completed close: 2024-06-07");
  assert.equal(dated.cutoff?.text, "The latest stored completed close known through the end of 2024-06-07 (America/New_York)");
});

test("no generated string uses return, target or advice wording beyond the fixed note", () => {
  const ADVICE = /\b(?:upside|downside|targets?|expected|returns?|undervalued|overvalued|fair value|buy|sell|forecasts?|recommend\w*|cheap|expensive|potential)\b/iu;
  const strings = (value: unknown): string[] =>
    typeof value === "string" ? [value] : Array.isArray(value) ? value.flatMap(strings) : value !== null && typeof value === "object" ? Object.entries(value).flatMap(([key, entry]) => (key === "note" ? [] : strings(entry))) : [];
  const outputs = [
    compareScenarioToPrice(input()),
    compareScenarioToPrice(input({ requested: { kind: "session_date", date: "2024-06-07" } })),
    compareScenarioToPrice(input({ requested: { kind: "instant", at: "2024-06-07T20:15:00.000Z" } })),
  ];
  for (const text of [...outputs.flatMap(strings), ...Object.values(COMPARISON_GAPS)]) assert.doesNotMatch(text, ADVICE, text);
  for (const output of outputs) assert.equal(output.note, COMPARISON_NOTE);
});
