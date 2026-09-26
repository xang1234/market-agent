// Erasure of verified financial results: the owner's erasure, the deletion of
// a result's parent, and the deletion of evidence a run bound each leave no
// recoverable copy — plan, bound inputs, results, events, certificate,
// certificate snapshot, replays, or the surface's copy of the sealed block.
// Reads recheck access, and another owner can neither see nor probe a result.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { Client } from "pg";
import { connectedPool, dockerAvailable } from "../../../db/test/docker-pg.ts";
import { deleteUserAndQueueObjectBlobsWithPool } from "../../evidence/src/blob-gc-repo.ts";
import type { FinancialRuntimeAuthority } from "../../financial-core/src/index.ts";
import type { SnapshotTransactionClient } from "../../snapshot/src/snapshot-sealer.ts";
import { finalizeUnit, type PersistParentArtifact } from "../src/finalize.ts";
import { inspectCommittedResult } from "../src/inspection.ts";
import { reserveReplayRun, reserveRun } from "../src/run-repo.ts";
import { authorityFor, connectExtraClient, databaseUrl, engineDatabase, IDS, marginPlan, pinnedClients, readyRun, waitForLockWaiters } from "./db-fixtures.ts";

/** Writes the sealed block as an assistant message, as Chat's parent writer does. */
function chatCopy(threadId: string): PersistParentArtifact {
  return async (tx, publication) => {
    await tx.client.query(
      `insert into chat_messages (thread_id, role, snapshot_id, blocks, content_hash) values ($1, 'assistant', $2, $3::jsonb, $4)`,
      [threadId, publication.snapshot_id, JSON.stringify([publication.block]), `sha256:${"a".repeat(64)}`],
    );
    await tx.client.query(`update chat_threads set latest_snapshot_id = $2 where thread_id = $1`, [threadId, publication.snapshot_id]);
  };
}

/** A completed margin run for `owner` whose units are copied into `threadId`. */
async function publishedRun(db: Client, client: SnapshotTransactionClient, owner: string, threadId: string, persist: PersistParentArtifact = chatCopy(threadId)) {
  const authority = chatAuthority(owner, threadId);
  const plan = marginPlan();
  const { runId, lease } = await readyRun(db, plan, authority);
  for (const unit of plan.publication_units) {
    const outcome = await finalizeUnit({ client, lease, authority, unit_id: unit.unit_id, snapshot_id: randomUUID(), persistParent: persist });
    assert.equal(outcome.status, "published", JSON.stringify(outcome));
  }
  const resultIds = (await db.query<{ result_id: string }>(`select result_id::text from financial_results where run_id = $1`, [runId])).rows.map((row) => row.result_id);
  const snapshots = (await db.query<{ snapshot_id: string }>(`select snapshot_id::text from snapshot_financial_runs where run_id = $1`, [runId])).rows.map((row) => row.snapshot_id);
  return { runId, planId: plan.plan_id, resultIds, snapshots, authority };
}

function chatAuthority(owner: string, threadId: string): FinancialRuntimeAuthority {
  const base = authorityFor(owner);
  return { ...base, parent: { ...base.parent, id: threadId } };
}

async function newThread(db: Client, owner: string): Promise<string> {
  const threadId = randomUUID();
  await db.query(`insert into chat_threads (thread_id, user_id) values ($1, $2)`, [threadId, owner]);
  return threadId;
}

/** Every stored trace of a run, by table; all zero once it is erased. */
async function traces(db: Client, run: { runId: string; planId: string; snapshots: ReadonlyArray<string> }) {
  const count = async (sql: string, value: unknown) => Number((await db.query(sql, [value])).rows[0].n);
  return {
    runs: await count(`select count(*) as n from financial_runs where run_id = $1 or replay_of_run_id = $1`, run.runId),
    plans: await count(`select count(*) as n from financial_plans where plan_id = $1`, run.planId),
    inputs: await count(`select count(*) as n from financial_run_inputs where run_id = $1`, run.runId),
    results: await count(`select count(*) as n from financial_results where run_id = $1`, run.runId),
    events: await count(`select count(*) as n from financial_run_events where run_id = $1`, run.runId),
    computations: await count(`select count(*) as n from computations where financial_run_id = $1`, run.runId),
    certificates: await count(`select count(*) as n from snapshot_financial_runs where run_id = $1`, run.runId),
    snapshots: await count(`select count(*) as n from snapshots where snapshot_id = any($1::uuid[])`, run.snapshots),
    messages: await count(`select count(*) as n from chat_messages where snapshot_id = any($1::uuid[])`, run.snapshots),
  };
}

const ERASED = { runs: 0, plans: 0, inputs: 0, results: 0, events: 0, computations: 0, certificates: 0, snapshots: 0, messages: 0 };

