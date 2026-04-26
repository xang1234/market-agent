import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSegmentFacts,
  type BuildSegmentFactsInput,
  type ConsolidatedTotalInput,
  type SegmentDefinitionInput,
  type SegmentFactInput,
} from "../src/segment-facts.ts";
import { aaplIssuer, AAPL_FY2024_KNOWN_VALUES, SEC_EDGAR_SOURCE_ID } from "./fixtures.ts";

const REVENUE_METRIC_ID = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaa0003"; // net_sales.total in fixtures
const SEGMENT_REVENUE_PRODUCTS_ID = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaa0001";
const SEGMENT_REVENUE_SERVICES_ID = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaa0002";

const AAPL_FY2024_PRODUCTS = 294_866_000_000;
const AAPL_FY2024_SERVICES = 96_169_000_000;

// AAPL FY2024 10-K disclosed geographic segment net sales (USD).
// Sum = 391,035M = AAPL_FY2024_KNOWN_VALUES.net_sales_total.
const AAPL_FY2024_GEO = {
  americas: 167_045_000_000,
  europe: 101_328_000_000,
  greater_china: 66_952_000_000,
  japan: 25_052_000_000,
  rest_of_asia_pacific: 30_658_000_000,
} as const;

function envelopeBase(): Pick<
  BuildSegmentFactsInput,
  | "subject"
  | "basis"
  | "period_kind"
  | "period_start"
  | "period_end"
  | "fiscal_year"
  | "fiscal_period"
  | "reporting_currency"
  | "as_of"
> {
  return {
    subject: aaplIssuer,
    basis: "as_reported",
    period_kind: "fiscal_y",
    period_start: "2023-10-01",
    period_end: "2024-09-28",
    fiscal_year: 2024,
    fiscal_period: "FY",
    reporting_currency: "USD",
    as_of: "2024-11-01T20:30:00.000Z",
  };
}

function businessDef(
  id: string,
  name: string,
  overrides: Partial<SegmentDefinitionInput> = {},
): SegmentDefinitionInput {
  return {
    segment_id: id,
    segment_name: name,
    definition_as_of: "2020-09-26",
    ...overrides,
  };
}

function revenueFact(
  segment_id: string,
  value: number,
  overrides: Partial<SegmentFactInput> = {},
): SegmentFactInput {
  return {
    segment_id,
    metric_key: "net_sales.products",
    metric_id: SEGMENT_REVENUE_PRODUCTS_ID,
    value_num: value / 1_000_000,
    scale: 1_000_000,
    unit: "currency",
    currency: "USD",
    coverage_level: "full",
    source_id: SEC_EDGAR_SOURCE_ID,
    as_of: "2024-11-01T20:30:00.000Z",
    ...overrides,
  };
}

function consolidatedTotal(
  overrides: Partial<ConsolidatedTotalInput> = {},
): ConsolidatedTotalInput {
  return {
    metric_key: "net_sales.products",
    metric_id: REVENUE_METRIC_ID,
    value_num: AAPL_FY2024_KNOWN_VALUES.net_sales_total,
    scale: 1,
    unit: "currency",
    currency: "USD",
    source_id: SEC_EDGAR_SOURCE_ID,
    as_of: "2024-11-01T20:30:00.000Z",
    ...overrides,
  };
}

test("buildSegmentFacts preserves AAPL Products and Services as separate facts on the business axis", () => {
  const envelope = buildSegmentFacts({
    ...envelopeBase(),
    axis: "business",
    segment_definitions: [
      businessDef("biz_products", "Products"),
      businessDef("biz_services", "Services"),
    ],
    facts: [
      revenueFact("biz_products", AAPL_FY2024_PRODUCTS, {
        metric_key: "net_sales.products",
        metric_id: SEGMENT_REVENUE_PRODUCTS_ID,
      }),
      revenueFact("biz_services", AAPL_FY2024_SERVICES, {
        metric_key: "net_sales.services",
        metric_id: SEGMENT_REVENUE_SERVICES_ID,
      }),
    ],
  });

  assert.equal(envelope.family, "segment_facts");
  assert.equal(envelope.axis, "business");
  assert.equal(envelope.basis, "as_reported");
  assert.equal(envelope.period_kind, "fiscal_y");
  assert.equal(envelope.period_start, "2023-10-01");
  assert.equal(envelope.period_end, "2024-09-28");
  assert.equal(envelope.fiscal_year, 2024);
  assert.equal(envelope.fiscal_period, "FY");
  assert.equal(envelope.reporting_currency, "USD");
  assert.deepEqual(envelope.subject, aaplIssuer);
  assert.deepEqual(
    envelope.segment_definitions.map((d) => [d.segment_id, d.segment_name]),
    [["biz_products", "Products"], ["biz_services", "Services"]],
  );
  assert.deepEqual(
    envelope.facts.map((f) => [f.segment_id, f.metric_key, f.value_num, f.currency]),
    [
      ["biz_products", "net_sales.products", AAPL_FY2024_PRODUCTS, "USD"],
      ["biz_services", "net_sales.services", AAPL_FY2024_SERVICES, "USD"],
    ],
  );
  assert.deepEqual(envelope.coverage_warnings, []);
});

