import assert from "node:assert/strict";
import test from "node:test";

import {
  BALANCE_CHANNELS,
  normalizeBalanceSnapshot,
} from "../src/balance-snapshot.ts";

const SOURCE_ID = "11111111-1111-4111-9111-111111111111";
const COMMODITY_ID = "22222222-2222-4222-9222-222222222222";

test("normalizeBalanceSnapshot preserves copper and iron ore supply-demand components", () => {
  assert.deepEqual(BALANCE_CHANNELS, [
    "mine_supply",
    "disruption",
    "inventory",
    "port_stock",
    "smelter_margin",
    "steel_margin",
    "trade_flow",
    "freight",
    "house_forecast",
  ]);

  const snapshot = normalizeBalanceSnapshot({
    commodity_ref: { kind: "commodity", id: COMMODITY_ID },
    as_of: "2026-05-31T00:00:00.000Z",
    unit: "kt",
    source_refs: [SOURCE_ID],
    components: [
      {
        channel: "mine_supply",
        label: "Chile mine output",
        value: 420,
        delta: -18,
        horizon: "1m",
        confidence: 0.82,
      },
      {
        channel: "inventory",
        label: "Exchange stocks",
        value: 112,
        delta: 9,
        horizon: "1w",
        confidence: 0.9,
      },
    ],
  });

  assert.equal(snapshot.net_delta, -9);
  assert.equal(snapshot.components[0].channel, "mine_supply");
  assert.equal(Object.isFrozen(snapshot.components), true);
  assert.equal(Object.isFrozen(snapshot), true);
});