test("financial erasure", { skip: !dockerAvailable(), timeout: 300_000 }, async (t) => {
  const db = await engineDatabase(t, "financial-erasure");
  const [publisher] = await pinnedClients(t, db, 1);

  await t.test("erasing the owner erases every run, copy, and certificate, and nothing of another owner", async () => {
    const owner = randomUUID();
    await db.query(`insert into users (user_id, email) values ($1, $2)`, [owner, `${owner}@example.test`]);
    const run = await publishedRun(db, publisher!, owner, await newThread(db, owner));
    const replay = await reserveReplayRun(db, { owner_user_id: owner, source_run_id: run.runId, request_key: randomUUID() });
    assert.equal(replay.status, "created");
    const bystander = await publishedRun(db, publisher!, IDS.owner, await newThread(db, IDS.owner));

    // The product's user-erasure transaction, not a bare delete.
    const erased = await deleteUserAndQueueObjectBlobsWithPool(await connectedPool(t, databaseUrl(db)), owner);
    assert.equal(erased.deleted_user, true);
    assert.deepEqual(await traces(db, run), ERASED);
    assert.equal((await traces(db, bystander)).certificates, bystander.snapshots.length, "another owner's results are untouched");
  });

  await t.test("deleting the parent erases its runs; the owner's other threads keep theirs", async () => {
    const threadId = await newThread(db, IDS.owner);
    const run = await publishedRun(db, publisher!, IDS.owner, threadId);
    const kept = await publishedRun(db, publisher!, IDS.owner, await newThread(db, IDS.owner));
    assert.ok(await inspectCommittedResult(db, IDS.owner, run.resultIds[0]!));

    await db.query(`delete from chat_threads where thread_id = $1`, [threadId]);
    assert.deepEqual(await traces(db, run), ERASED);
    assert.equal(await inspectCommittedResult(db, IDS.owner, run.resultIds[0]!), null, "an erased result reads as unavailable");
    assert.equal((await traces(db, kept)).certificates, kept.snapshots.length);
  });

  await t.test("another owner can neither read a result nor probe its plan", async () => {
    const run = await publishedRun(db, publisher!, IDS.owner, await newThread(db, IDS.owner));
    for (const resultId of run.resultIds) assert.equal(await inspectCommittedResult(db, IDS.other, resultId), null);
    // Replaying the owner's own plan under another owner reveals no run of the owner's.
    const plan = (await db.query(`select plan from financial_plans where plan_id = $1`, [run.planId])).rows[0].plan;
    const probe = await reserveRun(db, { authority: chatAuthority(IDS.other, randomUUID()), request_key: randomUUID(), plan });
    assert.deepEqual(probe, { status: "conflict", reason: "request_hash_mismatch", run_id: null });
    assert.equal(await inspectCommittedResult(db, IDS.other, run.resultIds[0]!), null);
  });

  // Last: deletes a seeded fact every margin run binds.
  await t.test("deleting bound evidence waits for an in-flight publication, then erases it and its copy", async () => {
    const threadId = await newThread(db, IDS.owner);
    const earlier = await publishedRun(db, publisher!, IDS.owner, threadId);

    const authority = chatAuthority(IDS.owner, threadId);
    const plan = marginPlan();
    const { runId, lease } = await readyRun(db, plan, authority);
    let reached!: () => void;
    let release!: () => void;
    const inside = new Promise<void>((resolve) => { reached = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const copy = chatCopy(threadId);
    const pending = finalizeUnit({
      client: publisher!, lease, authority, unit_id: plan.publication_units[0]!.unit_id, snapshot_id: randomUUID(),
      persistParent: async (tx, publication) => { await copy(tx, publication); reached(); await gate; },
    });
    await inside;
    const eraser = await connectExtraClient(t, db);
    const deletion = eraser.query(`delete from facts where fact_id = $1`, [IDS.grossProfit2023]);
    await waitForLockWaiters(db, 1);
    release();
    assert.equal((await pending).status, "published", "the publication committed first");
    await deletion;

    const snapshots = (await db.query<{ snapshot_id: string }>(`select snapshot_id::text from snapshots where snapshot_id in (select snapshot_id from chat_messages where thread_id = $1)`, [threadId])).rows;
    assert.deepEqual(snapshots, [], "no copy of either run's block remains in the thread");
    assert.deepEqual(await traces(db, { runId, planId: plan.plan_id, snapshots: [] }), ERASED);
    assert.deepEqual(await traces(db, earlier), ERASED);
    const thread = (await db.query(`select latest_snapshot_id from chat_threads where thread_id = $1`, [threadId])).rows[0];
    assert.equal(thread.latest_snapshot_id, null, "the thread survives without pointing at an erased certificate");
  });
});
