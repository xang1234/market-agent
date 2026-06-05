// Assembles a price_target_range block: the current-price + low/mean/high refs
// plus a `display` object carrying each point's range-bar position (low=0,
// high=1, others interpolated) and pre-formatted price — the web renders the bar
// from these, staying a dumb renderer.

import { formatCurrency } from "./block-format.ts";
import type { UUID } from "../../fundamentals/src/subject-ref.ts";

export type PriceTargetPoint = { position: number; format: string };

export type PriceTargetRangeDisplay = {
  current: PriceTargetPoint;
  low: PriceTargetPoint;
  avg: PriceTargetPoint;
  high: PriceTargetPoint;
};

export type PriceTargetRangeBlockBase = {
  id: string;
  snapshot_id: UUID;
  as_of: string;
  source_refs: ReadonlyArray<UUID>;
  title?: string;
};

export type PriceTargetRangeBlock = {
  id: string;
  kind: "price_target_range";
  snapshot_id: UUID;
  data_ref: { kind: string; id: string; params?: Readonly<Record<string, unknown>> };
  source_refs: ReadonlyArray<UUID>;
  as_of: string;
  title?: string;
  current_price_ref: UUID;
  low_ref: UUID;
  avg_ref: UUID;
  high_ref: UUID;
  display: PriceTargetRangeDisplay;
};

export function buildPriceTargetRangeBlock(input: {
  currentPriceRef: UUID;
  current: number;
  low: { ref: UUID; value: number };
  mean: { ref: UUID; value: number };
  high: { ref: UUID; value: number };
  currency: string;
  base: PriceTargetRangeBlockBase;
}): PriceTargetRangeBlock {
  const { low, mean, high, current, currency, base } = input;
  const span = high.value - low.value;
  const position = (value: number): number => (span > 0 ? clamp01((value - low.value) / span) : 0);

  return {
    id: base.id,
    kind: "price_target_range",
    snapshot_id: base.snapshot_id,
    data_ref: { kind: "price_target_range", id: base.id },
    source_refs: base.source_refs,
    as_of: base.as_of,
    ...(base.title === undefined ? {} : { title: base.title }),
    current_price_ref: input.currentPriceRef,
    low_ref: low.ref,
    avg_ref: mean.ref,
    high_ref: high.ref,
    display: {
      current: { position: position(current), format: formatCurrency(current, currency) },
      low: { position: 0, format: formatCurrency(low.value, currency) },
      avg: { position: position(mean.value), format: formatCurrency(mean.value, currency) },
      high: { position: 1, format: formatCurrency(high.value, currency) },
    },
  };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