test("buildSegmentFacts reconciles top-level segments to a consolidated total without warnings", () => {
  const envelope = buildSegmentFacts({
    ...envelopeBase(),
    axis: "business",
    segment_definitions: [
      businessDef("biz_products", "Products"),
      businessDef("biz_services", "Services"),
    ],
    facts: [
      revenueFact("biz_products", AAPL_FY2024_PRODUCTS, { metric_key: "revenue" }),
      revenueFact("biz_services", AAPL_FY2024_SERVICES, { metric_key: "revenue" }),
    ],
    consolidated_totals: [consolidatedTotal({ metric_key: "revenue" })],
  });
  assert.deepEqual(envelope.coverage_warnings, []);
});

test("buildSegmentFacts emits reconciliation_gap when segment sums miss the consolidated total", () => {
  const envelope = buildSegmentFacts({
    ...envelopeBase(),
    axis: "business",
    segment_definitions: [
      businessDef("biz_products", "Products"),
      businessDef("biz_services", "Services"),
    ],
    facts: [
      revenueFact("biz_products", AAPL_FY2024_PRODUCTS, { metric_key: "revenue" }),
      revenueFact("biz_services", AAPL_FY2024_SERVICES, { metric_key: "revenue" }),
    ],
    consolidated_totals: [
      consolidatedTotal({ metric_key: "revenue", value_num: 400_000_000_000 }),
    ],
  });
  assert.deepEqual(envelope.coverage_warnings, [
    {
      code: "reconciliation_gap",
      metric_key: "revenue",
      message: `metric "revenue" sum of top-level segments (${AAPL_FY2024_PRODUCTS + AAPL_FY2024_SERVICES}) does not match consolidated total (400000000000).`,
    },
  ]);
});

test("buildSegmentFacts excludes child segments from reconciliation so parent totals don't double-count", () => {
  const envelope = buildSegmentFacts({
    ...envelopeBase(),
    axis: "business",
    segment_definitions: [
      businessDef("biz_products", "Products"),
      businessDef("biz_services", "Services"),
      businessDef("biz_services_apple_music", "Apple Music", {
        parent_segment_id: "biz_services",
      }),
    ],
    facts: [
      revenueFact("biz_products", AAPL_FY2024_PRODUCTS, { metric_key: "revenue" }),
      revenueFact("biz_services", AAPL_FY2024_SERVICES, { metric_key: "revenue" }),
      revenueFact("biz_services_apple_music", 12_000_000_000, { metric_key: "revenue" }),
    ],
    consolidated_totals: [consolidatedTotal({ metric_key: "revenue" })],
  });
  assert.equal(
    envelope.coverage_warnings.find((w) => w.code === "reconciliation_gap"),
    undefined,
  );
});

test("buildSegmentFacts flags facts that reference an undeclared segment_id", () => {
  const envelope = buildSegmentFacts({
    ...envelopeBase(),
    axis: "business",
    segment_definitions: [businessDef("biz_products", "Products")],
    facts: [
      revenueFact("biz_products", AAPL_FY2024_PRODUCTS, { metric_key: "revenue" }),
      revenueFact("biz_unknown", 50_000_000_000, { metric_key: "revenue" }),
    ],
  });
  assert.deepEqual(
    envelope.coverage_warnings.filter((w) => w.code === "fact_without_definition"),
    [
      {
        code: "fact_without_definition",
        segment_id: "biz_unknown",
        metric_key: "revenue",
        message: `fact references segment_id "biz_unknown" with no matching segment definition.`,
      },
    ],
  );
});

