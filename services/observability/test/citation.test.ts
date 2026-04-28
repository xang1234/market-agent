import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import { bootstrapDatabase, connectedClient, dockerAvailable } from "../../../db/test/docker-pg.ts";
import {
  citationLogInputsForBlocks,
  writeCitationLog,
  writeCitationLogsForBlocks,
} from "../src/citation.ts";

async function seedMinimalSnapshot(client: Client): Promise<string> {
  const { rows } = await client.query<{ snapshot_id: string }>(
    `insert into snapshots (subject_refs, as_of, basis, normalization, allowed_transforms)
     values ('[]'::jsonb, now(), 'as_reported', 'none', '[]'::jsonb)
     returning snapshot_id`,
  );
  return rows[0].snapshot_id;
}

test("writeCitationLog persists a row bound to an existing snapshot", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for observability integration coverage");
    return;
  }

  const { databaseUrl } = await bootstrapDatabase(t, "fra-6al-8-2");
  const client = await connectedClient(t, databaseUrl);
  const snapshot_id = await seedMinimalSnapshot(client);
  const ref_id = randomUUID();
  const source_id = randomUUID();

  const { citation_log_id, created_at } = await writeCitationLog(client, {
    snapshot_id,
    block_id: "block-1",
    ref_kind: "fact",
    ref_id,
    source_id,
  });

  assert.match(citation_log_id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.ok(created_at instanceof Date);

  const { rows } = await client.query(
    `select snapshot_id, block_id, ref_kind, ref_id, source_id
     from citation_logs where citation_log_id = $1`,
    [citation_log_id],
  );
  assert.deepEqual(rows[0], { snapshot_id, block_id: "block-1", ref_kind: "fact", ref_id, source_id });
});

test("writeCitationLog accepts a null source_id", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for observability integration coverage");
    return;
  }

  const { databaseUrl } = await bootstrapDatabase(t, "fra-6al-8-2");
  const client = await connectedClient(t, databaseUrl);
  const snapshot_id = await seedMinimalSnapshot(client);

  const { citation_log_id } = await writeCitationLog(client, {
    snapshot_id,
    block_id: "block-2",
    ref_kind: "claim",
    ref_id: randomUUID(),
  });

  const { rows } = await client.query(
    `select source_id from citation_logs where citation_log_id = $1`,
    [citation_log_id],
  );
  assert.equal(rows[0].source_id, null);
});

test("writeCitationLog rejects a snapshot_id that does not exist (FK enforced)", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for observability integration coverage");
    return;
  }

  const { databaseUrl } = await bootstrapDatabase(t, "fra-6al-8-2");
  const client = await connectedClient(t, databaseUrl);

  await assert.rejects(
    writeCitationLog(client, {
      snapshot_id: randomUUID(),
      block_id: "block-x",
      ref_kind: "fact",
      ref_id: randomUUID(),
    }),
    /foreign key|citation_logs_snapshot_id_fkey/i,
  );
});

test("citationLogInputsForBlocks extracts one row per block citation ref", () => {
  const snapshot_id = randomUUID();
  const source_id = randomUUID();
  const fact_id = randomUUID();
  const claim_id = randomUUID();

  const rows = citationLogInputsForBlocks([
    {
      id: "summary",
      kind: "rich_text",
      snapshot_id,
      source_refs: [source_id],
      segments: [
        { type: "text", text: "Revenue grew " },
        { type: "ref", ref_kind: "fact", ref_id: fact_id, format: "12%" },
        { type: "ref", ref_kind: "fact", ref_id: fact_id, format: "12%" },
        { type: "ref", ref_kind: "claim", ref_id: claim_id },
      ],
    },
  ]);

  assert.deepEqual(rows, [
    {
      snapshot_id,
      block_id: "summary",
      ref_kind: "fact",
      ref_id: fact_id,
      source_id,
    },
    {
      snapshot_id,
      block_id: "summary",
      ref_kind: "claim",
      ref_id: claim_id,
      source_id,
    },
  ]);
});

