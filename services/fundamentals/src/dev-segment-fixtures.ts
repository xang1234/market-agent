import { DEV_ISSUER_PROFILES } from "./dev-fixtures.ts";
import { METRIC_ID } from "./dev-stats-fixtures.ts";
import type { BuildSegmentFactsInput, SegmentDefinitionInput, SegmentFactInput } from "./segment-facts.ts";
import type { SegmentsRepositoryRecord } from "./segments-repository.ts";
import type { UUID } from "./subject-ref.ts";

export const DEV_SEGMENT_FIXTURE_SOURCE_ID: UUID = "00000000-0000-4000-a000-000000000006";

const APPLE_ISSUER = DEV_ISSUER_PROFILES[0].subject;
const REVENUE_METRIC_ID = METRIC_ID.revenue;

const APPLE_BUSINESS_DEFINITIONS: ReadonlyArray<SegmentDefinitionInput> = [
  { segment_id: "iphone", segment_name: "iPhone", definition_as_of: "2024-09-28" },
  { segment_id: "mac", segment_name: "Mac", definition_as_of: "2024-09-28" },
  { segment_id: "ipad", segment_name: "iPad", definition_as_of: "2024-09-28" },
  { segment_id: "wearables_home_accessories", segment_name: "Wearables, Home and Accessories", definition_as_of: "2024-09-28" },
  { segment_id: "services", segment_name: "Services", definition_as_of: "2024-09-28" },
];

function revenueFact(segment_id: string, value_num: number, as_of: string): SegmentFactInput {
  return {
    segment_id,
    metric_key: "revenue",
    metric_id: REVENUE_METRIC_ID,
    value_num,
    unit: "currency",
    currency: "USD",
    scale: 1,
    coverage_level: "full",
    source_id: DEV_SEGMENT_FIXTURE_SOURCE_ID,
    as_of,
  };
}

const APPLE_BUSINESS_FY2024: BuildSegmentFactsInput = {
  subject: APPLE_ISSUER,
  axis: "business",
  basis: "as_reported",
  period_kind: "fiscal_y",
  period_start: "2023-10-01",
  period_end: "2024-09-28",
  fiscal_year: 2024,
  fiscal_period: "FY",
  reporting_currency: "USD",
  as_of: "2024-11-01T20:30:00.000Z",
  segment_definitions: APPLE_BUSINESS_DEFINITIONS,
  facts: [
    revenueFact("iphone", 201_183_000_000, "2024-11-01T20:30:00.000Z"),
    revenueFact("mac", 29_984_000_000, "2024-11-01T20:30:00.000Z"),
    revenueFact("ipad", 26_694_000_000, "2024-11-01T20:30:00.000Z"),
    revenueFact("wearables_home_accessories", 37_005_000_000, "2024-11-01T20:30:00.000Z"),
    revenueFact("services", 96_169_000_000, "2024-11-01T20:30:00.000Z"),
  ],
  consolidated_totals: [
    {
      metric_key: "revenue",
      metric_id: REVENUE_METRIC_ID,
      value_num: 391_035_000_000,
      scale: 1,
      unit: "currency",
      currency: "USD",
      source_id: DEV_SEGMENT_FIXTURE_SOURCE_ID,
      as_of: "2024-11-01T20:30:00.000Z",
    },
  ],
};

const APPLE_BUSINESS_FY2023: BuildSegmentFactsInput = {
  subject: APPLE_ISSUER,
  axis: "business",
  basis: "as_reported",
  period_kind: "fiscal_y",
  period_start: "2022-10-02",
  period_end: "2023-09-30",
  fiscal_year: 2023,
  fiscal_period: "FY",
  reporting_currency: "USD",
  as_of: "2023-11-03T20:30:00.000Z",
  segment_definitions: APPLE_BUSINESS_DEFINITIONS,
  facts: [
    revenueFact("iphone", 200_583_000_000, "2023-11-03T20:30:00.000Z"),
    revenueFact("mac", 29_357_000_000, "2023-11-03T20:30:00.000Z"),
    revenueFact("ipad", 28_300_000_000, "2023-11-03T20:30:00.000Z"),
    revenueFact("wearables_home_accessories", 39_845_000_000, "2023-11-03T20:30:00.000Z"),
    revenueFact("services", 85_200_000_000, "2023-11-03T20:30:00.000Z"),
  ],
  consolidated_totals: [
    {
      metric_key: "revenue",
      metric_id: REVENUE_METRIC_ID,
      value_num: 383_285_000_000,
      scale: 1,
      unit: "currency",
      currency: "USD",
      source_id: DEV_SEGMENT_FIXTURE_SOURCE_ID,
      as_of: "2023-11-03T20:30:00.000Z",
    },
  ],
};

const APPLE_GEOGRAPHY_DEFINITIONS: ReadonlyArray<SegmentDefinitionInput> = [
  { segment_id: "americas", segment_name: "Americas", definition_as_of: "2024-09-28" },
  { segment_id: "europe", segment_name: "Europe", definition_as_of: "2024-09-28" },
  { segment_id: "greater_china", segment_name: "Greater China", definition_as_of: "2024-09-28" },
  { segment_id: "japan", segment_name: "Japan", definition_as_of: "2024-09-28" },
  { segment_id: "rest_of_asia_pacific", segment_name: "Rest of Asia Pacific", definition_as_of: "2024-09-28" },
];

const APPLE_GEOGRAPHY_FY2024: BuildSegmentFactsInput = {
  subject: APPLE_ISSUER,
  axis: "geography",
  basis: "as_reported",
  period_kind: "fiscal_y",
  period_start: "2023-10-01",
  period_end: "2024-09-28",
  fiscal_year: 2024,
  fiscal_period: "FY",
  reporting_currency: "USD",
  as_of: "2024-11-01T20:30:00.000Z",
  segment_definitions: APPLE_GEOGRAPHY_DEFINITIONS,
  facts: [
    revenueFact("americas", 167_045_000_000, "2024-11-01T20:30:00.000Z"),
    revenueFact("europe", 101_328_000_000, "2024-11-01T20:30:00.000Z"),
    revenueFact("greater_china", 66_952_000_000, "2024-11-01T20:30:00.000Z"),
    revenueFact("japan", 25_052_000_000, "2024-11-01T20:30:00.000Z"),
    revenueFact("rest_of_asia_pacific", 30_658_000_000, "2024-11-01T20:30:00.000Z"),
  ],
  consolidated_totals: [
    {
      metric_key: "revenue",
      metric_id: REVENUE_METRIC_ID,
      value_num: 391_035_000_000,
      scale: 1,
      unit: "currency",
      currency: "USD",
      source_id: DEV_SEGMENT_FIXTURE_SOURCE_ID,
      as_of: "2024-11-01T20:30:00.000Z",
    },
  ],
};

export const DEV_SEGMENTS: ReadonlyArray<SegmentsRepositoryRecord> = [
  { inputs: APPLE_BUSINESS_FY2024 },
  { inputs: APPLE_BUSINESS_FY2023 },
  { inputs: APPLE_GEOGRAPHY_FY2024 },
];
