import assert from "node:assert/strict";
import test from "node:test";
import {
  persistChatMessageAfterSnapshotSeal,
  type ChatMessagePersistenceDb,
} from "../src/messages.ts";

test("chat message persistence does not insert when snapshot sealing fails", async () => {
  const db = recordingDb();
  const result = await persistChatMessageAfterSnapshotSeal(db, {
    thread_id: "11111111-1111-4111-a111-111111111111",
    role: "assistant",
    blocks: [{ type: "text", text: "unsealed answer" }],
    content_hash: "sha256:unsealed",
    sealSnapshot: async () => ({
      ok: false,
      verification: { ok: false, failures: [{ reason_code: "missing_fact" }] },
    }) as never,
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
      return {
        ok: true,
        verification: { ok: true, failures: [] },
        snapshot: {
          snapshot_id: "22222222-2222-4222-a222-222222222222",
          created_at: "2026-04-29T00:00:00.000Z",
        },
      } as never;
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

function recordingDb(steps: string[] = []): ChatMessagePersistenceDb & {
  queries: Array<{ text: string; values?: unknown[] }>;
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
