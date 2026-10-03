import assert from "node:assert/strict";
import test from "node:test";
import {
  chatMessageTransactionClient,
  createChatMessagePersistence,
  listChatMessagesForThread,
  persistImportedArtifactMessage,
  persistChatMessageAfterSnapshotSeal,
  persistChatMessageAfterSnapshotSealWithPool,
  type ChatMessageClientPool,
  type ChatMessagePersistenceDb,
  type ChatMessageTransactionClient,
} from "../src/messages.ts";
import type { SnapshotSealResult } from "../../snapshot/src/snapshot-sealer.ts";
import { fakeQuery } from "./fake-query.ts";

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
      // @ts-expect-error -- deliberately passes an unpinned executor to prove it is rejected at runtime
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

test("chat message persistence accepts acquired pg clients that expose connect and release", () => {
  const client = unpinnedRecordingDb();
  const acquiredPgClient = Object.assign(client, {
    async connect() {
      throw new Error("acquired clients must not be reacquired");
    },
  });

  assert.doesNotThrow(() => chatMessageTransactionClient(acquiredPgClient));
  assert.deepEqual(client.queries, []);
});

test("chat message persistence rejects query-only pool wrappers before branding", () => {
  const client = unpinnedRecordingDb();
  const queryOnlyWrapper = {
    query: client.query.bind(client),
  };

  assert.throws(
    () => chatMessageTransactionClient(queryOnlyWrapper),
    /requires an acquired transaction client/i,
  );
  assert.deepEqual(client.queries, []);
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

test("listChatMessagesForThread returns ordered messages for an owned thread", async () => {
  const db = messageListDb((text) => {
    if (text.includes("from chat_threads")) return [{ owned: true }];
    if (text.includes("from chat_messages")) {
      return [
        {
          message_id: "33333333-3333-4333-a333-333333333333",
          thread_id: "11111111-1111-4111-a111-111111111111",
          role: "assistant",
          snapshot_id: "22222222-2222-4222-a222-222222222222",
          blocks: [{ id: "block-1", kind: "rich_text" }],
          content_hash: "sha256:abc",
          created_at: "2026-05-06T00:00:00.000Z",
        },
      ];
    }
    if (text.includes("from snapshots") || text.includes("from snapshot_financial_runs")) return [];
    throw new Error(`unexpected query: ${text}`);
  });

  const result = await listChatMessagesForThread(db, {
    thread_id: "11111111-1111-4111-a111-111111111111",
    user_id: "00000000-0000-4000-8000-000000000001",
  });

  assert.ok(result);
  assert.equal(result.messages.length, 1);
  assert.equal(result.messages[0].message_id, "33333333-3333-4333-a333-333333333333");
  assert.deepEqual(result.messages[0].blocks, [{ id: "block-1", kind: "rich_text" }]);
  assert.match(db.queries[1].text, /order by m\.created_at asc, m\.message_id asc/);
  // The answering model is read back with each message (#183).
  assert.match(db.queries[1].text, /m\.answered_by/);
  assert.deepEqual(db.queries[0].values, [
    "11111111-1111-4111-a111-111111111111",
    "00000000-0000-4000-8000-000000000001",
  ]);
});

test("a read message carries each block's own proof: only the certified result is verified (#193)", async () => {
  const SNAPSHOT = "22222222-2222-4222-a222-222222222222";
  const FACT = "00000000-0000-4000-8000-0000000000f1";
  const HASH = "a".repeat(64);
  const db = messageListDb((text) => {
    if (text.includes("from chat_threads")) return [{ owned: true }];
    if (text.includes("from chat_messages")) {
      return [{
        message_id: "33333333-3333-4333-a333-333333333333",
        thread_id: "11111111-1111-4111-a111-111111111111",
        role: "assistant",
        snapshot_id: SNAPSHOT,
        blocks: [
          { id: "certified", kind: "financial_answer", presentation_hash: HASH, financial: { run_id: "run-1", unit_id: "unit-1" } },
          // Narrative beside it, claiming a status in its own JSON.
          { id: "narrative", kind: "rich_text", segments: [{ type: "text", text: "Margins widened." }], proof: { calculation: "verified", public_by_cutoff: "proven" } },
          { id: "table", kind: "metric_row", items: [{ label: "Revenue", value_ref: FACT, format: "$1B" }] },
        ],
        content_hash: "sha256:abc",
        created_at: "2026-05-06T00:00:00.000Z",
      }];
    }
    if (text.includes("from snapshots")) {
      return [{ snapshot_id: SNAPSHOT, fact_refs: [FACT], claim_refs: [], event_refs: [], document_refs: [], source_ids: [], series_specs: [] }];
    }
    if (text.includes("from snapshot_financial_runs")) {
      return [{ snapshot_id: SNAPSHOT, run_id: "run-1", unit_id: "unit-1", presentation_hash: HASH }];
    }
    throw new Error(`unexpected query: ${text}`);
  });

  const result = await listChatMessagesForThread(db, {
    thread_id: "11111111-1111-4111-a111-111111111111",
    user_id: "00000000-0000-4000-8000-000000000001",
  });

  assert.deepEqual({ ...result?.messages[0].block_proofs }, {
    certified: { evidence: "linked", calculation: "verified", public_by_cutoff: "proven" },
    narrative: { evidence: "unknown", calculation: "not_verified", public_by_cutoff: "unknown" },
    table: { evidence: "linked", calculation: "not_verified", public_by_cutoff: "unknown" },
  });
});

test("any string is a block id, __proto__ included: its proof is serialized (#193)", async () => {
  const db = messageListDb((text) => {
    if (text.includes("from chat_threads")) return [{ owned: true }];
    if (text.includes("from chat_messages")) {
      return [{
        message_id: "33333333-3333-4333-a333-333333333333",
        thread_id: "11111111-1111-4111-a111-111111111111",
        role: "assistant",
        snapshot_id: null,
        blocks: [{ id: "__proto__", kind: "financial_answer", presentation_hash: "a".repeat(64), financial: { run_id: "r", unit_id: "u" } }],
        content_hash: "sha256:abc",
        created_at: "2026-05-06T00:00:00.000Z",
      }];
    }
    throw new Error(`unexpected query: ${text}`);
  });
  const result = await listChatMessagesForThread(db, {
    thread_id: "11111111-1111-4111-a111-111111111111",
    user_id: "00000000-0000-4000-8000-000000000001",
  });
  assert.deepEqual(JSON.parse(JSON.stringify(result?.messages[0].block_proofs)), JSON.parse(
    '{"__proto__":{"evidence":"unknown","calculation":"not_verified","public_by_cutoff":"unknown"}}',
  ));
});

test("each block is judged against its own snapshot, as imported blocks keep theirs (#193)", async () => {
  const ROW = "22222222-2222-4222-a222-222222222222";
  const ORIGIN = "44444444-4444-4444-a444-444444444444";
  const HASH = "a".repeat(64);
  const queried: unknown[] = [];
  const db = messageListDb((text, values) => {
    if (text.includes("from chat_threads")) return [{ owned: true }];
    if (text.includes("from chat_messages")) {
      return [{
        message_id: "33333333-3333-4333-a333-333333333333",
        thread_id: "11111111-1111-4111-a111-111111111111",
        role: "assistant",
        snapshot_id: ROW,
        blocks: [
          // Imported from another snapshot, where its certificate lives.
          { id: "imported", snapshot_id: ORIGIN, kind: "financial_answer", presentation_hash: HASH, financial: { run_id: "run-1", unit_id: "unit-1" } },
          // Claims the row snapshot's certificate, which does not cover it.
          { id: "local", snapshot_id: ROW, kind: "financial_answer", presentation_hash: HASH, financial: { run_id: "run-1", unit_id: "unit-1" } },
          { id: "malformed", snapshot_id: "not-a-uuid", kind: "rich_text", segments: [] },
        ],
        content_hash: "sha256:abc",
        created_at: "2026-05-06T00:00:00.000Z",
      }];
    }
    if (text.includes("from snapshots")) {
      queried.push(values?.[0]);
      return [ROW, ORIGIN].map((snapshot_id) => ({ snapshot_id, fact_refs: [], claim_refs: [], event_refs: [], document_refs: [], source_ids: [], series_specs: [] }));
    }
    if (text.includes("from snapshot_financial_runs")) return [{ snapshot_id: ORIGIN, run_id: "run-1", unit_id: "unit-1", presentation_hash: HASH }];
    throw new Error(`unexpected query: ${text}`);
  });
  const result = await listChatMessagesForThread(db, {
    thread_id: "11111111-1111-4111-a111-111111111111",
    user_id: "00000000-0000-4000-8000-000000000001",
  });
  const proofs = { ...result?.messages[0].block_proofs };
  assert.equal(proofs.imported.calculation, "verified", "certified in the snapshot it came from");
  assert.equal(proofs.local.calculation, "not_verified", "the row snapshot holds no certificate for it");
  assert.deepEqual(queried, [[ROW, ORIGIN]], "malformed ids never reach the uuid cast");
});

test("blocks sharing an id share no proof: the id claims nothing (#193)", async () => {
  const SNAPSHOT = "22222222-2222-4222-a222-222222222222";
  const HASH = "a".repeat(64);
  const db = messageListDb((text) => {
    if (text.includes("from chat_threads")) return [{ owned: true }];
    if (text.includes("from chat_messages")) {
      return [{
        message_id: "33333333-3333-4333-a333-333333333333",
        thread_id: "11111111-1111-4111-a111-111111111111",
        role: "assistant",
        snapshot_id: SNAPSHOT,
        blocks: [
          { id: "same", kind: "financial_answer", presentation_hash: HASH, financial: { run_id: "run-1", unit_id: "unit-1" } },
          { id: "same", kind: "rich_text", segments: [{ type: "text", text: "Uncertified." }] },
        ],
        content_hash: "sha256:abc",
        created_at: "2026-05-06T00:00:00.000Z",
      }];
    }
    if (text.includes("from snapshots")) {
      return [{ snapshot_id: SNAPSHOT, fact_refs: [], claim_refs: [], event_refs: [], document_refs: [], source_ids: [], series_specs: [] }];
    }
    if (text.includes("from snapshot_financial_runs")) return [{ snapshot_id: SNAPSHOT, run_id: "run-1", unit_id: "unit-1", presentation_hash: HASH }];
    throw new Error(`unexpected query: ${text}`);
  });
  const result = await listChatMessagesForThread(db, {
    thread_id: "11111111-1111-4111-a111-111111111111",
    user_id: "00000000-0000-4000-8000-000000000001",
  });
  assert.deepEqual({ ...result?.messages[0].block_proofs }, {
    same: { evidence: "unknown", calculation: "not_verified", public_by_cutoff: "unknown" },
  });
});

test("listChatMessagesForThread returns null and does not read messages for wrong-user threads", async () => {
  const db = messageListDb((text) => {
    if (text.includes("from chat_threads")) return [];
    throw new Error(`unexpected query: ${text}`);
  });

  const result = await listChatMessagesForThread(db, {
    thread_id: "11111111-1111-4111-a111-111111111111",
    user_id: "00000000-0000-4000-8000-000000000002",
  });

  assert.equal(result, null);
  assert.equal(db.queries.length, 1);
});

test("persistImportedArtifactMessage inserts an add-only assistant message for an owned thread", async () => {
  const db = importedMessageDb((text, values) => {
    if (text.includes("from chat_threads")) return [{ owned: true }];
    if (text.includes("insert into chat_messages")) {
      return [
        {
          message_id: "33333333-3333-4333-a333-333333333333",
          thread_id: values?.[0],
          role: values?.[2],
          snapshot_id: values?.[3],
          blocks: JSON.parse(String(values?.[4])),
          content_hash: values?.[5],
          created_at: "2026-05-06T00:00:00.000Z",
        },
      ];
    }
    throw new Error(`unexpected query: ${text}`);
  });

  const result = await persistImportedArtifactMessage(db, {
    thread_id: "11111111-1111-4111-a111-111111111111",
    user_id: "00000000-0000-4000-8000-000000000001",
    role: "assistant",
    snapshot_id: "22222222-2222-4222-a222-222222222222",
    blocks: [{ id: "block-1", kind: "rich_text", snapshot_id: "22222222-2222-4222-a222-222222222222" }],
    content_hash: "sha256:imported",
  });

  assert.ok(result);
  assert.equal(result.snapshot_id, "22222222-2222-4222-a222-222222222222");
  assert.deepEqual(result.blocks, [
    { id: "block-1", kind: "rich_text", snapshot_id: "22222222-2222-4222-a222-222222222222" },
  ]);
  assert.equal(db.queries.some((query) => query.text.includes("latest_snapshot_id")), false);
  assert.deepEqual(db.queries[0].values, [
    "11111111-1111-4111-a111-111111111111",
    "00000000-0000-4000-8000-000000000001",
  ]);
});

test("persistImportedArtifactMessage returns null and does not insert for wrong-user threads", async () => {
  const db = importedMessageDb((text) => {
    if (text.includes("from chat_threads")) return [];
    throw new Error(`unexpected query: ${text}`);
  });

  const result = await persistImportedArtifactMessage(db, {
    thread_id: "11111111-1111-4111-a111-111111111111",
    user_id: "00000000-0000-4000-8000-000000000002",
    role: "assistant",
    snapshot_id: "22222222-2222-4222-a222-222222222222",
    blocks: [{ id: "block-1", kind: "rich_text", snapshot_id: "22222222-2222-4222-a222-222222222222" }],
    content_hash: "sha256:imported",
  });

  assert.equal(result, null);
  assert.equal(db.queries.length, 1);
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
    release() {
      // Test clients model an acquired pool client; release behavior is asserted
      // explicitly in pool-backed persistence tests.
    },
    query: fakeQuery(async (text, values) => {
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
    }),
  };
}

function messageListDb(
  responder: (text: string, values?: unknown[]) => Record<string, unknown>[],
): ChatMessagePersistenceDb & { queries: Array<{ text: string; values?: unknown[] }> } {
  const queries: Array<{ text: string; values?: unknown[] }> = [];
  return {
    queries,
    query: fakeQuery(async (text, values) => {
      queries.push({ text, values });
      return { rows: responder(text, values) };
    }),
  };
}

function importedMessageDb(
  responder: (text: string, values?: unknown[]) => Record<string, unknown>[],
): ChatMessagePersistenceDb & { queries: Array<{ text: string; values?: unknown[] }> } {
  const queries: Array<{ text: string; values?: unknown[] }> = [];
  return {
    queries,
    query: fakeQuery(async (text, values) => {
      queries.push({ text, values });
      return { rows: responder(text, values) };
    }),
  };
}
