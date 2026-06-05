// Assembles a revenue_bars block from quarterly revenue facts: one bar per
// quarter, ordered oldest -> newest, each carrying its backing fact (value_ref),
// a normalized magnitude (peak bar = 1) for the rendered height, and a
// pre-rendered compact-currency label. The block contract carries display-ready
// data so the web stays a dumb renderer (like metrics_comparison's cell.format).

import { formatCompactCurrency } from "./block-format.ts";
import type { UUID } from "../../fundamentals/src/subject-ref.ts";

export type QuarterlyRevenueFact = {
  fact_id: UUID;
  fiscal_year: number | null;
  fiscal_period: string | null;
  value_num: number;
  scale: number;
  currency: string | null;
};

export type RevenueBar = {
  label: string;
  value_ref: UUID;
  magnitude: number;
  format: string;
};

export type RevenueBarsBlockBase = {
  id: string;
  snapshot_id: UUID;
  as_of: string;
  source_refs: ReadonlyArray<UUID>;
  title?: string;
};

export type RevenueBarsBlock = {
  id: string;
  kind: "revenue_bars";
  snapshot_id: UUID;
  data_ref: { kind: string; id: string; params?: Readonly<Record<string, unknown>> };
  source_refs: ReadonlyArray<UUID>;
  as_of: string;
  title?: string;
  bars: ReadonlyArray<RevenueBar>;
};

const QUARTER_ORDER: Readonly<Record<string, number>> = { Q1: 1, Q2: 2, Q3: 3, Q4: 4 };

export function buildRevenueBarsBlock(input: {
  facts: ReadonlyArray<QuarterlyRevenueFact>;
  base: RevenueBarsBlockBase;
}): RevenueBarsBlock {
  const { base } = input;
  const sorted = [...input.facts].sort(comparePeriod);
  const natives = sorted.map((fact) => fact.value_num * fact.scale);
  const max = natives.reduce((m, value) => (value > m ? value : m), 0);

  const bars = sorted.map((fact, index): RevenueBar => ({
    label: barLabel(fact),
    value_ref: fact.fact_id,
    magnitude: max > 0 ? natives[index] / max : 0,
    format: formatCompactCurrency(natives[index], fact.currency ?? "USD"),
  }));

  return {
    id: base.id,
    kind: "revenue_bars",
    snapshot_id: base.snapshot_id,
    data_ref: { kind: "revenue_bars", id: base.id },
    source_refs: base.source_refs,
    as_of: base.as_of,
    ...(base.title === undefined ? {} : { title: base.title }),
    bars,
  };
}

function comparePeriod(a: QuarterlyRevenueFact, b: QuarterlyRevenueFact): number {
  const yearDelta = (a.fiscal_year ?? 0) - (b.fiscal_year ?? 0);
  if (yearDelta !== 0) return yearDelta;
  return (QUARTER_ORDER[a.fiscal_period ?? ""] ?? 0) - (QUARTER_ORDER[b.fiscal_period ?? ""] ?? 0);
}

function barLabel(fact: QuarterlyRevenueFact): string {
  return `${fact.fiscal_period ?? "?"} ${fact.fiscal_year ?? "?"}`;
}