test("buildSegmentFacts flags definitions that have no backing fact", () => {
  const envelope = buildSegmentFacts({
    ...envelopeBase(),
    axis: "business",
    segment_definitions: [
      businessDef("biz_products", "Products"),
      businessDef("biz_services", "Services"),
      businessDef("biz_wearables", "Wearables", { definition_as_of: "2024-09-28" }),
    ],
    facts: [
      revenueFact("biz_products", AAPL_FY2024_PRODUCTS, { metric_key: "revenue" }),
      revenueFact("biz_services", AAPL_FY2024_SERVICES, { metric_key: "revenue" }),
    ],
  });
  assert.deepEqual(
    envelope.coverage_warnings.filter((w) => w.code === "definition_without_fact"),
    [
      {
        code: "definition_without_fact",
        segment_id: "biz_wearables",
        message: `segment "biz_wearables" is defined but has no fact in this envelope.`,
      },
    ],
  );
});

test("buildSegmentFacts flags duplicate (segment, metric) facts so callers don't silently keep one", () => {
  const envelope = buildSegmentFacts({
    ...envelopeBase(),
    axis: "business",
    segment_definitions: [businessDef("biz_products", "Products")],
    facts: [
      revenueFact("biz_products", AAPL_FY2024_PRODUCTS, { metric_key: "revenue" }),
      revenueFact("biz_products", AAPL_FY2024_PRODUCTS + 1, { metric_key: "revenue" }),
    ],
  });
  assert.deepEqual(
    envelope.coverage_warnings.filter((w) => w.code === "duplicate_segment_metric"),
    [
      {
        code: "duplicate_segment_metric",
        segment_id: "biz_products",
        metric_key: "revenue",
        message: `segment "biz_products" has multiple facts for metric_key "revenue"; all copies retained in facts.`,
      },
    ],
  );
  assert.equal(envelope.facts.length, 2);
});

test("buildSegmentFacts refuses implicit FX by emitting currency_mismatch on facts", () => {
  const envelope = buildSegmentFacts({
    ...envelopeBase(),
    axis: "business",
    segment_definitions: [businessDef("biz_services", "Services")],
    facts: [
      revenueFact("biz_services", AAPL_FY2024_SERVICES, {
        metric_key: "revenue",
        currency: "EUR",
      }),
    ],
  });
  assert.deepEqual(
    envelope.coverage_warnings.filter((w) => w.code === "currency_mismatch"),
    [
      {
        code: "currency_mismatch",
        segment_id: "biz_services",
        metric_key: "revenue",
        message:
          'segment "biz_services" metric "revenue" currency EUR does not match envelope reporting_currency USD.',
      },
    ],
  );
});

test("buildSegmentFacts emits null_segment_value and coverage_incomplete instead of fabricating zeros", () => {
  const envelope = buildSegmentFacts({
    ...envelopeBase(),
    axis: "business",
    segment_definitions: [businessDef("biz_products", "Products")],
    facts: [
      revenueFact("biz_products", 0, {
        metric_key: "revenue",
        value_num: null,
        coverage_level: "sparse",
      }),
    ],
  });
  assert.equal(envelope.facts[0].value_num, null);
  assert.equal(envelope.facts[0].coverage_level, "sparse");
  assert.deepEqual(envelope.coverage_warnings, [
    {
      code: "null_segment_value",
      segment_id: "biz_products",
      metric_key: "revenue",
      message: `segment "biz_products" metric "revenue" has null value_num.`,
    },
    {
      code: "coverage_incomplete",
      segment_id: "biz_products",
      metric_key: "revenue",
      message: `segment "biz_products" metric "revenue" coverage is sparse.`,
    },
  ]);
});

test("buildSegmentFacts emits stale_segment_definition under explicit freshness policy", () => {
  const envelope = buildSegmentFacts({
    ...envelopeBase(),
    axis: "business",
    segment_definitions: [businessDef("biz_products", "Products", { definition_as_of: "2018-09-29" })],
    facts: [revenueFact("biz_products", AAPL_FY2024_PRODUCTS, { metric_key: "revenue" })],
    freshness_policy: {
      as_of: "2024-11-01T20:30:00.000Z",
      max_segment_definition_age_ms: 365 * 24 * 60 * 60 * 1000,
    },
  });
  const stale = envelope.coverage_warnings.find((w) => w.code === "stale_segment_definition");
  assert.ok(stale, "expected stale_segment_definition warning");
  assert.equal(stale.segment_id, "biz_products");
  assert.match(stale.message, /definition_as_of 2018-09-29 is older than freshness policy by/);
});

