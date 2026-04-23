import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import { bootstrapDatabase, connectedClient, dockerAvailable } from "../../../db/test/docker-pg.ts";
import { writeCitationLog } from "../src/citation.ts";

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
