import type { SubjectRef } from "../../shared/src/subject-ref.ts";
import type {
  CommodityCurve,
  CommodityMarketQuote,
  CommodityMarketSubjectKind,
  CommoditySpread,
} from "./commodity-contract.ts";

type MaybePromise<T> = T | Promise<T>;

export type CommodityLatestResponse = {
  quote: CommodityMarketQuote;
  source_freshness: {
    source_id: string;
    delay_class: CommodityMarketQuote["freshness"];
    as_of: string;
  };
};

export type CommoditySeriesResponse = {
  subject_ref: SubjectRef & { kind: CommodityMarketSubjectKind };
  currency: string;
  unit: string;
  points: ReadonlyArray<{ ts: string; price: number }>;
  source_id: string;
  as_of: string;
};

export type CommodityCurveResponse = {
  curve: CommodityCurve;
};

export type CommoditySpreadsResponse = {
  curve_ref: SubjectRef & { kind: "curve" };
  spreads: ReadonlyArray<CommoditySpread>;
};

export type CommodityInventoryResponse = {
  commodity_ref: SubjectRef & { kind: "commodity" };
  unit: string;
  points: ReadonlyArray<{ ts: string; value: number }>;
  source_id: string;
  as_of: string;
};

export type CommodityMarketDataAdapter = {
  latest(
    subjectRef: SubjectRef & { kind: CommodityMarketSubjectKind },
  ): MaybePromise<CommodityLatestResponse | null>;
  series(
    subjectRef: SubjectRef & { kind: CommodityMarketSubjectKind },
  ): MaybePromise<CommoditySeriesResponse | null>;
  curve(curveId: string): MaybePromise<CommodityCurveResponse | null>;
  spreads(curveId: string): MaybePromise<CommoditySpreadsResponse | null>;
  inventory(commodityId: string): MaybePromise<CommodityInventoryResponse | null>;
};