test("buildSegmentFacts preserves AAPL geographic segments separately and reconciles to total", () => {
  const envelope = buildSegmentFacts({
    ...envelopeBase(),
    axis: "geography",
    segment_definitions: [
      businessDef("geo_americas", "Americas"),
      businessDef("geo_europe", "Europe"),
      businessDef("geo_greater_china", "Greater China"),
      businessDef("geo_japan", "Japan"),
      businessDef("geo_rest_of_asia_pacific", "Rest of Asia Pacific"),
    ],
    facts: [
      revenueFact("geo_americas", AAPL_FY2024_GEO.americas, { metric_key: "revenue" }),
      revenueFact("geo_europe", AAPL_FY2024_GEO.europe, { metric_key: "revenue" }),
      revenueFact("geo_greater_china", AAPL_FY2024_GEO.greater_china, { metric_key: "revenue" }),
      revenueFact("geo_japan", AAPL_FY2024_GEO.japan, { metric_key: "revenue" }),
      revenueFact("geo_rest_of_asia_pacific", AAPL_FY2024_GEO.rest_of_asia_pacific, { metric_key: "revenue" }),
    ],
    consolidated_totals: [consolidatedTotal({ metric_key: "revenue" })],
  });

  assert.equal(envelope.axis, "geography");
  assert.deepEqual(
    envelope.facts.map((f) => [f.segment_id, f.value_num]),
    [
      ["geo_americas", AAPL_FY2024_GEO.americas],
      ["geo_europe", AAPL_FY2024_GEO.europe],
      ["geo_greater_china", AAPL_FY2024_GEO.greater_china],
      ["geo_japan", AAPL_FY2024_GEO.japan],
      ["geo_rest_of_asia_pacific", AAPL_FY2024_GEO.rest_of_asia_pacific],
    ],
  );
  assert.deepEqual(envelope.coverage_warnings, []);
});

test("buildSegmentFacts flags an unknown_parent_segment when a definition references a nonexistent parent", () => {
  const envelope = buildSegmentFacts({
    ...envelopeBase(),
    axis: "business",
    segment_definitions: [
      businessDef("biz_products", "Products"),
      businessDef("biz_apple_music", "Apple Music", { parent_segment_id: "biz_services" }),
    ],
    facts: [
      revenueFact("biz_products", AAPL_FY2024_PRODUCTS, { metric_key: "revenue" }),
      revenueFact("biz_apple_music", 12_000_000_000, { metric_key: "revenue" }),
    ],
  });
  const warning = envelope.coverage_warnings.find((w) => w.code === "unknown_parent_segment");
  assert.deepEqual(warning, {
    code: "unknown_parent_segment",
    segment_id: "biz_apple_music",
    message:
      'segment "biz_apple_music" references unknown parent_segment_id "biz_services".',
  });
});

test("buildSegmentFacts flags a consolidated total whose currency disagrees with the envelope", () => {
  const envelope = buildSegmentFacts({
    ...envelopeBase(),
    axis: "business",
    segment_definitions: [businessDef("biz_products", "Products")],
    facts: [revenueFact("biz_products", AAPL_FY2024_PRODUCTS, { metric_key: "revenue" })],
    consolidated_totals: [
      consolidatedTotal({ metric_key: "revenue", currency: "EUR" }),
    ],
  });
  assert.deepEqual(
    envelope.coverage_warnings.filter((w) => w.code === "currency_mismatch"),
    [
      {
        code: "currency_mismatch",
        metric_key: "revenue",
        message:
          'consolidated_total metric "revenue" currency EUR does not match envelope reporting_currency USD.',
      },
    ],
  );
});

test("buildSegmentFacts rejects a non-issuer subject", () => {
  assert.throws(
    () =>
      buildSegmentFacts({
        ...envelopeBase(),
        subject: { kind: "instrument", id: aaplIssuer.id } as never,
        axis: "business",
        segment_definitions: [businessDef("biz_products", "Products")],
        facts: [revenueFact("biz_products", AAPL_FY2024_PRODUCTS, { metric_key: "revenue" })],
      }),
    /segmentFacts.subject: must be an issuer SubjectRef/,
  );
});

test("buildSegmentFacts rejects an axis outside the registered enum", () => {
  assert.throws(
    () =>
      buildSegmentFacts({
        ...envelopeBase(),
        axis: "product_line" as never,
        segment_definitions: [businessDef("biz_products", "Products")],
        facts: [revenueFact("biz_products", AAPL_FY2024_PRODUCTS, { metric_key: "revenue" })],
      }),
    /segmentFacts.axis: must be one of business, geography/,
  );
});

