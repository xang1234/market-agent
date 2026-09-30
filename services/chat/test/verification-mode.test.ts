import assert from "node:assert/strict";
import test from "node:test";

import {
  createChatCoordinator,
  type ChatAnalystToolRuntime,
  type ChatCoordinatorOptions,
} from "../src/coordinator.ts";
import { ChatSnapshotSealError } from "../src/messages.ts";
import { readChatVerificationMode } from "../src/runtime.ts";

const SNAPSHOT_ID = "11111111-1111-4111-a111-111111111111";
const BLOCK = {
  id: "block-revenue-1",
  kind: "revenue_bars",
  snapshot_id: SNAPSHOT_ID,
  data_ref: { kind: "chat_turn", id: "run-1" },
  source_refs: [],
  as_of: "2026-05-06T00:00:00.000Z",
  bars: [{ label: "Q1", value_ref: "fact-1" }],
};

function runtime(verification: { ok: boolean; failures: unknown[] }): ChatAnalystToolRuntime {
  return async (context) => ({
    snapshot_id: SNAPSHOT_ID,
    verification: verification as never,
    tool_calls: [{ tool_call_id: "tool-1", tool_name: "get_quote", status: "ok", bundle_id: context.bundleId }],
    blocks: [BLOCK],
  });
}

const RUNTIME_FAILURE = { ok: false, failures: [{ reason_code: "missing_fact_ref", details: {} }] };

async function runTurn(options: ChatCoordinatorOptions) {
  const turn = createChatCoordinator(options).getOrCreateTurn({ threadId: "thread-1", runId: "run-1" });
  await turn.completed;
  return turn.events as ReadonlyArray<Record<string, unknown> & { type: string }>;
}

test("strict mode: a failed runtime verification is a turn.error with no blocks (default)", async () => {
  const events = await runTurn({ analystToolRuntime: runtime(RUNTIME_FAILURE) });

  assert.equal(events.at(-1)?.type, "turn.error");
  assert.equal(events.at(-1)?.error_code, "snapshot_verification_failed");
  assert.equal(events.some((event) => event.type.startsWith("block.")), false);
});

test("display_unverified: a failed runtime verification still shows the blocks, unsaved, with reasons", async () => {
  let persisted = 0;
  const events = await runTurn({
    analystToolRuntime: runtime(RUNTIME_FAILURE),
    verificationMode: "display_unverified",
    persistAssistantMessage: async () => {
      persisted += 1;
      throw new Error("must not persist an unverified answer");
    },
  });

  assert.equal(persisted, 0);
  assert.equal(events.some((event) => event.type === "turn.error"), false);
  assert.deepEqual(
    events.filter((event) => event.type === "block.began").map((event) => event.block_id),
    [BLOCK.id],
  );
  const completed = events.at(-1)!;
  assert.equal(completed.type, "turn.completed");
  assert.equal(completed.message_id, undefined);
  assert.deepEqual(completed.unverified, {
    persisted: false,
    failures: [{ reason_code: "missing_fact_ref", details: {} }],
    blocks: [BLOCK],
  });
});

test("display_unverified: a failed snapshot seal still shows the blocks, unsaved, with the seal's reasons", async () => {
  const sealFailures = [{ reason_code: "fact_binding_mismatch", details: { fact_id: "fact-1" } }];
  const events = await runTurn({
    analystToolRuntime: runtime({ ok: true, failures: [] }),
    verificationMode: "display_unverified",
    persistAssistantMessage: async () => {
      throw new ChatSnapshotSealError(sealFailures);
    },
  });

  assert.equal(events.some((event) => event.type === "turn.error"), false);
  assert.deepEqual(events.at(-1)?.unverified, { persisted: false, failures: sealFailures, blocks: [BLOCK] });
});

test("strict mode: a failed snapshot seal is still a turn.error", async () => {
  const events = await runTurn({
    analystToolRuntime: runtime({ ok: true, failures: [] }),
    persistAssistantMessage: async () => {
      throw new ChatSnapshotSealError([{ reason_code: "fact_binding_mismatch", details: {} }]);
    },
  });

  assert.equal(events.at(-1)?.type, "turn.error");
  assert.equal(events.some((event) => event.type.startsWith("block.")), false);
});

test("display_unverified does not mask infrastructure errors from persistence", async () => {
  const events = await runTurn({
    analystToolRuntime: runtime({ ok: true, failures: [] }),
    verificationMode: "display_unverified",
    persistAssistantMessage: async () => {
      throw new Error("connection terminated");
    },
  });

  assert.equal(events.at(-1)?.type, "turn.error");
  assert.equal(events.at(-1)?.message, "connection terminated");
});

test("CHAT_VERIFICATION_MODE defaults to strict and rejects unknown values", () => {
  assert.equal(readChatVerificationMode({}), "strict");
  assert.equal(readChatVerificationMode({ CHAT_VERIFICATION_MODE: "display_unverified" }), "display_unverified");
  assert.throws(() => readChatVerificationMode({ CHAT_VERIFICATION_MODE: "lenient" }), /CHAT_VERIFICATION_MODE/);
});

test("CHAT_VERIFICATION_MODE=display_unverified refuses to start in production", () => {
  assert.throws(
    () => readChatVerificationMode({ CHAT_VERIFICATION_MODE: "display_unverified", NODE_ENV: "production" }),
    /not allowed in production/,
  );
  assert.equal(readChatVerificationMode({ CHAT_VERIFICATION_MODE: "strict", NODE_ENV: "production" }), "strict");
});
