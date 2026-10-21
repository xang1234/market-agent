import assert from "node:assert/strict";
import test from "node:test";
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

let counter = 0;
function observation(price: string, observedAt: string, overrides: Partial<PriceObservation> = {}): PriceObservation {
  counter += 1;
  return {
    observation_id: `4f000000-0000-4000-8000-${String(counter).padStart(12, "0")}`,
    listing_id: LISTING,
    source_id: "00000000-0000-4000-a000-000000000009",
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
  const selection = selectPrice(page([friday]), HISTORY, CUTOFF);
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
  const selection = selectPrice(page([monday]), HISTORY, CUTOFF);
  assert.ok(selection.status === "selected");
  assert.deepEqual([selection.value, selection.split_adjustment.as_filed_on, selection.split_adjustment.splits, selection.split_adjustment.adjusted_native_value],
    ["120.5", "2024-06-10", [], { numerator: "241", denominator: "2" }]);
});

test("equal latest prices tie-break by observation id; differing ones conflict", () => {
  const first = observation("120.50", "2024-06-10T13:45:00.000Z");
  const second = observation("120.5", "2024-06-10T13:45:00.000Z");
  const selection = selectPrice(page([second, first]), HISTORY, CUTOFF);
  assert.ok(selection.status === "selected");
  assert.deepEqual([selection.observation.observation_id, selection.value], [first.observation_id, "120.5"]);
  assert.equal(reason(selectPrice(page([first, observation("120.6", "2024-06-10T13:45:00.000Z")]), HISTORY, CUTOFF)), "conflicting_evidence");
});

test("each reason a price cannot bind is a named gap", () => {
  assert.equal(reason(selectPrice(page([]), HISTORY, CUTOFF)), "missing_input");
  assert.equal(reason(selectPrice(page([], true), HISTORY, CUTOFF)), "publication_time_unknown");
  // A token longer than any source token may be is not an exact source token.
  assert.equal(reason(selectPrice(page([observation(`1${"0".repeat(299)}`, "2024-06-07T20:00:00.000Z")]), HISTORY, CUTOFF)), "precision_unverified");
  // Thursday's close, when Friday's session is the last one closed.
  assert.equal(reason(selectPrice(page([observation("1190", "2024-06-06T20:00:00.000Z")]), HISTORY, CUTOFF)), "stale_input");
  // Splits fetched on Sunday, before Monday's reference date.
  assert.equal(reason(selectPrice(page([observation("1200", "2024-06-07T20:00:00.000Z")]), { ...HISTORY, checked_at: "2024-06-09T16:00:00.000Z" }, CUTOFF)), "split_history_stale");
  const twoOnOneDay = [...HISTORY.splits, { execution_date: "2024-06-10", split_from: "1", split_to: "2" }];
  assert.equal(reason(selectPrice(page([observation("1200", "2024-06-07T20:00:00.000Z")]), { ...HISTORY, splits: twoOnOneDay }, CUTOFF)), "incompatible_basis");
});
