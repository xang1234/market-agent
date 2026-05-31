import type { SubjectRef, UUID } from "../../shared/src/subject-ref.ts";
import {
  assertCurrency,
  assertFinitePositive,
  assertIsoDateTime,
  assertOneOf,
  assertUuid,
  assertNonEmptyString,
} from "../../shared/src/validators.ts";
import { DELAY_CLASSES, type DelayClass } from "./quote.ts";

export const COMMODITY_DELIVERY_TERMS = ["warehouse", "fob", "cfr", "cif", "dap"] as const;
export type CommodityDeliveryTerm = (typeof COMMODITY_DELIVERY_TERMS)[number];

export type CommodityMarketSubjectKind = "benchmark" | "contract";

export type CommodityMarketQuoteInput = {
  subject_ref: SubjectRef & { kind: CommodityMarketSubjectKind };
  benchmark: string;
  price: number;
  prev_close: number;
  currency: string;
  unit: string;
  grade: string;
  location: string;
  delivery_month: string;
  incoterm: CommodityDeliveryTerm;
  freshness: DelayClass;
  as_of: string;
  source_id: UUID;
};

export type CommodityMarketQuote = Readonly<CommodityMarketQuoteInput & {
  change_abs: number;
  change_pct: number;
}>;

export type CurvePointInput = {
  tenor: string;
  tenor_rank: number;
  price: number;
};

export type CurvePoint = Readonly<CurvePointInput>;

export type CommodityCurveInput = {
  curve_ref: SubjectRef & { kind: "curve" };
  as_of: string;
  currency: string;
  unit: string;
  source_id: UUID;
  points: ReadonlyArray<CurvePointInput>;
};

export type CommodityCurve = Readonly<Omit<CommodityCurveInput, "points"> & {
  points: ReadonlyArray<CurvePoint>;
}>;

export type SpreadLeg = {
  tenor: string;
  price: number;
};

export type CommoditySpreadInput = {
  spread_id: string;
  first_leg: SpreadLeg;
  second_leg: SpreadLeg;
  currency: string;
  unit: string;
  as_of: string;
  source_id: UUID;
};

export type CommoditySpread = Readonly<CommoditySpreadInput & {
  label: string;
  value: number;
}>;

export function normalizeCommodityMarketQuote(input: CommodityMarketQuoteInput): CommodityMarketQuote {
  assertCommodityMarketSubject(input.subject_ref, "commodityQuote.subject_ref");
  assertNonEmptyString(input.benchmark, "commodityQuote.benchmark");
  assertFinitePositive(input.price, "commodityQuote.price");
  assertFinitePositive(input.prev_close, "commodityQuote.prev_close");
  assertCurrency(input.currency, "commodityQuote.currency");
  assertNonEmptyString(input.unit, "commodityQuote.unit");
  assertNonEmptyString(input.grade, "commodityQuote.grade");
  assertNonEmptyString(input.location, "commodityQuote.location");
  assertNonEmptyString(input.delivery_month, "commodityQuote.delivery_month");
  assertOneOf(input.incoterm, COMMODITY_DELIVERY_TERMS, "commodityQuote.incoterm");
  assertOneOf(input.freshness, DELAY_CLASSES, "commodityQuote.freshness");
  assertIsoDateTime(input.as_of, "commodityQuote.as_of");
  assertUuid(input.source_id, "commodityQuote.source_id");

  const change_abs = input.price - input.prev_close;
  return Object.freeze({
    subject_ref: Object.freeze({ ...input.subject_ref }),
    benchmark: input.benchmark.trim(),
    price: input.price,
    prev_close: input.prev_close,
    currency: input.currency,
    unit: input.unit.trim(),
    grade: input.grade.trim(),
    location: input.location.trim(),
    delivery_month: input.delivery_month.trim(),
    incoterm: input.incoterm,
    freshness: input.freshness,
    as_of: input.as_of,
    source_id: input.source_id,
    change_abs,
    change_pct: change_abs / input.prev_close,
  });
}

export function normalizeCurve(input: CommodityCurveInput): CommodityCurve {
  assertSubjectKind(input.curve_ref, "curve", "curve.curve_ref");
  assertIsoDateTime(input.as_of, "curve.as_of");
  assertCurrency(input.currency, "curve.currency");
  assertNonEmptyString(input.unit, "curve.unit");
  assertUuid(input.source_id, "curve.source_id");
  if (!Array.isArray(input.points) || input.points.length === 0) {
    throw new Error("curve.points must be a non-empty array");
  }

  const seen = new Set<string>();
  const points = input.points.map((point, index) => {
    assertNonEmptyString(point.tenor, `curve.points[${index}].tenor`);
    if (seen.has(point.tenor)) throw new Error(`curve.points[${index}].tenor duplicate tenor "${point.tenor}"`);
    seen.add(point.tenor);
    if (!Number.isInteger(point.tenor_rank) || point.tenor_rank < 0) {
      throw new Error(`curve.points[${index}].tenor_rank must be a non-negative integer`);
    }
    assertFinitePositive(point.price, `curve.points[${index}].price`);
    return Object.freeze({ tenor: point.tenor, tenor_rank: point.tenor_rank, price: point.price });
  }).sort((left, right) => left.tenor_rank - right.tenor_rank);

  return Object.freeze({
    curve_ref: Object.freeze({ ...input.curve_ref }),
    as_of: input.as_of,
    currency: input.currency,
    unit: input.unit.trim(),
    source_id: input.source_id,
    points: Object.freeze(points),
  });
}

export function normalizeSpread(input: CommoditySpreadInput): CommoditySpread {
  assertNonEmptyString(input.spread_id, "spread.spread_id");
  const firstLeg = normalizeSpreadLeg(input.first_leg, "spread.first_leg");
  const secondLeg = normalizeSpreadLeg(input.second_leg, "spread.second_leg");
  assertCurrency(input.currency, "spread.currency");
  assertNonEmptyString(input.unit, "spread.unit");
  assertIsoDateTime(input.as_of, "spread.as_of");
  assertUuid(input.source_id, "spread.source_id");

  return Object.freeze({
    spread_id: input.spread_id.trim(),
    first_leg: firstLeg,
    second_leg: secondLeg,
    currency: input.currency,
    unit: input.unit.trim(),
    as_of: input.as_of,
    source_id: input.source_id,
    label: `${firstLeg.tenor} / ${secondLeg.tenor}`,
    value: firstLeg.price - secondLeg.price,
  });
}

function normalizeSpreadLeg(input: SpreadLeg, label: string): SpreadLeg {
  if (input === null || typeof input !== "object") throw new Error(`${label} must be an object`);
  assertNonEmptyString(input.tenor, `${label}.tenor`);
  assertFinitePositive(input.price, `${label}.price`);
  return Object.freeze({ tenor: input.tenor.trim(), price: input.price });
}

function assertCommodityMarketSubject(value: SubjectRef, label: string): void {
  if (value === null || typeof value !== "object") throw new Error(`${label} must be a SubjectRef`);
  if (value.kind !== "benchmark" && value.kind !== "contract") {
    throw new Error(`${label}.kind must be benchmark or contract`);
  }
  assertUuid(value.id, `${label}.id`);
}

function assertSubjectKind(value: SubjectRef, kind: string, label: string): void {
  if (value === null || typeof value !== "object") throw new Error(`${label} must be a SubjectRef`);
  if (value.kind !== kind) throw new Error(`${label}.kind must be ${kind}`);
  assertUuid(value.id, `${label}.id`);
}
