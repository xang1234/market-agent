import test from "node:test";
import assert from "node:assert/strict";

import { createFact } from "../../evidence/src/fact-repo.ts";
import { loadTurnFactBlocks } from "../src/fact-blocks.ts";
import { bootstrapDatabase, connectedClient, dockerAvailable } from "../../../db/test/docker-pg.ts";
import { GOLDEN_AS_OF, GOLDEN_COMPANIES, MARKET_SOURCE_ID, SEC_FILING_SOURCE_ID, seedGoldenDataset } from "./golden/dataset.ts";

const NVDA = GOLDEN_COMPANIES.find((company) => company.ticker === "NVDA")!;
// Another seeded source (db/seed/sources.sql).
const OTHER_SOURCE_ID = "00000000-0000-4000-a000-000000000002";

test("a segment breakdown shows only eligible, numeric facts, one per segment", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for segment fact coverage");
    return;
  }
  const { databaseUrl } = await bootstrapDatabase(t, "chat-segments");
  const client = await connectedClient(t, databaseUrl);
  await seedGoldenDataset(client);
  const { rows: [{ metric_id: revenueMetricId }] } = await client.query<{ metric_id: string }>(
    `select metric_id::text as metric_id from metrics where metric_key = 'revenue'`,
  );
  const segmentId = async (name: string) => {
    const { rows } = await client.query<{ segment_id: string }>(
      `insert into segments (issuer_id, axis, name, definition_as_of) values ($1::uuid, 'business', $2, $3)
       on conflict (issuer_id, axis, name) do update set name = excluded.name
       returning segment_id::text as segment_id`,
      [NVDA.issuer_id, name, GOLDEN_AS_OF],
    );
    return rows[0]!.segment_id;
  };
  const segmentFact = async (name: string, overrides: Record<string, unknown>) =>
    createFact(client, {
      subject_kind: "segment",
      subject_id: await segmentId(name),
      metric_id: revenueMetricId,
      period_kind: "fiscal_q",
      period_start: "2025-10-27",
      period_end: "2026-01-25",
      fiscal_year: 2026,
      fiscal_period: "Q4",
      value_num: 1e9,
      unit: "currency",
      currency: "USD",
      as_of: GOLDEN_AS_OF,
      reported_at: GOLDEN_AS_OF,
      observed_at: GOLDEN_AS_OF,
      source_id: SEC_FILING_SOURCE_ID,
      method: "reported",
      verification_status: "authoritative",
      freshness_class: "filing_time",
      coverage_level: "full",
      entitlement_channels: ["app"],
      confidence: 1,
      ...overrides,
    } as never);

  // Ineligible: unverified, estimated, not entitled to the app, no numeric value.
  await segmentFact("Candidate Segment", { verification_status: "candidate" });
  await segmentFact("Estimated Segment", { method: "estimated" });
  await segmentFact("Export-only Segment", { entitlement_channels: ["export"] });
  await segmentFact("Text Segment", { value_num: null, value_text: "not disclosed" });
  // A child of Data Center: listing it beside its parent would double-count.
  const { rows: [{ segment_id: dataCenterId }] } = await client.query<{ segment_id: string }>(
    `select segment_id::text as segment_id from segments where issuer_id = $1::uuid and name = 'Data Center'`,
    [NVDA.issuer_id],
  );
  await client.query(
    `insert into segments (issuer_id, axis, name, definition_as_of, parent_segment_id)
     values ($1::uuid, 'business', 'Compute', $2, $3::uuid)`,
    [NVDA.issuer_id, GOLDEN_AS_OF, dataCenterId],
  );
  await segmentFact("Compute", { value_num: 48e9 });
  // An undated quarter cannot be placed in time.
  await segmentFact("Undated Segment", { fiscal_year: null, fiscal_period: null });
  // Data Center from two more sources: an earlier one loses to the golden fact
  // (latest as_of within the cutoff wins); one after the cutoff did not exist yet.
  await segmentFact("Data Center", { source_id: OTHER_SOURCE_ID, value_num: 55.0e9, as_of: "2026-08-15T00:00:00.000Z" });
  await segmentFact("Data Center", { source_id: MARKET_SOURCE_ID, value_num: 55.3e9, as_of: "2026-09-02T00:00:00.000Z" });

  // Typed for a pool; a single client serves this single-company path.
  const blocks = await loadTurnFactBlocks(client as unknown as Parameters<typeof loadTurnFactBlocks>[0], {
    issuers: [{ kind: "issuer", id: NVDA.issuer_id }],
    wantsPeers: false,
    wantsSegments: true,
    snapshotId: "63000000-0000-4000-8000-0000000000aa",
    asOf: GOLDEN_AS_OF,
  });
  const breakdown = blocks.find((block) => /by segment/.test(String(block.title)));
  assert.ok(breakdown);
  const items = breakdown.items as Array<{ label: string; format: string }>;
  assert.deepEqual(items.map((item) => item.label), ["Data Center", "Gaming", "OEM & Other", "Professional Visualization", "Automotive"]);
  assert.equal(items[0].format, "$55.2B");
  assert.equal(breakdown.title, "Revenue by segment (Q4 2026)");

  // A parent must be the same company's segment on the same axis.
  const amd = GOLDEN_COMPANIES.find((company) => company.ticker === "AMD")!;
  await assert.rejects(
    client.query(
      `insert into segments (issuer_id, axis, name, definition_as_of, parent_segment_id)
       values ($1::uuid, 'business', 'Foreign child', $2, $3::uuid)`,
      [amd.issuer_id, GOLDEN_AS_OF, dataCenterId],
    ),
    /foreign key/,
  );

  // A segment whose Q4 fact is missing leaves the rest short of the quarter's
  // revenue: no breakdown rather than an incomplete one shown as whole.
  await client.query(
    `update facts set invalidated_at = now()
      where subject_kind = 'segment'
        and subject_id = (select segment_id from segments where issuer_id = $1::uuid and name = 'Automotive')`,
    [NVDA.issuer_id],
  );
  const afterGap = await loadTurnFactBlocks(client as unknown as Parameters<typeof loadTurnFactBlocks>[0], {
    issuers: [{ kind: "issuer", id: NVDA.issuer_id }],
    wantsPeers: false,
    wantsSegments: true,
    snapshotId: "63000000-0000-4000-8000-0000000000ab",
    asOf: GOLDEN_AS_OF,
  });
  assert.equal(afterGap.some((block) => /by segment/.test(String(block.title))), false);
});
