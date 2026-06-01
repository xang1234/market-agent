import assert from "node:assert/strict";
import test from "node:test";

import {
  commodityDecisionRoute,
  type CommodityDecisionAdapters,
} from "../src/decision-api.ts";
import { normalizeBalanceSnapshot } from "../../balances/src/balance-snapshot.ts";
import { buildDailyCallDraft } from "../../briefs/src/daily-call.ts";
import { normalizeImpactDriver } from "../../impact/src/event-impact.ts";

const COMMODITY_ID = "33333333-3333-4333-8333-333333333333";
const SNAPSHOT_ID = "66666666-6666-4666-8666-666666666666";
const BRIEF_ID = "77777777-7777-4777-8777-777777777777";
const SOURCE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const EVENT_ID = "99999999-9999-4999-8999-999999999999";
const CLAIM_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const AS_OF = "2026-05-31T00:00:00.000Z";

test("commodityDecisionRoute owns public balance, impact, and brief routes outside dev-api", () => {
  const adapters = fakeDecisionAdapters();

  assert.deepEqual(
    commodityDecisionRoute(adapters, "GET", "/v1/balances/snapshot"),
    { status: 200, body: { snapshot: adapters.balances.snapshot() } },
  );
  assert.deepEqual(
    commodityDecisionRoute(adapters, "GET", "/v1/balances/changes"),
    { status: 200, body: { changes: adapters.balances.changes() } },
  );
  assert.deepEqual(
    commodityDecisionRoute(adapters, "GET", "/v1/impact/events"),
    { status: 200, body: { events: adapters.impact.events() } },
  );
  assert.deepEqual(
    commodityDecisionRoute(adapters, "GET", "/v1/impact/drivers"),
    { status: 200, body: { drivers: adapters.impact.drivers() } },
  );
  assert.deepEqual(
    commodityDecisionRoute(adapters, "GET", "/v1/impact/graph"),
    { status: 200, body: adapters.impact.graph() },
  );
  assert.deepEqual(
    commodityDecisionRoute(adapters, "GET", "/v1/briefs/daily"),
    { status: 200, body: { brief: adapters.briefs.daily() } },
  );
  assert.deepEqual(
    commodityDecisionRoute(adapters, "GET", `/v1/briefs/${BRIEF_ID}`),
    { status: 200, body: { brief: adapters.briefs.get(BRIEF_ID) } },
  );
  assert.deepEqual(
    commodityDecisionRoute(adapters, "POST", `/v1/briefs/${BRIEF_ID}/publish`),
    { status: 200, body: { brief: adapters.briefs.publish(BRIEF_ID) } },
  );
  assert.deepEqual(
    commodityDecisionRoute(adapters, "GET", `/v1/briefs/${BRIEF_ID}/outcomes`),
    { status: 200, body: { brief_id: BRIEF_ID, outcomes: adapters.briefs.outcomes(BRIEF_ID) } },
  );
  assert.deepEqual(
    commodityDecisionRoute(adapters, "GET", "/v1/briefs/not-a-uuid"),
    { status: 404, body: { error: "brief not found" } },
  );
  assert.equal(commodityDecisionRoute(adapters, "POST", "/v1/balances/snapshot"), null);
});

function fakeDecisionAdapters(): CommodityDecisionAdapters {
  const commodityRef = Object.freeze({ kind: "commodity" as const, id: COMMODITY_ID });
  const snapshot = normalizeBalanceSnapshot({
    commodity_ref: commodityRef,
    as_of: AS_OF,
    unit: "kt",
    source_refs: [SOURCE_ID],
    components: [{
      channel: "inventory",
      label: "Exchange inventory",
      value: 141,
      delta: -3,
      horizon: "1w",
      confidence: 0.8,
    }],
  });
  const driver = normalizeImpactDriver({
    driver_id: "copper-inventory-draw",
    subject_refs: [commodityRef],
    event_refs: [EVENT_ID],
    claim_refs: [CLAIM_ID],
    channel: "inventory",
    direction: "positive",
    horizon: "1w",
    driver_type: "inventory_change",
    confidence: 0.78,
    magnitude: 0.64,
    summary: "Inventory draw supports nearby copper.",
  });
  const brief = buildDailyCallDraft({
    brief_id: BRIEF_ID,
    snapshot_id: SNAPSHOT_ID,
    as_of: AS_OF,
    commodity_refs: [commodityRef],
    narrative: "Copper call is constructive.",
    driver_ids: [driver.driver_id],
    watch_items: [],
  });

  return {
    balances: {
      snapshot: () => snapshot,
      changes: () => Object.freeze([]),
    },
    impact: {
      events: () => Object.freeze([]),
      drivers: () => Object.freeze([driver]),
      graph: () => Object.freeze({
        nodes: Object.freeze([]),
        edges: Object.freeze([]),
      }),
    },
    briefs: {
      daily: () => brief,
      get: (briefId) => briefId === BRIEF_ID ? brief : null,
      publish: (briefId) => briefId === BRIEF_ID ? brief : null,
      outcomes: (briefId) => briefId === BRIEF_ID ? Object.freeze([]) : null,
    },
  };
}
