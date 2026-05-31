import assert from "node:assert/strict";
import test from "node:test";

import {
  IMPACT_CHANNELS,
  IMPACT_DIRECTIONS,
  IMPACT_DRIVER_TYPES,
  IMPACT_HORIZONS,
} from "../src/impact-vocabulary.ts";

test("impact vocabulary centralizes channels, directions, driver types, and horizons", () => {
  assert.deepEqual(IMPACT_CHANNELS, [
    "supply",
    "demand",
    "inventory",
    "curve_structure",
    "freight",
    "policy",
    "macro_fx",
    "weather",
    "disruption",
  ]);
  assert.deepEqual(IMPACT_DIRECTIONS, ["positive", "negative", "mixed", "unknown"]);
  assert.deepEqual(IMPACT_DRIVER_TYPES, [
    "price_move",
    "report_delta",
    "news_event",
    "inventory_change",
    "forecast_change",
    "internal_note",
  ]);
  assert.deepEqual(IMPACT_HORIZONS, ["1d", "1w", "1m", "3m"]);
});
