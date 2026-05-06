// Metric mapper (spec §6.3.1).
//
// Resolves the `metric_key` strings carried by `StatementLine` to canonical
// `metric_id` UUIDs from the `metrics` table. Every normalized line MUST
// map to exactly one metric_id; an unmapped line would let a displayed
// number reach a surface without a row in `Fact`/`Computation`, violating
// I1 (no displayed number without a backing row).
//
// The enum vocabularies below mirror `db/seed/metrics.sql` so a registry
// built in code is byte-compatible with one loaded from the seeded table.

import type { NormalizedStatement, StatementLine } from "./statement.ts";
import {
  assertInteger,
  assertMetricKey,
  assertOneOf,
  assertUuid,
} from "./validators.ts";

export type UnitClass =
  | "currency"
  | "percent"
  | "count"
  | "ratio"
  | "duration"
  | "enum";

export const UNIT_CLASSES: ReadonlyArray<UnitClass> = [
  "currency",
  "percent",
  "count",
  "ratio",
  "duration",
  "enum",
];

export type MetricAggregation =
  | "sum"
  | "avg"
  | "point_in_time"
  | "ttm"
  | "yoy"
  | "qoq"
  | "derived";

export const METRIC_AGGREGATIONS: ReadonlyArray<MetricAggregation> = [
  "sum",
  "avg",
  "point_in_time",
  "ttm",
  "yoy",
  "qoq",
  "derived",
];

export type MetricInterpretation =
  | "higher_is_better"
  | "lower_is_better"
  | "neutral";

export const METRIC_INTERPRETATIONS: ReadonlyArray<MetricInterpretation> = [
  "higher_is_better",
  "lower_is_better",
  "neutral",
];

export type CanonicalSourceClass =
  | "gaap"
  | "ifrs"
  | "vendor"
  | "market"
  | "derived";

export const CANONICAL_SOURCE_CLASSES: ReadonlyArray<CanonicalSourceClass> = [
  "gaap",
  "ifrs",
  "vendor",
  "market",
  "derived",
];

// `metric.unit_class` and `line.unit` are intentionally separate vocabularies:
// `unit_class` is the canonical *category* (a `currency` metric like net
// income), and `line.unit` is the *transport shape* of a specific reported
// value (raw `currency` for net income, `currency_per_share` for EPS — both
// roll up to a `currency`-class metric). The mapper enforces this
// compatibility so a `shares` line cannot silently attach a `currency`
// metric_id and corrupt aggregations downstream.
const COMPATIBLE_LINE_UNITS: Readonly<Record<UnitClass, ReadonlyArray<string>>> = {
  currency: ["currency", "currency_per_share"],
  percent: ["pure"],
  count: ["count", "shares"],
  ratio: ["ratio", "pure"],
  duration: ["days", "months", "years"],
  enum: ["enum"],
};

export type MetricDefinition = {
  metric_id: string;
  metric_key: string;
  display_name: string;
  unit_class: UnitClass;
  aggregation: MetricAggregation;
  interpretation: MetricInterpretation;
  canonical_source_class: CanonicalSourceClass;
  definition_version: number;
  notes: string | null;
};

export type MetricRegistry = {
  byKey: ReadonlyMap<string, MetricDefinition>;
};

export type MappedStatementLine = StatementLine & {
  metric_id: string;
  canonical_source_class: CanonicalSourceClass;
};

export type MappedStatement = Omit<NormalizedStatement, "lines"> & {
  lines: ReadonlyArray<MappedStatementLine>;
};

export type MetricMappingOptions = Readonly<{
  canonical_source_class?: CanonicalSourceClass;
}>;

export function createMetricRegistry(
  definitions: ReadonlyArray<MetricDefinition>,
): MetricRegistry {
  const byKey = new Map<string, MetricDefinition>();
  const byId = new Set<string>();
  for (let i = 0; i < definitions.length; i++) {
    const def = definitions[i];
    assertMetricDefinition(def, `createMetricRegistry.definitions[${i}]`);
    if (byKey.has(def.metric_key)) {
      throw new Error(
        `createMetricRegistry: duplicate metric_key "${def.metric_key}"`,
      );
    }
    if (byId.has(def.metric_id)) {
      throw new Error(
        `createMetricRegistry: duplicate metric_id "${def.metric_id}" (key="${def.metric_key}")`,
      );
    }
    byKey.set(def.metric_key, freezeDefinition(def));
    byId.add(def.metric_id);
  }
  return Object.freeze({ byKey: byKey as ReadonlyMap<string, MetricDefinition> });
}

