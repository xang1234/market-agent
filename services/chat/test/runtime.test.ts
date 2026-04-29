import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadChatServerOptionsFromEnv } from "../src/runtime.ts";

test("runtime config returns stub chat options when persistence module is not configured", async () => {
  assert.deepEqual(await loadChatServerOptionsFromEnv({}), {});
});

test("runtime config loads assistant persistence from configured module", async () => {
  const dir = await mkdtemp(join(tmpdir(), "chat-runtime-"));
  const modulePath = join(dir, "persistence.mjs");
  await writeFile(
    modulePath,
    "export async function persistAssistantMessage() { return { snapshot_id: 'snapshot-1', message_id: 'message-1' }; }",
  );

  const options = await loadChatServerOptionsFromEnv({
    CHAT_PERSISTENCE_MODULE: `file://${modulePath}`,
  });

  assert.equal(typeof options.persistAssistantMessage, "function");
  assert.deepEqual(await options.persistAssistantMessage!({
    threadId: "thread-1",
    runId: "run-1",
    turnId: "turn-1",
    role: "assistant",
    blocks: [],
    content_hash: "sha256:test",
  }), {
    snapshot_id: "snapshot-1",
    message_id: "message-1",
  });
});
