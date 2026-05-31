import assert from "node:assert/strict";
import test from "node:test";

import {
  DRIVER_TYPES,
  IMPACT_CHANNELS,
  normalizeImpactDriver,
  rankImpactDrivers,
} from "../src/event-impact.ts";

const CLAIM_ID = "11111111-1111-4111-9111-111111111111";
const EVENT_ID = "22222222-2222-4222-9222-222222222222";
const COMMODITY_ID = "33333333-3333-4333-9333-333333333333";

test("impact drivers use commodity-specific channels, horizons, and driver types", () => {
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
  assert.deepEqual(DRIVER_TYPES, [
    "price_move",
    "report_delta",
    "news_event",
    "inventory_change",
    "forecast_change",
    "internal_note",
  ]);

  const driver = normalizeImpactDriver({
    driver_id: "driver-1",
    subject_refs: [{ kind: "commodity", id: COMMODITY_ID }],
    event_refs: [EVENT_ID],
    claim_refs: [CLAIM_ID],
    channel: "supply",
    direction: "negative",
    horizon: "1w",
    driver_type: "news_event",
    confidence: 0.88,
    magnitude: 0.7,
    summary: "Panama port disruption delays copper concentrate shipments.",
  });

  assert.equal(driver.priority_score, 0.79);
  assert.equal(Object.isFrozen(driver.subject_refs), true);
});

test("rankImpactDrivers sorts highest-priority drivers first", () => {
  const drivers = rankImpactDrivers([
    normalizeImpactDriver({
      driver_id: "slow",
      subject_refs: [{ kind: "commodity", id: COMMODITY_ID }],
      event_refs: [EVENT_ID],
      claim_refs: [CLAIM_ID],
      channel: "macro_fx",
      direction: "mixed",
      horizon: "3m",
      driver_type: "report_delta",
      confidence: 0.4,
      magnitude: 0.2,
      summary: "Longer-range USD pressure remains uncertain.",
    }),
    normalizeImpactDriver({
      driver_id: "fast",
      subject_refs: [{ kind: "commodity", id: COMMODITY_ID }],
      event_refs: [EVENT_ID],
      claim_refs: [CLAIM_ID],
      channel: "inventory",
      direction: "positive",
      horizon: "1d",
      driver_type: "inventory_change",
      confidence: 0.9,
      magnitude: 0.8,
      summary: "LME copper stocks drew sharply overnight.",
    }),
  ]);

  assert.deepEqual(drivers.map((driver) => driver.driver_id), ["fast", "slow"]);
});
