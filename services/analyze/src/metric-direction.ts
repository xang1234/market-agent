// Tone policy for the metrics_comparison block: which way is "good" per metric,
// and how that colors a column of peer values (best → positive, worst →
// negative, the rest → neutral).
//
// This is a presentation policy for THIS block, deliberately distinct from the
// metrics table's coarse `interpretation` column:
//   - revenue:  the table calls it higher_is_better, but a bigger absolute
//     revenue is not "better" in a peer comparison (size != quality), so it
//     gets NO tone.
//   - pe_ratio: the table calls it neutral, but for comparison a lower forward
//     P/E reads as cheaper, so its direction is `lower` (signed off 2026-06-01).
// Sourcing direction from the table would be wrong for both — hence a small,
// signed-off, exhaustively-typed registry here.

import type { PeerMetricKey } from "../../fundamentals/src/peer-metrics.ts";

export type MetricDirection = "higher" | "lower" | "none";
export type MetricTone = "positive" | "negative" | "neutral";

// Exhaustive: a new PeerMetricKey must declare its direction here or the build
// breaks — no silent default.
export const METRIC_DIRECTION: Readonly<Record<PeerMetricKey, MetricDirection>> = {
  revenue: "none",
  gross_margin: "higher",
  net_margin: "higher",
  revenue_growth_yoy: "higher",
  pe_ratio: "lower",
};

// Tone for each value in a metric column, in the order given. `undefined` means
// "no tone" — the cell renders plain. That covers a directionless metric
// (revenue), fewer than two comparable values (nothing to rank against), and an
// all-equal column (no leader or laggard to highlight). Otherwise the best
// value (per the metric's direction) is positive, the worst negative, the rest
// neutral; ties at an extreme all share that extreme's tone.
export function columnTones(
  metric: PeerMetricKey,
  values: ReadonlyArray<number>,
): ReadonlyArray<MetricTone | undefined> {
  const direction = METRIC_DIRECTION[metric];
  if (direction === "none" || values.length < 2) {
    return values.map(() => undefined);
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) {
    return values.map(() => undefined);
  }

  const best = direction === "higher" ? max : min;
  const worst = direction === "higher" ? min : max;
  return values.map((value) => (value === best ? "positive" : value === worst ? "negative" : "neutral"));
}
