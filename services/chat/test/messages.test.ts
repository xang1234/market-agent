import assert from "node:assert/strict";
import test from "node:test";
import {
  chatMessageTransactionClient,
  createChatMessagePersistence,
  persistChatMessageAfterSnapshotSeal,
  persistChatMessageAfterSnapshotSealWithPool,
  type ChatMessageClientPool,
  type ChatMessagePersistenceDb,
  type ChatMessageTransactionClient,
} from "../src/messages.ts";
import type { SnapshotSealResult } from "../../snapshot/src/snapshot-sealer.ts";

test("chat message persistence does not insert when snapshot sealing fails", async () => {
  const db = recordingDb();
  const result = await persistChatMessageAfterSnapshotSeal(db, {
    thread_id: "11111111-1111-4111-a111-111111111111",
    role: "assistant",
    blocks: [{ type: "text", text: "unsealed answer" }],
    content_hash: "sha256:unsealed",
    sealSnapshot: async () => failedSealResult(),
  });

  assert.equal(result.ok, false);
  assert.equal(db.queries.some((query) => query.text.includes("insert into chat_messages")), false);
});

test("chat message persistence does not insert when verification result is inconsistent", async () => {
  const db = recordingDb();
  const result = await persistChatMessageAfterSnapshotSeal(db, {
    thread_id: "11111111-1111-4111-a111-111111111111",
    role: "assistant",
    blocks: [{ type: "text", text: "unverified answer" }],
    content_hash: "sha256:unverified",
    sealSnapshot: async () => ({
      ...successfulSealResult(),
      verification: { ok: false, failures: [] },
    }),
  });

  assert.equal(result.ok, false);
  assert.equal(db.queries.some((query) => query.text.includes("insert into chat_messages")), false);
});

