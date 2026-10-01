import test from "node:test";
import assert from "node:assert/strict";

import { createFact } from "../../evidence/src/fact-repo.ts";
import { loadTurnFactBlocks } from "../src/fact-blocks.ts";
import { bootstrapDatabase, connectedClient, dockerAvailable } from "../../../db/test/docker-pg.ts";
import { GOLDEN_AS_OF, GOLDEN_COMPANIES, seedGoldenDataset } from "./golden/dataset.ts";

const company = (ticker: string) => GOLDEN_COMPANIES.find((candidate) => candidate.ticker === ticker)!;
const NVDA = company("NVDA");
const AMD = company("AMD");
// Another seeded source (db/seed/sources.sql).
const OTHER_SOURCE_ID = "00000000-0000-4000-a000-000000000002";

test("a comparison is built from what was known at the snapshot cutoff (#161)", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for comparison cutoff coverage");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "chat-comparison-cutoff");
  const client = await connectedClient(t, databaseUrl);
  await seedGoldenDataset(client);
  const { rows: [{ metric_id: revenueMetricId }] } = await client.query<{ metric_id: string }>(
    `select metric_id::text as metric_id from metrics where metric_key = 'revenue'`,
  );
  // A restatement of AMD's FY2025 revenue, published after the cutoff.
  await createFact(client, {
    subject_kind: "issuer",
    subject_id: AMD.issuer_id,
    metric_id: revenueMetricId,
    period_kind: "fiscal_y",
    period_start: "2024-12-29",
    period_end: "2025-12-27",
    fiscal_year: 2025,
    fiscal_period: "FY",
    value_num: 100e9,
    unit: "currency",
    currency: "USD",
    as_of: "2026-09-03T00:00:00.000Z",
    reported_at: "2026-09-03T00:00:00.000Z",
    observed_at: "2026-09-03T00:00:00.000Z",
    source_id: OTHER_SOURCE_ID,
    method: "reported",
    verification_status: "authoritative",
    freshness_class: "filing_time",
    coverage_level: "full",
    entitlement_channels: ["app"],
    confidence: 1,
  });

  // Typed for a pool; a single client serves this path.
  const blocks = await loadTurnFactBlocks(client as unknown as Parameters<typeof loadTurnFactBlocks>[0], {
    issuers: [{ kind: "issuer", id: NVDA.issuer_id }, { kind: "issuer", id: AMD.issuer_id }],
    wantsPeers: false,
    snapshotId: "64000000-0000-4000-8000-0000000000cc",
    asOf: GOLDEN_AS_OF,
  });
  const comparison = blocks.find((block) => block.kind === "metrics_comparison");
  assert.ok(comparison, `expected a comparison; got [${blocks.map((block) => block.kind).join(", ")}]`);
  const metrics = comparison.metrics as ReadonlyArray<string>;
  const cells = comparison.cells as ReadonlyArray<ReadonlyArray<{ format: string } | null>>;
  const amdRow = (comparison.subjects as ReadonlyArray<{ id: string }>).findIndex((subject) => subject.id === AMD.issuer_id);
  assert.equal(cells[amdRow][metrics.indexOf("Revenue")]?.format, "$34.7B", "the post-cutoff restatement must not show");
  // Derived margins are stamped at the cutoff, so they still load and cite.
  assert.ok(cells[amdRow][metrics.indexOf("Gross Margin")], "a derived margin must survive the full cutoff check");
  assert.ok(((comparison.provenance_fact_refs as string[]) ?? []).length >= 4);
});
