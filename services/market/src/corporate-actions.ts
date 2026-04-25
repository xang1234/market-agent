// Per spec §6.2.1: bar retrieval owns "basic corporate-action-aware bar
// shaping needed to produce one stable internal series shape." This module
// owns the in-memory shape of CA events and the transform that walks raw
// (unadjusted) bars to a target AdjustmentBasis. The persistence layer (the
// `events` table with `event_type in ('split','dividend',...)`) is a separate
// concern; this module operates on whatever CA list a caller hands it.
//
// Adjustment policy by basis (matches AdjustmentBasis in bar.ts):
//   "unadjusted":             raw provider data; no CA applied
//   "split_adjusted":         splits + stock dividends only (share-count CAs)
//   "split_and_div_adjusted": all CA classes (also cash dividends, spin-offs)

import type { ListingSubjectRef, UUID } from "./subject-ref.ts";
import type { AdjustmentBasis, NormalizedBar } from "./bar.ts";
import {
  assertCurrency,
  assertFinitePositive,
  assertIso8601Utc,
  assertOneOf,
  assertUuid,
} from "./validators.ts";

function freezeListing(ref: ListingSubjectRef, label: string): ListingSubjectRef {
  if (ref?.kind !== "listing") {
    throw new Error(`${label}: listing must be a listing SubjectRef`);
  }
  return Object.freeze({ kind: ref.kind, id: ref.id });
}

export type CorporateActionKind =
  | "split"
  | "cash_dividend"
  | "stock_dividend"
  | "spin_off";

export const CORPORATE_ACTION_KINDS: ReadonlyArray<CorporateActionKind> = [
  "split",
  "cash_dividend",
  "stock_dividend",
  "spin_off",
];

export type Split = {
  kind: "split";
  listing: ListingSubjectRef;
  effective_date: string;
  numerator: number;
  denominator: number;
  source_id: UUID;
};

export type CashDividend = {
  kind: "cash_dividend";
  listing: ListingSubjectRef;
  effective_date: string;
  cash_amount: number;
  currency: string;
  source_id: UUID;
};

export type StockDividend = {
  kind: "stock_dividend";
  listing: ListingSubjectRef;
  effective_date: string;
  numerator: number;
  denominator: number;
  source_id: UUID;
};

export type SpinOff = {
  kind: "spin_off";
  listing: ListingSubjectRef;
  effective_date: string;
  target_listing: ListingSubjectRef;
  spinoff_value: number;
  currency: string;
  source_id: UUID;
};

export type CorporateAction = Split | CashDividend | StockDividend | SpinOff;

const SHARE_COUNT_KINDS: ReadonlySet<CorporateActionKind> = new Set([
  "split",
  "stock_dividend",
]);

const ALL_CA_KINDS: ReadonlySet<CorporateActionKind> = new Set(CORPORATE_ACTION_KINDS);

export function corporateAction(input: CorporateAction): CorporateAction {
  assertOneOf(input.kind, CORPORATE_ACTION_KINDS, "corporateAction.kind");
  assertIso8601Utc(input.effective_date, `corporateAction[${input.kind}].effective_date`);
  assertUuid(input.source_id, `corporateAction[${input.kind}].source_id`);
  const listing = freezeListing(input.listing, `corporateAction[${input.kind}].listing`);

  switch (input.kind) {
    case "split":
    case "stock_dividend":
      assertFinitePositive(input.numerator, `corporateAction[${input.kind}].numerator`);
      assertFinitePositive(input.denominator, `corporateAction[${input.kind}].denominator`);
      return Object.freeze({ ...input, listing });
    case "cash_dividend":
      assertFinitePositive(input.cash_amount, "corporateAction[cash_dividend].cash_amount");
      assertCurrency(input.currency, "corporateAction[cash_dividend].currency");
      return Object.freeze({ ...input, listing });
    case "spin_off":
      assertFinitePositive(input.spinoff_value, "corporateAction[spin_off].spinoff_value");
      assertCurrency(input.currency, "corporateAction[spin_off].currency");
      return Object.freeze({
        ...input,
        listing,
        target_listing: freezeListing(
          input.target_listing,
          "corporateAction[spin_off].target_listing",
        ),
      });
  }
}

