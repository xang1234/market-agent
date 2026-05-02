import test from "node:test";
import assert from "node:assert/strict";

import type { Client } from "pg";

import { createThread } from "../src/threads-repo.ts";
import { persistChatMessageAfterSnapshotSealWithPool } from "../src/messages.ts";
import type { SealedSnapshot, SnapshotSealResult } from "../../snapshot/src/snapshot-sealer.ts";
import {
  bootstrapDatabase,
  connectedClient,
  connectedPool,
  dockerAvailable,
} from "../../../db/test/docker-pg.ts";

const SNAPSHOT_ID = "10000000-0000-4000-8000-000000000001";

async function seedUser(client: Client, email: string): Promise<string> {
  const { rows } = await client.query<{ user_id: string }>(
    `insert into users (email) values ($1) returning user_id::text as user_id`,
    [email],
  );
  return rows[0].user_id;
}

// Sidesteps the verifier's evidence-plane requirements (out of scope for
// this regression guard) and drops a sealed snapshot row directly so the
// persist path has a valid FK target.
async function seedSealedSnapshot(client: Client, snapshotId: string, asOf: string): Promise<void> {
  await client.query(
    `insert into snapshots (
       snapshot_id,
       subject_refs,
       fact_refs,
       claim_refs,
       event_refs,
       document_refs,
       series_specs,
       source_ids,
       tool_call_ids,
       tool_call_result_hashes,
       as_of,
       basis,
       normalization,
       allowed_transforms
     )
     values (
       $1::uuid,
       '[]'::jsonb,
       '[]'::jsonb,
       '[]'::jsonb,
       '[]'::jsonb,
       '[]'::jsonb,
       '[]'::jsonb,
       '[]'::jsonb,
       '[]'::jsonb,
       '[]'::jsonb,
       $2::timestamptz,
       'reported',
       'raw',
       'null'::jsonb
     )`,
    [snapshotId, asOf],
  );
}

function okSeal(snapshotId: string, asOf: string): SnapshotSealResult & { ok: true } {
  const snapshot: SealedSnapshot = Object.freeze({
    snapshot_id: snapshotId,
    created_at: asOf,
    subject_refs: Object.freeze([]),
    fact_refs: Object.freeze([]),
    claim_refs: Object.freeze([]),
    event_refs: Object.freeze([]),
    document_refs: Object.freeze([]),
    series_specs: Object.freeze([]),
    source_ids: Object.freeze([]),
    tool_call_ids: Object.freeze([]),
    tool_call_result_hashes: Object.freeze([]),
    as_of: asOf,
    basis: "reported" as const,
    normalization: "raw" as const,
    coverage_start: null,
    allowed_transforms: null,
    model_version: null,
    parent_snapshot: null,
  });
  return Object.freeze({
    ok: true,
    snapshot,
    verification: Object.freeze({ ok: true, failures: Object.freeze([]) }),
  });
}

// fra-asy regression: the *WithPool variant calls pool.connect() and then
// brands the acquired client. The old isPoolLike check rejected pg.PoolClient
// (which inherits .connect from pg.Client AND has .release) as if it were
// a raw pool. This test exercises that exact path against real pg so a
// future drift in the brand check trips here.
test(
  "persistChatMessageAfterSnapshotSealWithPool succeeds against a real pg.Pool (fra-asy regression)",
  { skip: !dockerAvailable() },
  async (t) => {
    const { databaseUrl } = await bootstrapDatabase(t, "chat-messages-fra-asy");
    const seedClient = await connectedClient(t, databaseUrl);
    const userId = await seedUser(seedClient, "fra-asy@example.test");
    const thread = await createThread(seedClient, userId, { title: "fra-asy regression" });
    const asOf = "2026-05-02T00:00:00.000Z";
    await seedSealedSnapshot(seedClient, SNAPSHOT_ID, asOf);

    const pool = await connectedPool(t, databaseUrl);
    const result = await persistChatMessageAfterSnapshotSealWithPool(pool, {
      thread_id: thread.thread_id,
      role: "assistant",
      blocks: [{ type: "text", text: "fra-asy regression body" }],
      content_hash: "sha256:fra-asy",
      sealSnapshot: async () => okSeal(SNAPSHOT_ID, asOf),
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.message.thread_id, thread.thread_id);
    assert.equal(result.message.snapshot_id, SNAPSHOT_ID);
    assert.equal(result.message.role, "assistant");
    assert.equal(result.message.content_hash, "sha256:fra-asy");

    const { rows } = await seedClient.query<{ count: string }>(
      "select count(*)::text as count from chat_messages where thread_id = $1::uuid",
      [thread.thread_id],
    );
    assert.equal(rows[0].count, "1");
  },
);
