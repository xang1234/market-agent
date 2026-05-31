import { normalizeBalanceSnapshot } from "../../balances/src/balance-snapshot.ts";
import { buildDailyCallDraft, publishDailyCall } from "../../briefs/src/daily-call.ts";
import { normalizeImpactDriver, rankImpactDrivers } from "../../impact/src/event-impact.ts";
import { isUuid } from "../../shared/src/subject-ref.ts";

export type CommodityDecisionRouteResult = {
  status: number;
  body: Record<string, unknown>;
};

const AS_OF = "2026-05-31T00:00:00.000Z";
const COMMODITY_ID = "33333333-3333-4333-8333-333333333333";
const SNAPSHOT_ID = "66666666-6666-4666-8666-666666666666";
const BRIEF_ID = "77777777-7777-4777-8777-777777777777";
const REVIEWER_ID = "88888888-8888-4888-8888-888888888888";
const DRIVER_ID = "copper-disruption-tightness";
const EVENT_ID = "99999999-9999-4999-8999-999999999999";
const CLAIM_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SOURCE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const COMMODITY_REF = Object.freeze({ kind: "commodity" as const, id: COMMODITY_ID });

export function commodityDecisionRoute(method: string, pathname: string): CommodityDecisionRouteResult | null {
  if (method === "GET" && pathname === "/v1/balances/snapshot") {
    return ok({ snapshot: sampleBalanceSnapshot() });
  }
  if (method === "GET" && pathname === "/v1/balances/changes") {
    const snapshot = sampleBalanceSnapshot();
    return ok({
      changes: snapshot.components
        .filter((component) => Math.abs(component.delta) > 0)
        .map((component) => ({
          channel: component.channel,
          label: component.label,
          delta: component.delta,
          horizon: component.horizon,
          confidence: component.confidence,
        })),
    });
  }
  if (method === "GET" && pathname === "/v1/impact/events") {
    return ok({
      events: [
        {
          event_id: EVENT_ID,
          occurred_at: AS_OF,
          subject_refs: [COMMODITY_REF],
          source_refs: [SOURCE_ID],
          summary: "Copper concentrate shipment disruption tightened nearby cathode availability.",
        },
      ],
    });
  }
  if (method === "GET" && pathname === "/v1/impact/drivers") {
    return ok({ drivers: sampleDrivers() });
  }
  if (method === "GET" && pathname === "/v1/impact/graph") {
    return ok({
      nodes: [
        { id: EVENT_ID, kind: "event", label: "Shipment disruption" },
        { id: DRIVER_ID, kind: "driver", label: "Supply tightness" },
        { id: COMMODITY_ID, kind: "commodity", label: "Copper" },
      ],
      edges: [
        { from: EVENT_ID, to: DRIVER_ID, channel: "supply", direction: "positive" },
        { from: DRIVER_ID, to: COMMODITY_ID, horizon: "1w", confidence: 0.78 },
      ],
    });
  }
  if (method === "GET" && pathname === "/v1/briefs/daily") {
    return ok({ brief: sampleBrief() });
  }

  const briefMatch = pathname.match(/^\/v1\/briefs\/([^/]+)$/);
  if (method === "GET" && briefMatch) {
    if (!isUuid(briefMatch[1])) return { status: 404, body: { error: "brief not found" } };
    return ok({ brief: sampleBrief(briefMatch[1]) });
  }

  const publishMatch = pathname.match(/^\/v1\/briefs\/([^/]+)\/publish$/);
  if (method === "POST" && publishMatch) {
    if (!isUuid(publishMatch[1])) return { status: 404, body: { error: "brief not found" } };
    return ok({
      brief: publishDailyCall(sampleBrief(publishMatch[1]), {
        reviewer_user_id: REVIEWER_ID,
        published_at: AS_OF,
      }),
    });
  }

  const outcomesMatch = pathname.match(/^\/v1\/briefs\/([^/]+)\/outcomes$/);
  if (method === "GET" && outcomesMatch) {
    if (!isUuid(outcomesMatch[1])) return { status: 404, body: { error: "brief not found" } };
    return ok({
      brief_id: outcomesMatch[1],
      outcomes: [
        {
          horizon: "1w",
          observed_at: AS_OF,
          call_direction: "positive",
          realized_move: 0.012,
          notes: "Nearby copper held firm against the supply-tightness call.",
        },
      ],
    });
  }

  return null;
}

function sampleBalanceSnapshot() {
  return normalizeBalanceSnapshot({
    commodity_ref: COMMODITY_REF,
    as_of: AS_OF,
    unit: "kt",
    source_refs: [SOURCE_ID],
    components: [
      {
        channel: "mine_supply",
        label: "Mine disruptions",
        value: -45,
        delta: -12,
        horizon: "1w",
        confidence: 0.74,
      },
      {
        channel: "inventory",
        label: "Exchange inventory",
        value: 141,
        delta: -3,
        horizon: "1w",
        confidence: 0.8,
      },
    ],
  });
}

function sampleDrivers() {
  return rankImpactDrivers([
    normalizeImpactDriver({
      driver_id: DRIVER_ID,
      subject_refs: [COMMODITY_REF],
      event_refs: [EVENT_ID],
      claim_refs: [CLAIM_ID],
      channel: "supply",
      direction: "positive",
      horizon: "1w",
      driver_type: "news_event",
      confidence: 0.78,
      magnitude: 0.64,
      summary: "Disruption risk supports nearby copper while inventories draw.",
    }),
  ]);
}

function sampleBrief(briefId = BRIEF_ID) {
  return buildDailyCallDraft({
    brief_id: briefId,
    snapshot_id: SNAPSHOT_ID,
    as_of: AS_OF,
    commodity_refs: [COMMODITY_REF],
    narrative: "Copper call is constructive over 1d-1w on supply disruption and inventory draw signals.",
    driver_ids: [DRIVER_ID],
    watch_items: ["LME cash-3m spread", "China bonded-stock draw"],
  });
}

function ok(body: Record<string, unknown>): CommodityDecisionRouteResult {
  return { status: 200, body };
}
