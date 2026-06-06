import test from "node:test";
import assert from "node:assert/strict";
import type { Client } from "pg";
import { bootstrapDatabase, connectedClient, dockerAvailable } from "../../../db/test/docker-pg.ts";
import { createFact, type FactInput } from "../../evidence/src/fact-repo.ts";
import { loadRecentIssuerFundamentals } from "../src/issuer-fundamentals-reader.ts";

const ISSUER_ID = "11111111-1111-4111-8111-111111111111";

async function seedSource(client: Client): Promise<string> {
  const { rows } = await client.query<{ source_id: string }>(
    `insert into sources (provider, kind, trust_tier, license_class, retrieved_at)
     values ('test', 'filing', 'primary', 'test', now())
     returning source_id::text as source_id`,
  );
  return rows[0].source_id;
}

async function seedRevenueMetric(client: Client): Promise<string> {
  const { rows } = await client.query<{ metric_id: string }>(
    `insert into metrics (metric_key, display_name, unit_class, aggregation, interpretation, canonical_source_class)
     values ('revenue', 'Revenue', 'currency', 'sum', 'higher_is_better', 'gaap')
     returning metric_id::text as metric_id`,
  );
  return rows[0].metric_id;
}

async function seedMetric(
  client: Client,
  metricKey: string,
  displayName: string,
): Promise<string> {
  const { rows } = await client.query<{ metric_id: string }>(
    `insert into metrics (metric_key, display_name, unit_class, aggregation, interpretation, canonical_source_class)
     values ($1, $2, 'currency', 'sum', 'higher_is_better', 'gaap')
     returning metric_id::text as metric_id`,
    [metricKey, displayName],
  );
  return rows[0].metric_id;
}

function revenueFact(
  metricId: string,
  sourceId: string,
  overrides: Pick<
    FactInput,
    | "fiscal_year"
    | "value_num"
    | "verification_status"
    | "entitlement_channels"
    | "period_kind"
    | "fiscal_period"
  >,
): FactInput {
  return {
    subject_kind: "issuer",
    subject_id: ISSUER_ID,
    metric_id: metricId,
    period_kind: "fiscal_y",
    fiscal_period: "FY",
    unit: "currency",
    currency: "USD",
    as_of: "2026-05-08T00:00:00.000Z",
    observed_at: "2026-05-08T00:00:00.000Z",
    source_id: sourceId,
    method: "reported",
    freshness_class: "filing_time",
    coverage_level: "full",
    confidence: 1,
    ...overrides,
  };
}

test(
  "loadRecentIssuerFundamentals returns only channel-entitled, display-verified facts",
  { skip: !dockerAvailable(), timeout: 120000 },
  async (t) => {
    const { databaseUrl } = await bootstrapDatabase(t, "fundamentals-reader");
    const client = await connectedClient(t, databaseUrl);
    const sourceId = await seedSource(client);
    const metricId = await seedRevenueMetric(client);

    // Distinct fiscal_year keeps the four reported facts off the unique
    // active-reported identity index (subject, metric, period, fiscal_year, ...).
    await createFact(client, revenueFact(metricId, sourceId, { fiscal_year: 2024, value_num: 100, verification_status: "authoritative", entitlement_channels: ["app"] }));
    await createFact(client, revenueFact(metricId, sourceId, { fiscal_year: 2023, value_num: 200, verification_status: "candidate", entitlement_channels: ["app"] }));
    await createFact(client, revenueFact(metricId, sourceId, { fiscal_year: 2022, value_num: 300, verification_status: "disputed", entitlement_channels: ["app"] }));
    await createFact(client, revenueFact(metricId, sourceId, { fiscal_year: 2021, value_num: 400, verification_status: "authoritative", entitlement_channels: ["export"] }));

    const appFacts = await loadRecentIssuerFundamentals(client, { kind: "issuer", id: ISSUER_ID }, { limit: 50 });
    assert.deepEqual(
      appFacts.map((f) => f.value_num),
      [100],
      "only the authoritative app fact survives; candidate, disputed, and export-only facts are excluded",
    );

    const exportFacts = await loadRecentIssuerFundamentals(client, { kind: "issuer", id: ISSUER_ID }, { channel: "export", limit: 50 });
    assert.deepEqual(
      exportFacts.map((f) => f.value_num),
      [400],
      "the export channel surfaces the export-entitled fact, not the app one",
    );
  },
);

