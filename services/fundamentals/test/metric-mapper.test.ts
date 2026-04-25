import test from "node:test";
import assert from "node:assert/strict";
import {
  assertMetricDefinition,
  createMetricRegistry,
  mapStatement,
  mapStatementLine,
  mapStatementLines,
  resolveMetric,
  type MetricDefinition,
  type MetricRegistry,
} from "../src/metric-mapper.ts";
import { normalizedStatement, type StatementLine } from "../src/statement.ts";
import {
  AAPL_INCOME_METRIC_DEFINITIONS,
  aaplFy2024IncomeStatementInput,
  aaplIncomeMetricRegistry,
} from "./fixtures.ts";

// --- Acceptance: AAPL FY2024 income statement maps to expected metric_ids -

test("AAPL FY2024 income statement: every line resolves to its expected metric_id", () => {
  const registry = aaplIncomeMetricRegistry();
  const statement = normalizedStatement(aaplFy2024IncomeStatementInput());
  const mapped = mapStatement(registry, statement);

  // Spot-check a few lines against the canonical UUID assignments in the
  // fixture; the contract is "every line resolves to exactly one id", so
  // the full check is the post-loop length+id-set assertion below.
  const byKey = new Map(mapped.lines.map((l) => [l.metric_key, l]));
  assert.equal(
    byKey.get("net_sales.total")!.metric_id,
    "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaa0003",
  );
  assert.equal(
    byKey.get("net_income")!.metric_id,
    "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaa000f",
  );
  assert.equal(
    byKey.get("eps.diluted")!.metric_id,
    "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaa0011",
  );

  // Every line in the original statement maps to exactly one metric_id, no
  // collisions, no losses. Set sizes match line count → bijection.
  assert.equal(mapped.lines.length, statement.lines.length);
  const idSet = new Set(mapped.lines.map((l) => l.metric_id));
  assert.equal(idSet.size, mapped.lines.length);
});

test("mapStatement preserves all NormalizedStatement fields except lines", () => {
  const registry = aaplIncomeMetricRegistry();
  const statement = normalizedStatement(aaplFy2024IncomeStatementInput());
  const mapped = mapStatement(registry, statement);

  assert.equal(mapped.subject, statement.subject);
  assert.equal(mapped.family, statement.family);
  assert.equal(mapped.basis, statement.basis);
  assert.equal(mapped.period_kind, statement.period_kind);
  assert.equal(mapped.period_start, statement.period_start);
  assert.equal(mapped.period_end, statement.period_end);
  assert.equal(mapped.fiscal_year, statement.fiscal_year);
  assert.equal(mapped.fiscal_period, statement.fiscal_period);
  assert.equal(mapped.reporting_currency, statement.reporting_currency);
  assert.equal(mapped.as_of, statement.as_of);
  assert.equal(mapped.reported_at, statement.reported_at);
  assert.equal(mapped.source_id, statement.source_id);
});

test("mapStatementLine carries through all StatementLine fields plus metric_id", () => {
  const registry = aaplIncomeMetricRegistry();
  const line: StatementLine = {
    metric_key: "net_sales.total",
    value_num: 391_035,
    unit: "currency",
    currency: "USD",
    scale: 1_000_000,
    coverage_level: "full",
  };
  const mapped = mapStatementLine(registry, line);

  assert.equal(mapped.metric_key, "net_sales.total");
  assert.equal(mapped.value_num, 391_035);
  assert.equal(mapped.unit, "currency");
  assert.equal(mapped.currency, "USD");
  assert.equal(mapped.scale, 1_000_000);
  assert.equal(mapped.coverage_level, "full");
  assert.equal(mapped.metric_id, "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaa0003");
});

// --- Resolution & error paths ----------------------------------------------

test("resolveMetric returns the registered MetricDefinition for known metric_keys", () => {
  const registry = aaplIncomeMetricRegistry();
  const def = resolveMetric(registry, "operating_income");
  assert.equal(def.metric_id, "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaa000b");
  assert.equal(def.display_name, "Operating income");
  assert.equal(def.unit_class, "currency");
});

test("resolveMetric throws on unknown metric_keys (every line must resolve)", () => {
  const registry = aaplIncomeMetricRegistry();
  assert.throws(
    () => resolveMetric(registry, "made_up_metric"),
    /unknown metric_key "made_up_metric"/,
  );
});

test("mapStatementLine rejects lines whose unit is not compatible with metric.unit_class", () => {
  const registry = aaplIncomeMetricRegistry();
  // net_sales.total is unit_class=currency; passing unit=shares is a category error.
  const bad: StatementLine = {
    metric_key: "net_sales.total",
    value_num: 1,
    unit: "shares",
    scale: 1,
    coverage_level: "full",
  };
  assert.throws(
    () => mapStatementLine(registry, bad),
    /unit "shares" not compatible with metric\.unit_class "currency"/,
  );
});