export function resolveMetric(
  registry: MetricRegistry,
  metric_key: string,
  options: MetricMappingOptions = {},
): MetricDefinition {
  const def = registry.byKey.get(metric_key);
  if (!def) {
    throw new Error(
      `metric-mapper: unknown metric_key "${metric_key}" — not registered`,
    );
  }
  if (
    options.canonical_source_class !== undefined &&
    def.canonical_source_class !== options.canonical_source_class
  ) {
    throw new Error(
      `metric-mapper: metric_key="${metric_key}" canonical_source_class "${def.canonical_source_class}" does not match required "${options.canonical_source_class}"`,
    );
  }
  return def;
}

export function mapStatementLine(
  registry: MetricRegistry,
  line: StatementLine,
  options: MetricMappingOptions = {},
): MappedStatementLine {
  const def = resolveMetric(registry, line.metric_key, options);
  const allowed = COMPATIBLE_LINE_UNITS[def.unit_class];
  if (!allowed.includes(line.unit)) {
    throw new Error(
      `metric-mapper: line metric_key="${line.metric_key}" unit "${line.unit}" not compatible with metric.unit_class "${def.unit_class}" (allowed: ${allowed.join(", ")})`,
    );
  }
  return Object.freeze({
    ...line,
    metric_id: def.metric_id,
    canonical_source_class: def.canonical_source_class,
  });
}

export function mapStatementLines(
  registry: MetricRegistry,
  lines: ReadonlyArray<StatementLine>,
  options: MetricMappingOptions = {},
): ReadonlyArray<MappedStatementLine> {
  return Object.freeze(lines.map((l) => mapStatementLine(registry, l, options)));
}

export function mapStatement(
  registry: MetricRegistry,
  statement: NormalizedStatement,
  options: MetricMappingOptions = {},
): MappedStatement {
  return Object.freeze({
    ...statement,
    lines: mapStatementLines(registry, statement.lines, options),
  });
}

export function assertMetricDefinition(
  value: unknown,
  label: string,
): asserts value is MetricDefinition {
  if (!value || typeof value !== "object") {
    throw new Error(`${label}: must be a MetricDefinition object`);
  }
  const d = value as Record<string, unknown>;
  assertUuid(d.metric_id, `${label}.metric_id`);
  assertMetricKey(d.metric_key, `${label}.metric_key`);
  if (typeof d.display_name !== "string" || d.display_name.length === 0) {
    throw new Error(`${label}.display_name: must be a non-empty string`);
  }
  assertOneOf(d.unit_class, UNIT_CLASSES, `${label}.unit_class`);
  assertOneOf(d.aggregation, METRIC_AGGREGATIONS, `${label}.aggregation`);
  assertOneOf(
    d.interpretation,
    METRIC_INTERPRETATIONS,
    `${label}.interpretation`,
  );
  assertOneOf(
    d.canonical_source_class,
    CANONICAL_SOURCE_CLASSES,
    `${label}.canonical_source_class`,
  );
  assertInteger(d.definition_version, `${label}.definition_version`);
  if (d.definition_version < 1) {
    throw new Error(
      `${label}.definition_version: must be >= 1; received ${d.definition_version}`,
    );
  }
  if (d.notes !== null && typeof d.notes !== "string") {
    throw new Error(`${label}.notes: must be a string or null`);
  }
}

function freezeDefinition(d: MetricDefinition): MetricDefinition {
  return Object.freeze({
    metric_id: d.metric_id,
    metric_key: d.metric_key,
    display_name: d.display_name,
    unit_class: d.unit_class,
    aggregation: d.aggregation,
    interpretation: d.interpretation,
    canonical_source_class: d.canonical_source_class,
    definition_version: d.definition_version,
    notes: d.notes,
  });
}