export function applyCorporateActions(
  bars: ReadonlyArray<NormalizedBar>,
  actions: ReadonlyArray<CorporateAction>,
  basis: AdjustmentBasis,
): NormalizedBar[] {
  if (basis === "unadjusted") return bars.map(cloneBar);

  const eligible = basis === "split_adjusted" ? SHARE_COUNT_KINDS : ALL_CA_KINDS;
  const filtered = actions.filter((a) => eligible.has(a.kind));

  const sorted = [...filtered].sort(
    (a, b) => Date.parse(a.effective_date) - Date.parse(b.effective_date),
  );

  let result = bars.map(cloneBar);
  for (const action of sorted) {
    result = applyOne(result, action);
  }
  return result;
}

function applyOne(bars: NormalizedBar[], action: CorporateAction): NormalizedBar[] {
  switch (action.kind) {
    case "split":
    case "stock_dividend":
      return applyShareCountAction(bars, action);
    case "cash_dividend":
      return applyValueDistribution(bars, action.effective_date, action.cash_amount);
    case "spin_off":
      return applyValueDistribution(bars, action.effective_date, action.spinoff_value);
  }
}

// Splits and stock dividends both change share count without changing total
// market cap, so price ÷ ratio and volume × ratio. The ratio differs:
//   split (n-for-d):       n/d shares-after per share-before (2-for-1 = 2.0)
//   stock dividend (n:d):  (n+d)/d, since holders keep existing shares plus
//                          n new ones per d held (10% stock div = 11/10 = 1.1)
function applyShareCountAction(
  bars: NormalizedBar[],
  action: Split | StockDividend,
): NormalizedBar[] {
  const ratio =
    action.kind === "split"
      ? action.numerator / action.denominator
      : (action.numerator + action.denominator) / action.denominator;
  if (!Number.isFinite(ratio) || ratio <= 0) return bars;

  const effMs = Date.parse(action.effective_date);
  return bars.map((bar) => {
    if (Date.parse(bar.ts) >= effMs) return bar;
    return {
      ts: bar.ts,
      open: bar.open / ratio,
      high: bar.high / ratio,
      low: bar.low / ratio,
      close: bar.close / ratio,
      volume: bar.volume * ratio,
    };
  });
}

// Cash dividends and spin-offs both reduce per-share market value by a fixed
// amount on the ex-date without changing share count. The standard adjustment
// scales pre-ex prices by (prevClose - distributionValue) / prevClose so the
// adjusted series treats the ex-date drop as a non-event.
function applyValueDistribution(
  bars: NormalizedBar[],
  effective_date: string,
  distributionValue: number,
): NormalizedBar[] {
  const effMs = Date.parse(effective_date);

  let prevClose: number | undefined;
  for (let i = bars.length - 1; i >= 0; i--) {
    if (Date.parse(bars[i].ts) < effMs) {
      prevClose = bars[i].close;
      break;
    }
  }
  // No bar before the ex-date in the requested range, or distribution is
  // larger than the prior close (rare/erroneous): leave bars untouched. A
  // future freshness/coverage policy can decide whether to flag this.
  if (prevClose === undefined || prevClose <= 0) return bars;
  const factor = (prevClose - distributionValue) / prevClose;
  if (!Number.isFinite(factor) || factor <= 0) return bars;

  return bars.map((bar) => {
    if (Date.parse(bar.ts) >= effMs) return bar;
    return {
      ts: bar.ts,
      open: bar.open * factor,
      high: bar.high * factor,
      low: bar.low * factor,
      close: bar.close * factor,
      volume: bar.volume,
    };
  });
}

function cloneBar(b: NormalizedBar): NormalizedBar {
  return { ts: b.ts, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume };
}
