// The figures a broad measure is read as when a request names it without
// picking one (#517). The planning model only cites a family key; the planner
// expands it, and the answer's note is rendered from this table.

import { canonicalJson, METRIC_CATALOG_V1, type MeasureDefaultRecord, type MetricKey, type PeriodSelector } from "../../financial-core/src/index.ts";
import { periodPhrase } from "./plan-interpretation.ts";

export const MEASURE_DEFAULTS_VERSION = "measure-defaults.v1";

export type MeasureMargin = "gross_margin" | "operating_margin" | "net_margin";

export type MeasureFamily = Readonly<{
  label: string;
  periods: ReadonlyArray<PeriodSelector>;
} & (
  /** A family that is its one figure: the answer's note says that figure is shown. */
  | { note: "shown"; metrics: readonly [MetricKey]; margins: readonly [] }
  | {
    note: "read_as";
    metrics: ReadonlyArray<MetricKey>;
    /** Each margin divides the metric it names by revenue of the same period. */
    margins: ReadonlyArray<Readonly<{ margin: MeasureMargin; numerator: MetricKey }>>;
  }
)>;

const LATEST_FISCAL_YEAR: PeriodSelector = { kind: "latest", period_type: "annual", offset: 0 };
const LATEST_QUARTER: PeriodSelector = { kind: "latest", period_type: "quarterly", offset: 0 };

export const MEASURE_DEFAULTS = {
  profit: {
    label: "profit",
    note: "read_as",
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
    note: "shown",
    metrics: ["revenue"],
    margins: [],
    periods: [LATEST_FISCAL_YEAR, LATEST_QUARTER],
  },
  eps: {
    label: "earnings per share",
    note: "read_as",
    metrics: ["eps_diluted"],
    margins: [],
    periods: [LATEST_FISCAL_YEAR, LATEST_QUARTER],
  },
} as const satisfies Readonly<Record<string, MeasureFamily>>;

export type MeasureFamilyKey = keyof typeof MEASURE_DEFAULTS;

/** A family a draft cites; a period given replaces the family's own. */
export type CitedFamily = Readonly<{ family: MeasureFamilyKey; period?: PeriodSelector }>;

type DefaultNode = Record<string, unknown> & { node_id: string };

/**
 * The nodes and outputs the cited families plan for each slot. One id per
 * (slot, figure, period), so families that read one figure share its node: a
 * revenue node that is only a margin's denominator is not an output.
 */
export function expandMeasureDefaults(
  slots: ReadonlyArray<string>,
  cited: ReadonlyArray<CitedFamily>,
): { operations: DefaultNode[]; outputs: Array<{ output_id: string; node_id: string }> } {
  const operations = new Map<string, DefaultNode>();
  const shown = new Set<string>();
  for (const slot of slots) {
    const metric = (metricKey: MetricKey, period: PeriodSelector) => {
      const id = defaultNodeId(slot, metricKey, period);
      if (!operations.has(id)) operations.set(id, { node_id: id, operation: "reported_metric", subject_slot: slot, metric_key: metricKey, period });
      return id;
    };
    for (const { family: key, period: requested } of cited) {
      const family: MeasureFamily = MEASURE_DEFAULTS[key];
      for (const period of requested ? [requested] : family.periods) {
        for (const metricKey of family.metrics) shown.add(metric(metricKey, period));
        for (const { margin, numerator } of family.margins) {
          const id = defaultNodeId(slot, margin, period);
          operations.set(id, { node_id: id, operation: margin, numerator: metric(numerator, period), revenue: metric("revenue", period) });
          shown.add(id);
        }
      }
    }
  }
  return { operations: [...operations.values()], outputs: [...shown].map((id) => ({ output_id: `out_${id}`, node_id: id })) };
}

function defaultNodeId(slot: string, figure: string, period: PeriodSelector): string {
  switch (period.kind) {
    case "latest":
      return `${slot}_${figure}_latest_${period.period_type === "annual" ? "fy" : "q"}${period.offset}`;
    case "fiscal_period":
      return `${slot}_${figure}_fy${period.fiscal_year}_${period.fiscal_period.toLowerCase()}`;
    case "at_cutoff":
      return `${slot}_${figure}_at_cutoff`;
  }
}

/**
 * The answer's note for the families a saved plan was expanded from: one
 * sentence per family over the periods it was read for. A record from another
 * table version, or of a family this table lacks, is disclosed without naming
 * figures this table would plan. Null when the plan cited no family.
 */
export function measureDefaultsNote(records: ReadonlyArray<MeasureDefaultRecord>): string | null {
  if (records.length === 0) return null;
  const periods = new Map<MeasureFamilyKey, Map<string, PeriodSelector>>();
  let unknown = false;
  for (const record of records) {
    if (record.table_version !== MEASURE_DEFAULTS_VERSION || !Object.hasOwn(MEASURE_DEFAULTS, record.family)) {
      unknown = true;
      continue;
    }
    const key = record.family as MeasureFamilyKey;
    const read = periods.get(key) ?? new Map<string, PeriodSelector>();
    for (const period of record.period === "default" ? MEASURE_DEFAULTS[key].periods : [record.requested_period]) read.set(canonicalJson(period), period);
    periods.set(key, read);
  }
  const sentences = [...periods].map(([key, read]) => {
    const family: MeasureFamily = MEASURE_DEFAULTS[key];
    const label = `${family.label[0]!.toUpperCase()}${family.label.slice(1)}`;
    const reading = family.note === "shown"
      ? `${label} is shown`
      : `${label} is read as ${andList(family.metrics.map((metric) => inSentence(METRIC_CATALOG_V1.get(metric)!.label)))}${family.margins.length > 0 ? ", with their margins," : ""}`;
    return `${reading} for ${andList([...read.values()].map(periodWording))}.`;
  });
  if (unknown) sentences.push("Some figures are defaults the server chose.");
  return [...sentences, "Name a measure or a period to change it."].join(" ");
}

/** How a note names a period, whether a family's own or the one a request named. */
function periodWording(period: PeriodSelector): string {
  if (period.kind === "latest" && period.offset === 0) return period.period_type === "annual" ? "the latest fiscal year" : "the latest quarter";
  return `${period.kind === "latest" ? "the " : ""}${periodPhrase(period)}`;
}

function andList(items: ReadonlyArray<string>): string {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

function inSentence(label: string): string {
  return /\p{Ll}/u.test(label[1] ?? "") ? `${label[0]!.toLowerCase()}${label.slice(1)}` : label;
}
