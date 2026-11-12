import assert from "node:assert/strict";
import test from "node:test";
import { createChatCoordinator, type ChatAnalystToolRuntime } from "../src/coordinator.ts";
import type { ChatWorkSummarySave } from "../src/work-summary.ts";
import { readMessage } from "./read-message-fixture.ts";

const SNAPSHOT_ID = "11111111-1111-4111-a111-111111111111";
const MESSAGE_ID = "33333333-3333-4333-a333-333333333333";

function clockedTurn(options: { verified: boolean; save: ChatWorkSummarySave }) {
  let clock = 1_000;
  const runtime: ChatAnalystToolRuntime = async (context) => {
    clock += 2_500;
    return {
      snapshot_id: SNAPSHOT_ID,
      verification: options.verified ? { ok: true, failures: [] } : { ok: false, failures: [{ reason_code: "missing_fact_ref", details: {} }] },
      tool_calls: [{ tool_call_id: "tool-1", tool_name: "get_quote", status: "ok", bundle_id: context.bundleId, arguments: { symbol: "NVDA" } }],
      blocks: [{
        id: "block-1",
        kind: "rich_text",
        snapshot_id: SNAPSHOT_ID,
        data_ref: { kind: "chat_turn", id: context.turnId ?? context.runId },
        source_refs: [],
        as_of: "2026-05-06T00:00:00.000Z",
        segments: [{ type: "text", text: "NVDA beat AMD." }],
      }],
    };
  };
  const coordinator = createChatCoordinator({
    now: () => clock,
    analystToolRuntime: runtime,
    persistAssistantMessage: async () => {
      clock += 700;
      return readMessage({ snapshot_id: SNAPSHOT_ID, message_id: MESSAGE_ID });
    },
    saveWorkSummary: options.save,
  });
  return coordinator.getOrCreateTurn({ threadId: "thread-1", runId: "run-1" });
}

test("a completed turn saves when each plan event was emitted, by the coordinator's clock, and its completion carries the same summary", async () => {
  const saved: unknown[] = [];
  const turn = clockedTurn({ verified: true, save: async (input) => { saved.push(input); } });
  await turn.completed;

  const work_summary = {
    elapsed_ms: 3_200,
    events: [
      { type: "turn.started", at_ms: 0, bundle_id: "single_subject_analysis" },
      { type: "tool.started", at_ms: 2_500, tool_call_id: "tool-1", tool_name: "get_quote", bundle_id: "single_subject_analysis" },
      { type: "tool.completed", at_ms: 2_500, tool_call_id: "tool-1", tool_name: "get_quote", status: "ok", bundle_id: "single_subject_analysis" },
      { type: "snapshot.staged", at_ms: 3_200, snapshot_id: SNAPSHOT_ID, status: "staged" },
      { type: "snapshot.sealed", at_ms: 3_200, snapshot_id: SNAPSHOT_ID, status: "sealed" },
      { type: "block.began", at_ms: 3_200, block_id: "block-1", kind: "rich_text" },
      { type: "block.completed", at_ms: 3_200, block_id: "block-1" },
    ],
  };
  assert.deepEqual(saved, [{ thread_id: "thread-1", message_id: MESSAGE_ID, work_summary }]);
  const completed = turn.events.at(-1)!;
  assert.equal(completed.type, "turn.completed");
  assert.deepEqual((completed.message as { work_summary: unknown }).work_summary, work_summary);
});

test("a turn that saved no answer records no work summary", async () => {
  const saved: unknown[] = [];
  const turn = clockedTurn({ verified: false, save: async (input) => { saved.push(input); } });
  await turn.completed;

  assert.equal(turn.events.at(-1)!.type, "turn.error");
  assert.deepEqual(saved, []);
});

test("a work summary that fails to save is logged, and the turn still completes with it", async (t) => {
  const logged = t.mock.method(console, "error", () => {});
  const turn = clockedTurn({ verified: true, save: async () => { throw new Error("db down"); } });
  await turn.completed;

  assert.equal(turn.events.at(-1)!.type, "turn.completed");
  assert.equal((turn.events.at(-1)!.message as { work_summary: { elapsed_ms: number } }).work_summary.elapsed_ms, 3_200);
  assert.deepEqual(logged.mock.calls.map((call) => call.arguments[0]), ["[chat] saving the turn's work summary failed"]);
});

test("what a turn does before its first event is timed into its start, and a bare repeat of turn.started is left out as its stream leaves it out", async () => {
  let clock = 0;
  const saved: unknown[] = [];
  const coordinator = createChatCoordinator({
    now: () => clock,
    saveWorkSummary: async (input) => { saved.push(input); },
    runner: ({ emit }) => {
      clock += 1_500;
      emit("tool.started", { tool_call_id: "resolve-1", tool_name: "resolve_subjects" });
      clock += 400;
      emit("turn.started");
      emit("tool.completed", { tool_call_id: "resolve-1", tool_name: "resolve_subjects", status: "ok", resolution_status: "resolved" });
      clock += 100;
      emit("turn.completed", { message_id: MESSAGE_ID });
    },
  });
  const turn = coordinator.getOrCreateTurn({ threadId: "thread-1", runId: "run-1" });
  await turn.completed;

  assert.deepEqual(saved, [{
    thread_id: "thread-1",
    message_id: MESSAGE_ID,
    work_summary: {
      elapsed_ms: 2_000,
      events: [
        { type: "turn.started", at_ms: 0 },
        { type: "tool.started", at_ms: 1_500, tool_call_id: "resolve-1", tool_name: "resolve_subjects" },
        { type: "tool.completed", at_ms: 1_900, tool_call_id: "resolve-1", tool_name: "resolve_subjects", status: "ok", resolution_status: "resolved" },
      ],
    },
  }]);
  assert.deepEqual(turn.events.map((event) => event.type), ["turn.started", "tool.started", "tool.completed", "turn.completed"]);
});