test("mapStatementLine accepts compatible-but-not-equal line.unit (e.g. currency_per_share for a currency-class metric)", () => {
  const registry = aaplIncomeMetricRegistry();
  // EPS metric is unit_class=currency; lines come in as currency_per_share.
  const epsLine: StatementLine = {
    metric_key: "eps.diluted",
    value_num: 6.08,
    unit: "currency_per_share",
    currency: "USD",
    scale: 1,
    coverage_level: "full",
  };
  const mapped = mapStatementLine(registry, epsLine);
  assert.equal(mapped.unit, "currency_per_share");
  assert.equal(mapped.metric_id, "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaa0011");

  // Share counts: line.unit="shares" rolls up to unit_class="count".
  const sharesLine: StatementLine = {
    metric_key: "weighted_average_shares.diluted",
    value_num: 15_408_095,
    unit: "shares",
    scale: 1_000,
    coverage_level: "full",
  };
  const sharesMapped = mapStatementLine(registry, sharesLine);
  assert.equal(sharesMapped.metric_id, "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaa0013");
});

test("mapStatementLines fails the whole batch if any line is unmapped", () => {
  const registry = aaplIncomeMetricRegistry();
  const lines: StatementLine[] = [
    {
      metric_key: "net_sales.total",
      value_num: 1,
      unit: "currency",
      currency: "USD",
      scale: 1,
      coverage_level: "full",
    },
    {
      metric_key: "this_does_not_exist",
      value_num: 2,
      unit: "currency",
      currency: "USD",
      scale: 1,
      coverage_level: "full",
    },
  ];
  assert.throws(() => mapStatementLines(registry, lines), /unknown metric_key/);
});

// --- Registry construction & contract --------------------------------------

test("createMetricRegistry rejects duplicate metric_keys", () => {
  const dup: MetricDefinition = {
    ...AAPL_INCOME_METRIC_DEFINITIONS[0],
    metric_id: "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbb0001",
  };
  assert.throws(
    () => createMetricRegistry([...AAPL_INCOME_METRIC_DEFINITIONS, dup]),
    /duplicate metric_key/,
  );
});

test("createMetricRegistry rejects duplicate metric_ids (would collide in the facts table)", () => {
  const dup: MetricDefinition = {
    ...AAPL_INCOME_METRIC_DEFINITIONS[0],
    metric_key: "different.key",
  };
  assert.throws(
    () => createMetricRegistry([...AAPL_INCOME_METRIC_DEFINITIONS, dup]),
    /duplicate metric_id/,
  );
});

test("assertMetricDefinition rejects malformed definitions", () => {
  const valid = AAPL_INCOME_METRIC_DEFINITIONS[0];

  assert.throws(
    () => assertMetricDefinition({ ...valid, metric_id: "not-a-uuid" }, "d"),
    /metric_id.*UUID v4/,
  );
  assert.throws(
    () => assertMetricDefinition({ ...valid, metric_key: "BadKey" }, "d"),
    /metric_key/,
  );
  assert.throws(
    () => assertMetricDefinition({ ...valid, display_name: "" }, "d"),
    /display_name/,
  );
  assert.throws(
    () => assertMetricDefinition({ ...valid, unit_class: "weird" }, "d"),
    /unit_class/,
  );
  assert.throws(
    () => assertMetricDefinition({ ...valid, aggregation: "median" }, "d"),
    /aggregation/,
  );
  assert.throws(
    () => assertMetricDefinition({ ...valid, definition_version: 0 }, "d"),
    /definition_version/,
  );

  // notes is `string | null` (matches the schema's nullable text column);
  // undefined and non-string values are rejected.
  assert.doesNotThrow(() =>
    assertMetricDefinition({ ...valid, notes: null }, "d"),
  );
  assert.doesNotThrow(() =>
    assertMetricDefinition({ ...valid, notes: "explanatory note" }, "d"),
  );
  assert.throws(
    () => assertMetricDefinition({ ...valid, notes: undefined }, "d"),
    /notes/,
  );
  assert.throws(
    () => assertMetricDefinition({ ...valid, notes: 42 }, "d"),
    /notes/,
  );
});

// --- Frozen value-object discipline ---------------------------------------

test("createMetricRegistry returns a frozen registry; per-definition entries are also frozen", () => {
  const registry = aaplIncomeMetricRegistry();
  assert.equal(Object.isFrozen(registry), true);
  for (const def of registry.byKey.values()) {
    assert.equal(Object.isFrozen(def), true);
  }
});

test("mapStatementLine returns a frozen MappedStatementLine", () => {
  const registry = aaplIncomeMetricRegistry();
  const line: StatementLine = {
    metric_key: "net_income",
    value_num: 93_736,
    unit: "currency",
    currency: "USD",
    scale: 1_000_000,
    coverage_level: "full",
  };
  const mapped = mapStatementLine(registry, line);
  assert.equal(Object.isFrozen(mapped), true);
});

test("mapStatement returns a frozen statement and frozen lines array", () => {
  const registry = aaplIncomeMetricRegistry();
  const statement = normalizedStatement(aaplFy2024IncomeStatementInput());
  const mapped = mapStatement(registry, statement);
  assert.equal(Object.isFrozen(mapped), true);
  assert.equal(Object.isFrozen(mapped.lines), true);
  for (const line of mapped.lines) {
    assert.equal(Object.isFrozen(line), true);
  }
});
