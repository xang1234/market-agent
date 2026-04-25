// Metric mapper (spec §6.3.1).
//
// Resolves the `metric_key` strings carried by `StatementLine` to canonical
// `metric_id` UUIDs from the `metrics` table. Every normalized line MUST
// map to exactly one metric_id; an unmapped line would let a displayed
// number reach a surface without a row in `Fact`/`Computation`, violating
// I1 (no displayed number without a backing row).

import type { NormalizedStatement, StatementLine } from "./statement.ts";
import {
  assertInteger,
  assertMetricKey,
  assertOneOf,
  assertUuid,
} from "./validators.ts";

export type UnitClass =
  | "currency"
  | "currency_per_share"
  | "shares"
  | "ratio"
  | "pure"
  | "count";

export const UNIT_CLASSES: ReadonlyArray<UnitClass> = [
  "currency",
  "currency_per_share",
  "shares",
  "ratio",
  "pure",
  "count",
];

// `sum` for additive flow values (revenue, expenses, cash flows);
// `instantaneous` for balance-sheet point-in-time values;
// `weighted_average` for per-share denominators (EPS shares, etc.).
export type MetricAggregation = "sum" | "instantaneous" | "weighted_average";

export const METRIC_AGGREGATIONS: ReadonlyArray<MetricAggregation> = [
  "sum",
  "instantaneous",
  "weighted_average",
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

// `filing` = SEC EDGAR or equivalent issuer filings (primary source);
// `vendor` = third-party aggregator (secondary);
// `calculated` = derived from other facts via Computation rows.
export type CanonicalSourceClass = "filing" | "vendor" | "calculated";

export const CANONICAL_SOURCE_CLASSES: ReadonlyArray<CanonicalSourceClass> = [
  "filing",
  "vendor",
  "calculated",
];

export type MetricDefinition = {
  metric_id: string;
  metric_key: string;
  display_name: string;
  unit_class: UnitClass;
  aggregation: MetricAggregation;
  interpretation: MetricInterpretation;
  canonical_source_class: CanonicalSourceClass;
  definition_version: number;
  notes?: string;
};

export type MetricRegistry = {
  byKey: ReadonlyMap<string, MetricDefinition>;
};

export type MappedStatementLine = StatementLine & {
  metric_id: string;
};

export type MappedStatement = Omit<NormalizedStatement, "lines"> & {
  lines: ReadonlyArray<MappedStatementLine>;
};

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
  return Object.freeze({ byKey: freezeMap(byKey) });
}

export function resolveMetric(
  registry: MetricRegistry,
  metric_key: string,
): MetricDefinition {
  const def = registry.byKey.get(metric_key);
  if (!def) {
    throw new Error(
      `metric-mapper: unknown metric_key "${metric_key}" — not registered`,
    );
  }
  return def;
}

export function mapStatementLine(
  registry: MetricRegistry,
  line: StatementLine,
): MappedStatementLine {
  const def = resolveMetric(registry, line.metric_key);
  if (line.unit !== def.unit_class) {
    throw new Error(
      `metric-mapper: line metric_key="${line.metric_key}" unit "${line.unit}" disagrees with metric.unit_class "${def.unit_class}"`,
    );
  }
  return Object.freeze({ ...line, metric_id: def.metric_id });
}

export function mapStatementLines(
  registry: MetricRegistry,
  lines: ReadonlyArray<StatementLine>,
): ReadonlyArray<MappedStatementLine> {
  const mapped: MappedStatementLine[] = [];
  for (const line of lines) {
    mapped.push(mapStatementLine(registry, line));
  }
  return Object.freeze(mapped);
}

export function mapStatement(
  registry: MetricRegistry,
  statement: NormalizedStatement,
): MappedStatement {
  return Object.freeze({
    ...statement,
    lines: mapStatementLines(registry, statement.lines),
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
  if (d.notes !== undefined && typeof d.notes !== "string") {
    throw new Error(`${label}.notes: must be a string when present`);
  }
}

function freezeDefinition(d: MetricDefinition): MetricDefinition {
  const out: MetricDefinition = {
    metric_id: d.metric_id,
    metric_key: d.metric_key,
    display_name: d.display_name,
    unit_class: d.unit_class,
    aggregation: d.aggregation,
    interpretation: d.interpretation,
    canonical_source_class: d.canonical_source_class,
    definition_version: d.definition_version,
  };
  if (d.notes !== undefined) out.notes = d.notes;
  return Object.freeze(out);
}

function freezeMap<K, V>(m: Map<K, V>): ReadonlyMap<K, V> {
  // Map.set on a frozen Map is silently ignored in non-strict mode and
  // throws in strict — but we need belt-and-suspenders against the JS
  // freezing-Map gotcha (Object.freeze freezes properties, not the
  // internal slot). Wrap in a thin proxy that throws on writes.
  const readonly: ReadonlyMap<K, V> = {
    get size() {
      return m.size;
    },
    get: (k) => m.get(k),
    has: (k) => m.has(k),
    keys: () => m.keys(),
    values: () => m.values(),
    entries: () => m.entries(),
    forEach: (cb, thisArg) => m.forEach(cb, thisArg),
    [Symbol.iterator]: () => m[Symbol.iterator](),
  };
  return Object.freeze(readonly);
}
