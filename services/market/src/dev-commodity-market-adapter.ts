import type { SubjectRef } from "../../shared/src/subject-ref.ts";
import {
  normalizeCommodityMarketQuote,
  normalizeCurve,
  normalizeSpread,
  type CommodityMarketSubjectKind,
} from "./commodity-contract.ts";
import type {
  CommodityCurveResponse,
  CommodityInventoryResponse,
  CommodityLatestResponse,
  CommodityMarketDataAdapter,
  CommoditySeriesResponse,
  CommoditySpreadsResponse,
} from "./commodity-market-adapter.ts";

export const DEV_COMMODITY_SOURCE_ID = "44444444-4444-4444-8444-444444444444";
export const COPPER_CONTRACT_ID = "11111111-1111-4111-8111-111111111111";
export const COPPER_BENCHMARK_ID = "55555555-5555-4555-8555-555555555555";
export const COPPER_CURVE_ID = "22222222-2222-4222-8222-222222222222";
export const COPPER_COMMODITY_ID = "33333333-3333-4333-8333-333333333333";

export type DevCommodityMarketDataAdapterOptions = {
  clock?: () => Date;
};

export function createDevCommodityMarketDataAdapter(
  options: DevCommodityMarketDataAdapterOptions = {},
): CommodityMarketDataAdapter {
  const clock = options.clock ?? (() => new Date());
  return {
    latest(subjectRef) {
      return commodityLatestResponse(subjectRef, clock());
    },
    series(subjectRef) {
      return commoditySeriesResponse(subjectRef, clock());
    },
    curve(curveId) {
      return commodityCurveResponse(curveId, clock());
    },
    spreads(curveId) {
      return commoditySpreadsResponse(curveId, clock());
    },
    inventory(commodityId) {
      return commodityInventoryResponse(commodityId, clock());
    },
  };
}

function commodityLatestResponse(
  subjectRef: SubjectRef & { kind: CommodityMarketSubjectKind },
  asOf: Date,
): CommodityLatestResponse | null {
  if (!isKnownCopperMarketSubject(subjectRef)) return null;
  const quote = normalizeCommodityMarketQuote({
    subject_ref: subjectRef,
    benchmark: subjectRef.kind === "contract" ? "LME Copper Cash" : "LME Copper Grade A",
    price: 10350,
    prev_close: 10225,
    currency: "USD",
    unit: "t",
    grade: "Grade A copper cathode",
    location: "LME warehouse",
    delivery_month: "cash",
    incoterm: "warehouse",
    freshness: "real_time",
    as_of: asOf.toISOString(),
    source_id: DEV_COMMODITY_SOURCE_ID,
  });
  return Object.freeze({
    quote,
    source_freshness: Object.freeze({
      source_id: quote.source_id,
      delay_class: quote.freshness,
      as_of: quote.as_of,
    }),
  });
}

function commoditySeriesResponse(
  subjectRef: SubjectRef & { kind: CommodityMarketSubjectKind },
  asOf: Date,
): CommoditySeriesResponse | null {
  if (!isKnownCopperMarketSubject(subjectRef)) return null;
  return Object.freeze({
    subject_ref: Object.freeze({ ...subjectRef }),
    currency: "USD",
    unit: "t",
    points: Object.freeze([
      Object.freeze({ ts: "2026-05-29T00:00:00.000Z", price: 10225 }),
      Object.freeze({ ts: asOf.toISOString(), price: 10350 }),
    ]),
    source_id: DEV_COMMODITY_SOURCE_ID,
    as_of: asOf.toISOString(),
  });
}

function commodityCurveResponse(curveId: string, asOf: Date): CommodityCurveResponse | null {
  if (curveId !== COPPER_CURVE_ID) return null;
  return Object.freeze({
    curve: normalizeCurve({
      curve_ref: { kind: "curve", id: curveId },
      as_of: asOf.toISOString(),
      currency: "USD",
      unit: "t",
      source_id: DEV_COMMODITY_SOURCE_ID,
      points: [
        { tenor: "cash", tenor_rank: 0, price: 10350 },
        { tenor: "3M", tenor_rank: 3, price: 10290 },
      ],
    }),
  });
}

function commoditySpreadsResponse(curveId: string, asOf: Date): CommoditySpreadsResponse | null {
  if (curveId !== COPPER_CURVE_ID) return null;
  const spreads = Object.freeze([
    normalizeSpread({
      spread_id: "cash-3m",
      first_leg: { tenor: "cash", price: 10350 },
      second_leg: { tenor: "3M", price: 10290 },
      currency: "USD",
      unit: "t",
      as_of: asOf.toISOString(),
      source_id: DEV_COMMODITY_SOURCE_ID,
    }),
  ]);
  return Object.freeze({
    curve_ref: Object.freeze({ kind: "curve" as const, id: curveId }),
    spreads,
  });
}

function commodityInventoryResponse(commodityId: string, asOf: Date): CommodityInventoryResponse | null {
  if (commodityId !== COPPER_COMMODITY_ID) return null;
  return Object.freeze({
    commodity_ref: Object.freeze({ kind: "commodity" as const, id: commodityId }),
    unit: "t",
    points: Object.freeze([
      Object.freeze({ ts: "2026-05-29T00:00:00.000Z", value: 142500 }),
      Object.freeze({ ts: asOf.toISOString(), value: 140900 }),
    ]),
    source_id: DEV_COMMODITY_SOURCE_ID,
    as_of: asOf.toISOString(),
  });
}

function isKnownCopperMarketSubject(subjectRef: SubjectRef & { kind: CommodityMarketSubjectKind }): boolean {
  return (subjectRef.kind === "contract" && subjectRef.id === COPPER_CONTRACT_ID) ||
    (subjectRef.kind === "benchmark" && subjectRef.id === COPPER_BENCHMARK_ID);
}
