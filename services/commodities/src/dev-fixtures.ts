import {
  normalizeBalanceSnapshot,
  type BalanceSnapshot,
} from "../../balances/src/balance-snapshot.ts";
import { buildDailyCallDraft, publishDailyCall, type DailyCallBrief } from "../../briefs/src/daily-call.ts";
import {
  normalizeImpactDriver,
  rankImpactDrivers,
  type ImpactDriver,
} from "../../impact/src/event-impact.ts";
import { isUuid } from "../../shared/src/subject-ref.ts";
import type {
  BalanceChange,
  BriefOutcome,
  CommodityDecisionAdapters,
  CommodityImpactGraph,
  CommodityMarketEvent,
} from "./decision-api.ts";

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

export function createDevCommodityDecisionAdapters(): CommodityDecisionAdapters {
  return {
    balances: {
      snapshot: sampleBalanceSnapshot,
      changes: sampleBalanceChanges,
    },
    impact: {
      events: sampleEvents,
      drivers: sampleDrivers,
      graph: sampleImpactGraph,
    },
    briefs: {
      daily: sampleBrief,
      get: sampleBriefById,
      publish: samplePublishedBrief,
      outcomes: sampleBriefOutcomes,
    },
  };
}

function sampleBalanceSnapshot(): BalanceSnapshot {
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

function sampleBalanceChanges(): ReadonlyArray<BalanceChange> {
  return Object.freeze(sampleBalanceSnapshot().components
    .filter((component) => Math.abs(component.delta) > 0)
    .map((component) => Object.freeze({
      channel: component.channel,
      label: component.label,
      delta: component.delta,
      horizon: component.horizon,
      confidence: component.confidence,
    })));
}

function sampleEvents(): ReadonlyArray<CommodityMarketEvent> {
  return Object.freeze([
    Object.freeze({
      event_id: EVENT_ID,
      occurred_at: AS_OF,
      subject_refs: Object.freeze([COMMODITY_REF]),
      source_refs: Object.freeze([SOURCE_ID]),
      summary: "Copper concentrate shipment disruption tightened nearby cathode availability.",
    }),
  ]);
}

function sampleDrivers(): ReadonlyArray<ImpactDriver> {
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

function sampleImpactGraph(): CommodityImpactGraph {
  return Object.freeze({
    nodes: Object.freeze([
      Object.freeze({ id: EVENT_ID, kind: "event", label: "Shipment disruption" }),
      Object.freeze({ id: DRIVER_ID, kind: "driver", label: "Supply tightness" }),
      Object.freeze({ id: COMMODITY_ID, kind: "commodity", label: "Copper" }),
    ]),
    edges: Object.freeze([
      Object.freeze({ from: EVENT_ID, to: DRIVER_ID, channel: "supply", direction: "positive" }),
      Object.freeze({ from: DRIVER_ID, to: COMMODITY_ID, horizon: "1w", confidence: 0.78 }),
    ]),
  });
}

function sampleBrief(briefId = BRIEF_ID): DailyCallBrief {
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

function sampleBriefById(briefId: string): DailyCallBrief | null {
  if (!isUuid(briefId)) return null;
  return sampleBrief(briefId);
}

function samplePublishedBrief(briefId: string): DailyCallBrief | null {
  const brief = sampleBriefById(briefId);
  if (brief === null) return null;
  return publishDailyCall(brief, {
    reviewer_user_id: REVIEWER_ID,
    published_at: AS_OF,
  });
}

function sampleBriefOutcomes(briefId: string): ReadonlyArray<BriefOutcome> | null {
  if (!isUuid(briefId)) return null;
  return Object.freeze([
    Object.freeze({
      horizon: "1w",
      observed_at: AS_OF,
      call_direction: "positive",
      realized_move: 0.012,
      notes: "Nearby copper held firm against the supply-tightness call.",
    }),
  ]);
}
