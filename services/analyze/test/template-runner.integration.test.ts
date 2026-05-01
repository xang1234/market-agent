import test from "node:test";
import assert from "node:assert/strict";

import type { Client } from "pg";

import { createAnalyzeTemplate } from "../src/template-repo.ts";
import {
  getAnalyzeTemplateRun,
  listAnalyzeTemplateRunsByTemplate,
  persistAnalyzeTemplateRunAfterSnapshotSealWithPool,
} from "../src/template-runner.ts";
import type { SealedSnapshot, SnapshotSealResult } from "../../snapshot/src/snapshot-sealer.ts";
import {
  bootstrapDatabase,
  connectedClient,
  connectedPool,
  dockerAvailable,
} from "../../../db/test/docker-pg.ts";

const SNAPSHOT_ID_A = "10000000-0000-4000-8000-000000000001";
const SNAPSHOT_ID_B = "20000000-0000-4000-8000-000000000002";
const SUBJECT_ID = "30000000-0000-4000-8000-000000000003";

async function seedUser(client: Client, email: string): Promise<string> {
  const { rows } = await client.query<{ user_id: string }>(
    `insert into users (email) values ($1) returning user_id::text as user_id`,
    [email],
  );
  return rows[0].user_id;
}

// We can't easily stage and verify real snapshots from this layer (the
// verifier needs a populated evidence plane). The persist-after-seal
// contract is unit-tested with a fake seal callback; here we drop sealed
// snapshot rows directly so the integration suite focuses on what it
// uniquely verifies: real-pg FK behavior, the cascade-from-template
// delete, and the round-trip read of stored runs.
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
       $2::jsonb,
       '[]'::jsonb,
       '[]'::jsonb,
       '[]'::jsonb,
       '[]'::jsonb,
       '[]'::jsonb,
       '[]'::jsonb,
       '[]'::jsonb,
       '[]'::jsonb,
       $3::timestamptz,
       'reported',
       'raw',
       'null'::jsonb
     )`,
    [
      snapshotId,
      JSON.stringify([{ kind: "issuer", id: SUBJECT_ID }]),
      asOf,
    ],
  );
}

function sealedSnapshot(snapshotId: string, asOf: string): SealedSnapshot {
  return Object.freeze({
    snapshot_id: snapshotId,
    created_at: asOf,
    subject_refs: Object.freeze([{ kind: "issuer" as const, id: SUBJECT_ID }]),
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
}

function okSeal(snapshotId: string, asOf: string): SnapshotSealResult & { ok: true } {
  return Object.freeze({
    ok: true,
    snapshot: sealedSnapshot(snapshotId, asOf),
    verification: Object.freeze({ ok: true, failures: Object.freeze([]) }),
  });
}

test(
  "analyze_template_runs: rerun produces a new sealed snapshot, both memos readable at their original snapshots (fra-dpj headline)",
  { skip: !dockerAvailable() },
  async (t) => {
    // The fra-dpj contract: "Run template twice; both memos readable with
    // distinct snapshots." Two persist calls with two distinct sealed
    // snapshots must land two rows; both must round-trip via getRun and
    // appear in listRunsByTemplate ordered newest first.
    const { databaseUrl } = await bootstrapDatabase(t, "analyze-runner-rerun");
    const seedClient = await connectedClient(t, databaseUrl);
    const userId = await seedUser(seedClient, "rerun@example.com");
    const template = await createAnalyzeTemplate(seedClient, {
      user_id: userId,
      name: "Quarterly earnings memo",
      prompt_template: "Summarize the latest quarter for {subject}.",
    });

    const asOfA = "2026-05-01T12:00:00.000Z";
    const asOfB = "2026-05-02T12:00:00.000Z";
    await seedSealedSnapshot(seedClient, SNAPSHOT_ID_A, asOfA);
    await seedSealedSnapshot(seedClient, SNAPSHOT_ID_B, asOfB);

    const pool = await connectedPool(t, databaseUrl);
    const blocksA = [{ id: "block-a", kind: "section", title: "Q1", children: [], snapshot_id: SNAPSHOT_ID_A }];
    const blocksB = [{ id: "block-b", kind: "section", title: "Q2", children: [], snapshot_id: SNAPSHOT_ID_B }];

    const resultA = await persistAnalyzeTemplateRunAfterSnapshotSealWithPool(pool, {
      template_id: template.template_id,
      template_version: template.version,
      blocks: blocksA,
      sealSnapshot: async () => okSeal(SNAPSHOT_ID_A, asOfA),
    });
    assert.equal(resultA.ok, true);
    if (!resultA.ok) return;

    const resultB = await persistAnalyzeTemplateRunAfterSnapshotSealWithPool(pool, {
      template_id: template.template_id,
      template_version: template.version,
      blocks: blocksB,
      sealSnapshot: async () => okSeal(SNAPSHOT_ID_B, asOfB),
    });
    assert.equal(resultB.ok, true);
    if (!resultB.ok) return;

    assert.notEqual(resultA.run.run_id, resultB.run.run_id, "each run must get a fresh run_id");
    assert.notEqual(
      resultA.run.snapshot_id,
      resultB.run.snapshot_id,
      "each run must anchor a distinct sealed snapshot",
    );

    // Both runs round-trip via getRun.
    const fetchedA = await getAnalyzeTemplateRun(pool, resultA.run.run_id);
    const fetchedB = await getAnalyzeTemplateRun(pool, resultB.run.run_id);
    assert.ok(fetchedA && fetchedB);
    assert.equal(fetchedA.snapshot_id, SNAPSHOT_ID_A);
    assert.equal(fetchedB.snapshot_id, SNAPSHOT_ID_B);
    assert.deepEqual(fetchedA.blocks, blocksA);
    assert.deepEqual(fetchedB.blocks, blocksB);

    // List orders newest-first (B was inserted second → comes first).
    const list = await listAnalyzeTemplateRunsByTemplate(pool, template.template_id);
    assert.equal(list.length, 2);
    assert.equal(list[0].run_id, resultB.run.run_id, "list must be ordered created_at desc");
    assert.equal(list[1].run_id, resultA.run.run_id);
  },
);

test(
  "analyze_template_runs: cascade delete from analyze_templates wipes its runs (fra-dpj cleanup contract)",
  { skip: !dockerAvailable() },
  async (t) => {
    // Templates are user-owned. When the template is removed (or the user
    // is — which cascades to their templates per fra-ast), every persisted
    // run for it must go away too. Otherwise listAnalyzeTemplateRunsByTemplate
    // is the only read path that could surface them and they'd become
    // unreachable orphans.
    const { databaseUrl } = await bootstrapDatabase(t, "analyze-runner-cascade");
    const seedClient = await connectedClient(t, databaseUrl);
    const userId = await seedUser(seedClient, "cascade@example.com");
    const template = await createAnalyzeTemplate(seedClient, {
      user_id: userId,
      name: "Doomed template",
      prompt_template: "irrelevant",
    });
    await seedSealedSnapshot(seedClient, SNAPSHOT_ID_A, "2026-05-01T00:00:00.000Z");

    const pool = await connectedPool(t, databaseUrl);
    await persistAnalyzeTemplateRunAfterSnapshotSealWithPool(pool, {
      template_id: template.template_id,
      template_version: template.version,
      blocks: [{ id: "b1", kind: "section", title: "x", children: [], snapshot_id: SNAPSHOT_ID_A }],
      sealSnapshot: async () => okSeal(SNAPSHOT_ID_A, "2026-05-01T00:00:00.000Z"),
    });

    await seedClient.query("delete from analyze_templates where template_id = $1::uuid", [
      template.template_id,
    ]);

    const surviving = (
      await seedClient.query<{ count: string }>(
        "select count(*)::text as count from analyze_template_runs where template_id = $1::uuid",
        [template.template_id],
      )
    ).rows[0].count;
    assert.equal(surviving, "0", "ON DELETE CASCADE from analyze_templates must wipe its runs");
  },
);

test(
  "analyze_template_runs: deleting a referenced snapshot fails loudly (FK protects memo readability)",
  { skip: !dockerAvailable() },
  async (t) => {
    // The snapshot_id FK does NOT cascade — chat_messages convention. A
    // sealed snapshot is the evidence anchor for any memo that points at
    // it; silently dropping the snapshot would leave the memo unrenderable.
    // Verify pg actually rejects the delete.
    const { databaseUrl } = await bootstrapDatabase(t, "analyze-runner-snapshot-fk");
    const seedClient = await connectedClient(t, databaseUrl);
    const userId = await seedUser(seedClient, "snapshot-fk@example.com");
    const template = await createAnalyzeTemplate(seedClient, {
      user_id: userId,
      name: "FK probe",
      prompt_template: "irrelevant",
    });
    await seedSealedSnapshot(seedClient, SNAPSHOT_ID_A, "2026-05-01T00:00:00.000Z");

    const pool = await connectedPool(t, databaseUrl);
    await persistAnalyzeTemplateRunAfterSnapshotSealWithPool(pool, {
      template_id: template.template_id,
      template_version: template.version,
      blocks: [{ id: "b1", kind: "section", title: "x", children: [], snapshot_id: SNAPSHOT_ID_A }],
      sealSnapshot: async () => okSeal(SNAPSHOT_ID_A, "2026-05-01T00:00:00.000Z"),
    });

    await assert.rejects(
      seedClient.query("delete from snapshots where snapshot_id = $1::uuid", [SNAPSHOT_ID_A]),
      (err: Error & { code?: string }) =>
        // 23503 = foreign_key_violation
        err.code === "23503",
    );
  },
);

test(
  "analyze_template_runs: pool-mode short-circuits on a failed seal — no client checkout, no insert (fra-dpj)",
  { skip: !dockerAvailable() },
  async (t) => {
    // Defensive: the *WithPool variant runs the seal callback BEFORE
    // acquiring a write client (so a failing seal doesn't tie up a
    // connection). Verify nothing lands in the runs table when the seal
    // returns ok=false.
    const { databaseUrl } = await bootstrapDatabase(t, "analyze-runner-failed-seal");
    const seedClient = await connectedClient(t, databaseUrl);
    const userId = await seedUser(seedClient, "failed-seal@example.com");
    const template = await createAnalyzeTemplate(seedClient, {
      user_id: userId,
      name: "Failed seal",
      prompt_template: "irrelevant",
    });

    const pool = await connectedPool(t, databaseUrl);
    const result = await persistAnalyzeTemplateRunAfterSnapshotSealWithPool(pool, {
      template_id: template.template_id,
      template_version: template.version,
      blocks: [],
      sealSnapshot: async () =>
        Object.freeze({
          ok: false,
          verification: Object.freeze({
            ok: false,
            failures: Object.freeze([
              Object.freeze({
                reason_code: "missing_subject_refs" as const,
                details: Object.freeze({}),
              }),
            ]),
          }),
        }),
    });
    assert.equal(result.ok, false);

    const count = (
      await seedClient.query<{ count: string }>(
        "select count(*)::text as count from analyze_template_runs",
      )
    ).rows[0].count;
    assert.equal(count, "0", "no run row must be inserted when the seal fails");
  },
);