test(
  "loadRecentIssuerFundamentals periodKind filter keeps only the requested period kind",
  { skip: !dockerAvailable(), timeout: 120000 },
  async (t) => {
    const { databaseUrl } = await bootstrapDatabase(t, "fundamentals-period-kind");
    const client = await connectedClient(t, databaseUrl);
    const sourceId = await seedSource(client);
    const metricId = await seedRevenueMetric(client);

    await createFact(client, revenueFact(metricId, sourceId, { fiscal_year: 2024, value_num: 100, verification_status: "authoritative", entitlement_channels: ["app"] }));
    await createFact(client, revenueFact(metricId, sourceId, { fiscal_year: 2025, value_num: 999, verification_status: "authoritative", entitlement_channels: ["app"], period_kind: "fiscal_q", fiscal_period: "Q4" }));

    const annual = await loadRecentIssuerFundamentals(client, { kind: "issuer", id: ISSUER_ID }, { periodKind: "fiscal_y", limit: 50 });
    assert.deepEqual(
      annual.map((f) => f.value_num),
      [100],
      "the fiscal_q fact is excluded when periodKind is fiscal_y",
    );

    const unfiltered = await loadRecentIssuerFundamentals(client, { kind: "issuer", id: ISSUER_ID }, { limit: 50 });
    assert.equal(unfiltered.length, 2, "without periodKind both period kinds are returned");
  },
);

test(
  "loadRecentIssuerFundamentals metricKeys filter keeps only the requested metrics",
  { skip: !dockerAvailable(), timeout: 120000 },
  async (t) => {
    const { databaseUrl } = await bootstrapDatabase(t, "fundamentals-metric-keys");
    const client = await connectedClient(t, databaseUrl);
    const sourceId = await seedSource(client);
    const revenueId = await seedRevenueMetric(client);
    const grossProfitId = await seedMetric(client, "gross_profit", "Gross Profit");

    await createFact(client, revenueFact(revenueId, sourceId, { fiscal_year: 2024, value_num: 100, verification_status: "authoritative", entitlement_channels: ["app"] }));
    await createFact(client, revenueFact(grossProfitId, sourceId, { fiscal_year: 2024, value_num: 60, verification_status: "authoritative", entitlement_channels: ["app"] }));

    const revenueOnly = await loadRecentIssuerFundamentals(client, { kind: "issuer", id: ISSUER_ID }, { metricKeys: ["revenue"], limit: 50 });
    assert.deepEqual(
      revenueOnly.map((f) => f.metric_key),
      ["revenue"],
      "gross_profit is excluded when metricKeys is ['revenue']",
    );
  },
);

test(
  "loadRecentIssuerFundamentals returns all eligible rows when limit is omitted",
  { skip: !dockerAvailable(), timeout: 120000 },
  async (t) => {
    const { databaseUrl } = await bootstrapDatabase(t, "fundamentals-no-limit");
    const client = await connectedClient(t, databaseUrl);
    const sourceId = await seedSource(client);
    const metricId = await seedRevenueMetric(client);

    await createFact(client, revenueFact(metricId, sourceId, { fiscal_year: 2024, value_num: 100, verification_status: "authoritative", entitlement_channels: ["app"] }));
    await createFact(client, revenueFact(metricId, sourceId, { fiscal_year: 2023, value_num: 90, verification_status: "authoritative", entitlement_channels: ["app"] }));
    await createFact(client, revenueFact(metricId, sourceId, { fiscal_year: 2022, value_num: 80, verification_status: "authoritative", entitlement_channels: ["app"] }));

    const all = await loadRecentIssuerFundamentals(client, { kind: "issuer", id: ISSUER_ID }, {});
    assert.deepEqual(
      all.map((f) => f.value_num),
      [100, 90, 80],
      "all three eligible facts are returned, newest fiscal year first, with no limit",
    );
  },
);