test("chat message persistence inserts only after snapshot sealing succeeds", async () => {
  const steps: string[] = [];
  const db = recordingDb(steps);

  const result = await persistChatMessageAfterSnapshotSeal(db, {
    thread_id: "11111111-1111-4111-a111-111111111111",
    role: "assistant",
    blocks: [{ type: "text", text: "sealed answer" }],
    content_hash: "sha256:sealed",
    sealSnapshot: async () => {
      steps.push("seal");
      return successfulSealResult();
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.message.snapshot_id, "22222222-2222-4222-a222-222222222222");
  assert.deepEqual(steps, ["seal", "begin", "insert", "update-thread", "commit"]);

  const insert = db.queries.find((query) => query.text.includes("insert into chat_messages"));
  assert.ok(insert, "expected chat message insert");
  assert.deepEqual(insert.values?.slice(0, 5), [
    "11111111-1111-4111-a111-111111111111",
    "assistant",
    "22222222-2222-4222-a222-222222222222",
    JSON.stringify([{ type: "text", text: "sealed answer" }]),
    "sha256:sealed",
  ]);
});

test("chat message persistence rejects unpinned executors before sealing", async () => {
  const db = unpinnedRecordingDb();

  await assert.rejects(
    () =>
      persistChatMessageAfterSnapshotSeal(db, {
        thread_id: "11111111-1111-4111-a111-111111111111",
        role: "assistant",
        blocks: [{ type: "text", text: "sealed answer" }],
        content_hash: "sha256:sealed",
        sealSnapshot: async () => {
          throw new Error("seal must not run");
        },
      }),
    /requires a pinned transaction client/,
  );
});

test("chat message persistence rejects pool-like executors before branding", () => {
  assert.throws(
    () =>
      chatMessageTransactionClient({
        query: async () => ({ rows: [] }),
        connect: async () => {
          throw new Error("must use pool wrapper");
        },
      }),
    /use persistChatMessageAfterSnapshotSealWithPool for pools/,
  );
});

test("chat message persistence with pool pins insert transaction to one client", async () => {
  const steps: string[] = [];
  const client = recordingDb(steps);
  const pool: ChatMessageClientPool & { releasedWith: Error | undefined } = {
    releasedWith: undefined,
    connect: async () => client,
  };
  client.release = (error?: Error) => {
    pool.releasedWith = error;
    steps.push("release");
  };

  const result = await persistChatMessageAfterSnapshotSealWithPool(pool, {
    thread_id: "11111111-1111-4111-a111-111111111111",
    role: "assistant",
    blocks: [{ type: "text", text: "sealed answer" }],
    content_hash: "sha256:sealed",
    sealSnapshot: async () => {
      steps.push("seal");
      return successfulSealResult();
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(steps, ["seal", "begin", "insert", "update-thread", "commit", "release"]);
  assert.equal(pool.releasedWith, undefined);
});

test("chat message persistence adapter wires coordinator persistence through seal gate", async () => {
  const steps: string[] = [];
  const client = recordingDb(steps);
  client.release = () => {
    steps.push("release");
  };
  const persist = createChatMessagePersistence({
    pool: {
      connect: async () => client,
    },
    sealSnapshot: async (message) => {
      steps.push(`seal:${message.threadId}:${message.role}`);
      return successfulSealResult();
    },
  });

  const result = await persist({
    threadId: "11111111-1111-4111-a111-111111111111",
    runId: "run-1",
    turnId: "turn-1",
    role: "assistant",
    blocks: [{ type: "text", text: "sealed answer" }],
    content_hash: "sha256:sealed",
  });

  assert.deepEqual(result, {
    snapshot_id: "22222222-2222-4222-a222-222222222222",
    message_id: "33333333-3333-4333-a333-333333333333",
  });
  assert.deepEqual(steps, [
    "seal:11111111-1111-4111-a111-111111111111:assistant",
    "begin",
    "insert",
    "update-thread",
    "commit",
    "release",
  ]);
});

test("chat message persistence adapter rejects failed seals without inserting", async () => {
  const client = recordingDb();
  const persist = createChatMessagePersistence({
    pool: {
      connect: async () => {
        throw new Error("pool must not connect after failed seal");
      },
    },
    sealSnapshot: async () => failedSealResult(),
  });

  await assert.rejects(
    () =>
      persist({
        threadId: "11111111-1111-4111-a111-111111111111",
        runId: "run-1",
        turnId: "turn-1",
        role: "assistant",
        blocks: [{ type: "text", text: "unsealed answer" }],
        content_hash: "sha256:unsealed",
      }),
    /snapshot seal failed/,
  );
  assert.equal(client.queries.some((query) => query.text.includes("insert into chat_messages")), false);
});

test("chat message persistence adapter rejects inconsistent verification without pool checkout", async () => {
  const persist = createChatMessagePersistence({
    pool: {
      connect: async () => {
        throw new Error("pool must not connect after inconsistent verification");
      },
    },
    sealSnapshot: async () => ({
      ...successfulSealResult(),
      verification: { ok: false, failures: [] },
    }),
  });

  await assert.rejects(
    () =>
      persist({
        threadId: "11111111-1111-4111-a111-111111111111",
        runId: "run-1",
        turnId: "turn-1",
        role: "assistant",
        blocks: [{ type: "text", text: "unverified answer" }],
        content_hash: "sha256:unverified",
      }),
    /snapshot seal failed/,
  );
});

function successfulSealResult(): SnapshotSealResult {
  return {
    ok: true,
    verification: { ok: true, failures: [] },
    snapshot: {
      snapshot_id: "22222222-2222-4222-a222-222222222222",
      created_at: "2026-04-29T00:00:00.000Z",
      subject_refs: [],
      fact_refs: [],
      claim_refs: [],
      event_refs: [],
      document_refs: [],
      series_specs: [],
      source_ids: [],
      tool_call_ids: [],
      tool_call_result_hashes: [],
      as_of: "2026-04-29T00:00:00.000Z",
      basis: "reported",
      normalization: "raw",
      coverage_start: null,
      allowed_transforms: {},
      model_version: null,
      parent_snapshot: null,
    },
  };
}

function failedSealResult(): SnapshotSealResult {
  return {
    ok: false,
    verification: {
      ok: false,
      failures: [],
    },
  };
}

function recordingDb(steps: string[] = []): ChatMessageTransactionClient & {
  queries: Array<{ text: string; values?: unknown[] }>;
  release?(error?: Error): void;
} {
  return chatMessageTransactionClient(unpinnedRecordingDb(steps));
}

function unpinnedRecordingDb(steps: string[] = []): ChatMessagePersistenceDb & {
  queries: Array<{ text: string; values?: unknown[] }>;
  release?(error?: Error): void;
} {
  const queries: Array<{ text: string; values?: unknown[] }> = [];
  return {
    queries,
    query: async (text, values) => {
      queries.push({ text, values });
      if (text === "begin") {
        steps.push("begin");
        return { rows: [] };
      }
      if (text === "commit") {
        steps.push("commit");
        return { rows: [] };
      }
      if (text === "rollback") return { rows: [] };
      if (text.includes("insert into chat_messages")) {
        steps.push("insert");
        return {
          rows: [
            {
              message_id: "33333333-3333-4333-a333-333333333333",
              thread_id: values?.[0],
              role: values?.[1],
              snapshot_id: values?.[2],
              blocks: JSON.parse(String(values?.[3])),
              content_hash: values?.[4],
              created_at: "2026-04-29T00:00:00.000Z",
            },
          ],
        };
      }
      if (text.includes("update chat_threads")) {
        steps.push("update-thread");
        return { rows: [] };
      }
      throw new Error(`Unexpected query: ${text}`);
    },
  };
}
