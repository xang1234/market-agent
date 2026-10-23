// The figures a broad measure is read as when a request names it without
// picking one (#517). The planning model only cites a family key; the planner
// expands it, and the answer's note is rendered from this table.

import type { MetricKey, PeriodSelector } from "../../financial-core/src/index.ts";

export const MEASURE_DEFAULTS_VERSION = "measure-defaults.v1";

export type MeasureMargin = "gross_margin" | "operating_margin" | "net_margin";

export type MeasureFamily = Readonly<{
  label: string;
  metrics: ReadonlyArray<MetricKey>;
  /** Each margin divides the metric it names by revenue of the same period. */
  margins: ReadonlyArray<Readonly<{ margin: MeasureMargin; numerator: MetricKey }>>;
  periods: ReadonlyArray<PeriodSelector>;
}>;

const LATEST_FISCAL_YEAR: PeriodSelector = { kind: "latest", period_type: "annual", offset: 0 };
const LATEST_QUARTER: PeriodSelector = { kind: "latest", period_type: "quarterly", offset: 0 };

export const MEASURE_DEFAULTS = {
  profit: {
    label: "profit",
    metrics: ["gross_profit", "operating_income", "net_income"],
    margins: [
      { margin: "gross_margin", numerator: "gross_profit" },
      { margin: "operating_margin", numerator: "operating_income" },
      { margin: "net_margin", numerator: "net_income" },
    ],
    periods: [LATEST_FISCAL_YEAR, LATEST_QUARTER],
  },
  revenue: {
    label: "revenue",
    metrics: ["revenue"],
    margins: [],
    periods: [LATEST_FISCAL_YEAR, LATEST_QUARTER],
  },
  eps: {
    label: "earnings per share",
    metrics: ["eps_diluted"],
    margins: [],
    periods: [LATEST_FISCAL_YEAR, LATEST_QUARTER],
  },
} as const satisfies Readonly<Record<string, MeasureFamily>>;

export type MeasureFamilyKey = keyof typeof MEASURE_DEFAULTS;
