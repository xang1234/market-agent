import assert from "node:assert/strict";
import test from "node:test";
import { sourceClassOf } from "../../financial-core/src/index.ts";
import { SEC_EDGAR_FILING_SOURCE_ID } from "../../fundamentals/src/provider-sources.ts";
import { POLYGON_MARKET_SOURCE_ID, STOOQ_MARKET_SOURCE_ID, YAHOO_FINANCE_DEV_MARKET_SOURCE_ID } from "../../market/src/provider-sources.ts";
import type { PriceObservation, SplitHistory } from "../src/ports.ts";
import { selectPrice } from "../src/select-price.ts";

const LISTING = "4f000000-0000-4000-8000-0000000004e1";
const HISTORY: Extract<SplitHistory, { status: "ok" }> = {
  status: "ok",
  listing_id: LISTING,
  timezone: "America/New_York",
  checked_at: "2024-06-10T12:00:00.000Z",
  // NVDA's 2024-06-10 split as Polygon lists it: each share became ten.
  splits: [{ execution_date: "2024-06-10", split_from: "1", split_to: "10" }],
};
// 10:00 on Monday 2024-06-10 in New York: the split has executed, Monday's session has not closed.
const CUTOFF = "2024-06-10T14:00:00.000Z";
const POLICY = { knowledge_cutoff: CUTOFF, allowed_source_classes: ["market_data" as const] };

let counter = 0;
function observation(price: string, observedAt: string, overrides: Partial<PriceObservation> = {}): PriceObservation {
  counter += 1;
  return {
    observation_id: `4f000000-0000-4000-8000-${String(counter).padStart(12, "0")}`,
    listing_id: LISTING,
    source_id: "00000000-0000-4000-a000-000000000009",
    source_class: "market_data",
    kind: "session_close",
    price_text: price,
    currency: "USD",
    observed_at: observedAt,
    known_at: observedAt,
    body_sha256: "d".repeat(64),
    ...overrides,
  };
}

const page = (latest: PriceObservation[], unknown_publication = false) => ({ status: "ok" as const, latest, unknown_publication });
const reason = (selection: ReturnType<typeof selectPrice>) => (selection.status === "gap" ? selection.reason_code : "selected");

test("Friday's 1200.00 close binds as 120 on Monday, after the split, with its lineage", () => {
  const friday = observation("1200.00", "2024-06-07T20:00:00.000Z", { known_at: "2024-06-07T20:15:00.000Z" });
  const selection = selectPrice(page([friday]), HISTORY, POLICY);
  assert.ok(selection.status === "selected");
  assert.deepEqual([selection.observation.price_text, selection.value], ["1200.00", "1200"]);
  assert.deepEqual(selection.split_adjustment, {
    version: "split_adjustment.v2",
    as_filed_on: "2024-06-07",
    reference_date: "2024-06-10",
    listing_id: LISTING,
    listing_timezone: "America/New_York",
    splits: [{ execution_date: "2024-06-10", split_from: "1", split_to: "10" }],
    factor: { numerator: "10", denominator: "1" },
    adjusted_native_value: { numerator: "120", denominator: "1" },
  });
});

test("a price traded on the split's date is already on its basis and binds unchanged", () => {
  const monday = observation("120.50", "2024-06-10T13:45:00.000Z", { kind: "last_trade" });
  const selection = selectPrice(page([monday]), HISTORY, POLICY);
  assert.ok(selection.status === "selected");
  assert.deepEqual([selection.value, selection.split_adjustment.as_filed_on, selection.split_adjustment.splits, selection.split_adjustment.adjusted_native_value],
    ["120.5", "2024-06-10", [], { numerator: "241", denominator: "2" }]);
});

test("equal latest prices tie-break by observation id; differing ones conflict", () => {
  const first = observation("120.50", "2024-06-10T13:45:00.000Z");
  const second = observation("120.5", "2024-06-10T13:45:00.000Z");
  const selection = selectPrice(page([second, first]), HISTORY, POLICY);
  assert.ok(selection.status === "selected");
  assert.deepEqual([selection.observation.observation_id, selection.value], [first.observation_id, "120.5"]);
  assert.equal(reason(selectPrice(page([first, observation("120.6", "2024-06-10T13:45:00.000Z")]), HISTORY, POLICY)), "conflicting_evidence");
});

test("each reason a price cannot bind is a named gap", () => {
  assert.equal(reason(selectPrice(page([]), HISTORY, POLICY)), "missing_input");
  assert.equal(reason(selectPrice(page([], true), HISTORY, POLICY)), "publication_time_unknown");
  // A token longer than any source token may be is not an exact source token.
  assert.equal(reason(selectPrice(page([observation(`1${"0".repeat(299)}`, "2024-06-07T20:00:00.000Z")]), HISTORY, POLICY)), "precision_unverified");
  // Thursday's close, when Friday's session is the last one closed.
  assert.equal(reason(selectPrice(page([observation("1190", "2024-06-06T20:00:00.000Z")]), HISTORY, POLICY)), "stale_input");
  // Splits fetched on Sunday, before Monday's reference date.
  assert.equal(reason(selectPrice(page([observation("1200", "2024-06-07T20:00:00.000Z")]), { ...HISTORY, checked_at: "2024-06-09T16:00:00.000Z" }, POLICY)), "split_history_stale");
  const twoOnOneDay = [...HISTORY.splits, { execution_date: "2024-06-10", split_from: "1", split_to: "2" }];
  assert.equal(reason(selectPrice(page([observation("1200", "2024-06-07T20:00:00.000Z")]), { ...HISTORY, splits: twoOnOneDay }, POLICY)), "incompatible_basis");
});

test("a price is market data only from an approved provider, and a fact is an SEC filing only from a filing (#444)", () => {
  const price = (source_id: string, kind = "market_data") => sourceClassOf({ kind, source_id }, "price");
  const fact = (source_id: string, kind: string) => sourceClassOf({ kind, source_id }, "fact");
  assert.deepEqual(
    [price(POLYGON_MARKET_SOURCE_ID), price(STOOQ_MARKET_SOURCE_ID), price(YAHOO_FINANCE_DEV_MARKET_SOURCE_ID), price("00000000-0000-4000-a000-000000000013")],
    ["market_data", null, null, null],
  );
  assert.deepEqual(
    [fact(SEC_EDGAR_FILING_SOURCE_ID, "filing"), price(SEC_EDGAR_FILING_SOURCE_ID, "filing"), fact(POLYGON_MARKET_SOURCE_ID, "market_data")],
    ["sec_filing", null, null],
  );
});

test("a price binds only from a source class the authority allows (#444)", () => {
  const unclassed = observation("1200.00", "2024-06-07T20:00:00.000Z", { source_class: null });
  const friday = observation("1200.00", "2024-06-07T20:00:00.000Z");
  assert.equal(reason(selectPrice(page([friday]), HISTORY, { ...POLICY, allowed_source_classes: ["sec_filing"] })), "source_class_not_allowed");
  assert.equal(reason(selectPrice(page([unclassed]), HISTORY, POLICY)), "source_class_not_allowed");
  // Of the newest trade's observations, only an allowed one binds, though the other has the lower id.
  const selection = selectPrice(page([unclassed, friday]), HISTORY, POLICY);
  assert.equal(selection.status === "selected" && selection.observation.observation_id, friday.observation_id);
});
