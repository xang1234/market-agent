// Margins and revenue growth for an issuer's quarters, computed in code from its
// reported facts (#178). Each value records the facts it came from, so it can be
// minted as a derived fact with lineage and cited like any reported figure; the
// model quotes these and still never computes its own.

import type { DerivedFactSpec } from "../../analyze/src/metrics-comparison-materializer.ts";
import type { IssuerFundamentalFact } from "../../fundamentals/src/issuer-fundamentals-reader.ts";
import type { CoverageLevel, FiscalPeriod, PeriodKind } from "../../fundamentals/src/statement.ts";
import type { VerifierFact } from "../../snapshot/src/snapshot-verifier.ts";

// Each margin: its metric, the statement line divided by revenue, and its label.
export const MARGINS = [
  { metric: "gross_margin", numerator: "gross_profit", label: "Gross margin" },
  { metric: "operating_margin", numerator: "operating_income", label: "Operating margin" },
  { metric: "net_margin", numerator: "net_income", label: "Net margin" },
] as const;

export const GROWTH = [
  { metric: "revenue_growth_qoq", label: "Revenue growth (QoQ)", back: 1 },
  { metric: "revenue_growth_yoy", label: "Revenue growth (YoY)", back: 4 },
] as const;

export type QuarterMetric = DerivedFactSpec & { label: string };

const QUARTERS = ["Q1", "Q2", "Q3", "Q4"];

// The quarter `back` quarters before (1 = the previous one, 4 = a year earlier).
export function quarterBefore(fiscalYear: number, fiscalPeriod: string, back: number): { fiscal_year: number; fiscal_period: string } | null {
  const index = QUARTERS.indexOf(fiscalPeriod);
  if (index === -1) return null;
  const total = fiscalYear * 4 + index - back;
  return { fiscal_year: Math.floor(total / 4), fiscal_period: QUARTERS[total % 4]! };
}

/**
 * The derived metrics for the quarters shown (oldest first):
 * - each margin for every shown quarter whose statement line and revenue are both
 *   reported, in one currency, with revenue non-zero;
 * - QoQ and YoY revenue growth for the latest quarter, when the earlier quarter's
 *   revenue is reported and positive.
 * `fact(metric, fiscal_year, fiscal_period)` finds a reported fact; `period(fact_id)`
 * the verifier's period dates for it.
 */
export function deriveQuarterMetrics(input: {
  shownRevenue: ReadonlyArray<IssuerFundamentalFact>;
  fact: (metricKey: string, fiscalYear: number, fiscalPeriod: string) => IssuerFundamentalFact | undefined;
  period: (factId: string) => VerifierFact | undefined;
}): QuarterMetric[] {
  const out: QuarterMetric[] = [];
  for (const revenue of input.shownRevenue) {
    for (const margin of MARGINS) {
      const line = input.fact(margin.numerator, revenue.fiscal_year!, revenue.fiscal_period!);
      if (!line || !sameCurrency(line, revenue) || native(revenue) === 0) continue;
      const spec = derived(margin.metric, margin.label, native(line) / native(revenue), revenue, [line, revenue], input.period);
      if (spec) out.push(spec);
    }
  }
  const latest = input.shownRevenue.at(-1);
  if (latest) {
    for (const growth of GROWTH) {
      const earlier = quarterBefore(latest.fiscal_year!, latest.fiscal_period!, growth.back);
      const prior = earlier && input.fact("revenue", earlier.fiscal_year, earlier.fiscal_period);
      // ponytail: growth from a zero or negative base isn't meaningful; skipped.
      if (!prior || !sameCurrency(prior, latest) || native(prior) <= 0) continue;
      const change = (native(latest) - native(prior)) / native(prior);
      const spec = derived(growth.metric, growth.label, change, latest, [latest, prior], input.period);
      if (spec) out.push(spec);
    }
  }
  return out;
}

// The derived fact carries the quarter of `at` (its period dates from the
// verifier), the latest as_of of its inputs, `at`'s source and coverage, and
// every input fact as lineage. No period dates, no fact.
function derived(
  metric: string,
  label: string,
  value: number,
  at: IssuerFundamentalFact,
  inputs: ReadonlyArray<IssuerFundamentalFact>,
  period: (factId: string) => VerifierFact | undefined,
): QuarterMetric | undefined {
  const dates = period(at.fact_id);
  if (!dates?.period_end || !Number.isFinite(value)) return undefined;
  return {
    metric,
    label,
    value_num: value,
    unit: "ratio",
    as_of: inputs.map((input) => input.as_of).sort().at(-1)!,
    source_id: at.source_id,
    period: {
      period_kind: (dates.period_kind ?? "fiscal_q") as PeriodKind,
      period_start: dates.period_start ?? null,
      period_end: dates.period_end,
      fiscal_year: at.fiscal_year!,
      fiscal_period: at.fiscal_period! as FiscalPeriod,
    },
    coverage_level: at.coverage_level as CoverageLevel,
    input_fact_ids: inputs.map((input) => input.fact_id),
  };
}

function native(fact: IssuerFundamentalFact): number {
  return fact.value_num! * fact.scale;
}

function sameCurrency(a: IssuerFundamentalFact, b: IssuerFundamentalFact): boolean {
  return (a.currency ?? "USD") === (b.currency ?? "USD");
}
