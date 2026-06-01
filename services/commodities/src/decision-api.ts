import type { BalanceComponent, BalanceSnapshot } from "../../balances/src/balance-snapshot.ts";
import type { DailyCallBrief } from "../../briefs/src/daily-call.ts";
import type { ImpactChannel, ImpactDirection, ImpactDriver } from "../../impact/src/event-impact.ts";
import type { DecisionHorizon, PublicSubjectRef } from "../../shared/src/subject-ref.ts";

export type CommodityDecisionRouteResult = {
  status: number;
  body: Record<string, unknown>;
};

export type BalanceChange = Pick<
  BalanceComponent,
  "channel" | "label" | "delta" | "horizon" | "confidence"
>;

export type CommodityMarketEvent = {
  event_id: string;
  occurred_at: string;
  subject_refs: ReadonlyArray<PublicSubjectRef>;
  source_refs: ReadonlyArray<string>;
  summary: string;
};

export type CommodityImpactGraphNode = {
  id: string;
  kind: "event" | "driver" | "commodity";
  label: string;
};

export type CommodityImpactGraphEdge = {
  from: string;
  to: string;
  channel?: ImpactChannel;
  direction?: ImpactDirection;
  horizon?: DecisionHorizon;
  confidence?: number;
};

export type CommodityImpactGraph = {
  nodes: ReadonlyArray<CommodityImpactGraphNode>;
  edges: ReadonlyArray<CommodityImpactGraphEdge>;
};

export type BriefOutcome = {
  horizon: DecisionHorizon;
  observed_at: string;
  call_direction: ImpactDirection;
  realized_move: number;
  notes: string;
};

export type CommodityBalanceAdapter = {
  snapshot(): BalanceSnapshot;
  changes(): ReadonlyArray<BalanceChange>;
};

export type CommodityImpactAdapter = {
  events(): ReadonlyArray<CommodityMarketEvent>;
  drivers(): ReadonlyArray<ImpactDriver>;
  graph(): CommodityImpactGraph;
};

export type CommodityBriefAdapter = {
  daily(): DailyCallBrief;
  get(briefId: string): DailyCallBrief | null;
  publish(briefId: string): DailyCallBrief | null;
  outcomes(briefId: string): ReadonlyArray<BriefOutcome> | null;
};

export type CommodityDecisionAdapters = {
  balances: CommodityBalanceAdapter;
  impact: CommodityImpactAdapter;
  briefs: CommodityBriefAdapter;
};

export function commodityDecisionRoute(
  adapters: CommodityDecisionAdapters,
  method: string,
  pathname: string,
): CommodityDecisionRouteResult | null {
  if (method === "GET" && pathname === "/v1/balances/snapshot") {
    return ok({ snapshot: adapters.balances.snapshot() });
  }
  if (method === "GET" && pathname === "/v1/balances/changes") {
    return ok({ changes: adapters.balances.changes() });
  }
  if (method === "GET" && pathname === "/v1/impact/events") {
    return ok({ events: adapters.impact.events() });
  }
  if (method === "GET" && pathname === "/v1/impact/drivers") {
    return ok({ drivers: adapters.impact.drivers() });
  }
  if (method === "GET" && pathname === "/v1/impact/graph") {
    return ok(adapters.impact.graph());
  }
  if (method === "GET" && pathname === "/v1/briefs/daily") {
    return ok({ brief: adapters.briefs.daily() });
  }

  const briefMatch = pathname.match(/^\/v1\/briefs\/([^/]+)$/);
  if (method === "GET" && briefMatch) {
    const brief = adapters.briefs.get(briefMatch[1]);
    return brief === null ? notFound("brief not found") : ok({ brief });
  }

  const publishMatch = pathname.match(/^\/v1\/briefs\/([^/]+)\/publish$/);
  if (method === "POST" && publishMatch) {
    const brief = adapters.briefs.publish(publishMatch[1]);
    return brief === null ? notFound("brief not found") : ok({ brief });
  }

  const outcomesMatch = pathname.match(/^\/v1\/briefs\/([^/]+)\/outcomes$/);
  if (method === "GET" && outcomesMatch) {
    const outcomes = adapters.briefs.outcomes(outcomesMatch[1]);
    return outcomes === null ? notFound("brief not found") : ok({ brief_id: outcomesMatch[1], outcomes });
  }

  return null;
}

function ok(body: Record<string, unknown>): CommodityDecisionRouteResult {
  return { status: 200, body };
}

function notFound(error: string): CommodityDecisionRouteResult {
  return { status: 404, body: { error } };
}