test("buildSegmentFacts rejects period_kind=point because segment slices are flow concepts, not balances", () => {
  assert.throws(
    () =>
      buildSegmentFacts({
        ...envelopeBase(),
        period_kind: "point" as never,
        axis: "business",
        segment_definitions: [],
        facts: [],
      }),
    /segmentFacts.period_kind: must be one of fiscal_q, fiscal_y, ttm/,
  );
});

test("buildSegmentFacts emits reconciliation_gap when a consolidated total has no matching segment facts", () => {
  const envelope = buildSegmentFacts({
    ...envelopeBase(),
    axis: "business",
    segment_definitions: [businessDef("biz_products", "Products")],
    facts: [revenueFact("biz_products", AAPL_FY2024_PRODUCTS, { metric_key: "revenue" })],
    consolidated_totals: [
      consolidatedTotal({
        metric_key: "operating_income",
        value_num: 123_216_000_000,
      }),
    ],
  });
  assert.deepEqual(
    envelope.coverage_warnings.filter((w) => w.code === "reconciliation_gap"),
    [
      {
        code: "reconciliation_gap",
        metric_key: "operating_income",
        message:
          'metric "operating_income" has no top-level segment facts to reconcile against consolidated total 123216000000.',
      },
    ],
  );
});

test("buildSegmentFacts honours the scale field on consolidated_totals so callers can pass pre-scaled values", () => {
  // 391_035 millions × scale 1_000_000 = 391_035_000_000 native USD —
  // matches the sum of business-segment facts to the cent.
  const envelope = buildSegmentFacts({
    ...envelopeBase(),
    axis: "business",
    segment_definitions: [
      businessDef("biz_products", "Products"),
      businessDef("biz_services", "Services"),
    ],
    facts: [
      revenueFact("biz_products", AAPL_FY2024_PRODUCTS, { metric_key: "revenue" }),
      revenueFact("biz_services", AAPL_FY2024_SERVICES, { metric_key: "revenue" }),
    ],
    consolidated_totals: [
      consolidatedTotal({
        metric_key: "revenue",
        value_num: 391_035,
        scale: 1_000_000,
      }),
    ],
  });
  assert.deepEqual(envelope.coverage_warnings, []);
});

test("buildSegmentFacts treats definition_as_of as end-of-day so a same-day policy reference is not flagged stale", () => {
  const envelope = buildSegmentFacts({
    ...envelopeBase(),
    axis: "business",
    segment_definitions: [
      businessDef("biz_products", "Products", { definition_as_of: "2024-11-01" }),
    ],
    facts: [revenueFact("biz_products", AAPL_FY2024_PRODUCTS, { metric_key: "revenue" })],
    freshness_policy: {
      as_of: "2024-11-01T20:30:00.000Z",
      max_segment_definition_age_ms: 60 * 60 * 1000, // 1h
    },
  });
  assert.equal(
    envelope.coverage_warnings.find((w) => w.code === "stale_segment_definition"),
    undefined,
  );
});

test("buildSegmentFacts rejects duplicate segment_definitions before any fact processing", () => {
  assert.throws(
    () =>
      buildSegmentFacts({
        ...envelopeBase(),
        axis: "business",
        segment_definitions: [
          businessDef("biz_products", "Products"),
          businessDef("biz_products", "Products (dup)"),
        ],
        facts: [],
      }),
    /duplicate segment_id "biz_products"/,
  );
});

test("buildSegmentFacts is referentially safe — output is deeply frozen so callers cannot mutate envelope state", () => {
  const envelope = buildSegmentFacts({
    ...envelopeBase(),
    axis: "business",
    segment_definitions: [businessDef("biz_products", "Products")],
    facts: [revenueFact("biz_products", AAPL_FY2024_PRODUCTS, { metric_key: "revenue" })],
  });
  assert.ok(Object.isFrozen(envelope));
  assert.ok(Object.isFrozen(envelope.facts));
  assert.ok(Object.isFrozen(envelope.facts[0]));
  assert.ok(Object.isFrozen(envelope.segment_definitions));
  assert.ok(Object.isFrozen(envelope.segment_definitions[0]));
  assert.ok(Object.isFrozen(envelope.coverage_warnings));
});