test("citationLogInputsForBlocks extracts nested section and value refs", () => {
  const snapshot_id = randomUUID();
  const source_id = randomUUID();
  const value_ref = randomUUID();
  const delta_ref = randomUUID();

  const rows = citationLogInputsForBlocks([
    {
      id: "section-1",
      kind: "section",
      snapshot_id,
      source_refs: [source_id],
      children: [
        {
          id: "metrics",
          kind: "metric_row",
          snapshot_id,
          source_refs: [source_id],
          items: [
            { label: "Revenue", value_ref, delta_ref },
          ],
        },
      ],
    },
  ]);

  assert.deepEqual(rows, [
    {
      snapshot_id,
      block_id: "metrics",
      ref_kind: "fact",
      ref_id: value_ref,
      source_id,
    },
    {
      snapshot_id,
      block_id: "metrics",
      ref_kind: "fact",
      ref_id: delta_ref,
      source_id,
    },
  ]);
});

test("citationLogInputsForBlocks extracts consensus and estimate block refs", () => {
  const snapshot_id = randomUUID();
  const analyst_count_ref = randomUUID();
  const buy_count_ref = randomUUID();
  const current_price_ref = randomUUID();
  const low_ref = randomUUID();
  const avg_ref = randomUUID();
  const high_ref = randomUUID();
  const upside_ref = randomUUID();
  const estimate_ref = randomUUID();
  const actual_ref = randomUUID();
  const surprise_ref = randomUUID();

  const rows = citationLogInputsForBlocks([
    {
      id: "consensus",
      kind: "analyst_consensus",
      snapshot_id,
      analyst_count_ref,
      distribution: [{ bucket: "buy", count_ref: buy_count_ref }],
    },
    {
      id: "price-targets",
      kind: "price_target_range",
      snapshot_id,
      current_price_ref,
      low_ref,
      avg_ref,
      high_ref,
      upside_ref,
    },
    {
      id: "eps",
      kind: "eps_surprise",
      snapshot_id,
      quarters: [{ label: "Q1", estimate_ref, actual_ref, surprise_ref }],
    },
  ]);

  assert.deepEqual(
    rows.map((row) => [row.block_id, row.ref_kind, row.ref_id]),
    [
      ["consensus", "fact", analyst_count_ref],
      ["consensus", "fact", buy_count_ref],
      ["price-targets", "fact", current_price_ref],
      ["price-targets", "fact", low_ref],
      ["price-targets", "fact", avg_ref],
      ["price-targets", "fact", high_ref],
      ["price-targets", "fact", upside_ref],
      ["eps", "fact", estimate_ref],
      ["eps", "fact", actual_ref],
      ["eps", "fact", surprise_ref],
    ],
  );
});

test("writeCitationLogsForBlocks writes every extracted citation row", async () => {
  const inserted: unknown[][] = [];
  const db = {
    async query<R extends Record<string, unknown>>(text: string, values?: unknown[]) {
      assert.match(text, /insert into citation_logs/);
      inserted.push(values ?? []);
      return {
        rows: [
          {
            citation_log_id: randomUUID(),
            created_at: new Date("2026-04-29T00:00:00.000Z"),
          },
        ] as R[],
        command: "INSERT",
        rowCount: 1,
        oid: 0,
        fields: [],
      };
    },
  };
  const snapshot_id = randomUUID();
  const ref_id = randomUUID();

  const rows = await writeCitationLogsForBlocks(db, [
    {
      id: "block-1",
      kind: "rich_text",
      snapshot_id,
      source_refs: [],
      segments: [{ type: "ref", ref_kind: "event", ref_id }],
    },
  ]);

  assert.equal(rows.length, 1);
  assert.deepEqual(inserted, [[snapshot_id, "block-1", "event", ref_id, null]]);
});
