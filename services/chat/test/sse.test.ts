import test from "node:test";
import assert from "node:assert/strict";

import {
  CHAT_SSE_EVENT_TYPES,
  createChatSseEvent,
  createChatSseSequencer,
  stubSuccessEvents,
  type ChatSseEventType,
} from "../src/sse.ts";

const CONTEXT = { threadId: "thread-1", runId: "run-1", turnId: "turn-1" } as const;

// Minimal payload for each event kind so it satisfies the correlation-field
// contract. Using fixed ids for any kind that requires correlation; empty for
// kinds that do not.
const PAYLOAD_FOR_KIND: Record<ChatSseEventType, Record<string, unknown>> = {
  "turn.started": {},
  "turn.completed": {},
  "turn.error": {},
  "tool.started": { tool_call_id: "tc-1" },
  "tool.completed": { tool_call_id: "tc-1" },
  "snapshot.staged": { snapshot_id: "snap-1" },
  "snapshot.sealed": { snapshot_id: "snap-1" },
  "block.began": { block_id: "b-1" },
  "block.delta": { block_id: "b-1" },
  "block.completed": { block_id: "b-1" },
};

test("every one of the ten event kinds carries seq + turn_id + thread_id + run_id + type", () => {
  // Independent sequencer per kind so each event has seq=1 — the goal is to
  // confirm the universal-fields contract, not the monotonic property.
  for (const kind of CHAT_SSE_EVENT_TYPES) {
    const sequencer = createChatSseSequencer(CONTEXT);
    const event = sequencer.next(kind, PAYLOAD_FOR_KIND[kind]);
    assert.equal(event.type, kind, `expected event.type to equal kind ${kind}`);
    assert.ok(Number.isInteger(event.seq) && event.seq >= 1, `${kind}: seq must be a positive integer`);
    assert.equal(event.thread_id, CONTEXT.threadId, `${kind}: thread_id`);
    assert.equal(event.run_id, CONTEXT.runId, `${kind}: run_id`);
    assert.equal(event.turn_id, CONTEXT.turnId, `${kind}: turn_id`);
  }
});

test("turn_id defaults to run_id when the context omits it", () => {
  const sequencer = createChatSseSequencer({ threadId: "t", runId: "r" });
  const event = sequencer.next("turn.started");
  assert.equal(event.turn_id, "r");
});

test("sequencer produces strictly monotonically increasing seq across event kinds", () => {
  const sequencer = createChatSseSequencer(CONTEXT);
  const seqs: number[] = [];
  for (const kind of CHAT_SSE_EVENT_TYPES) {
    seqs.push(sequencer.next(kind, PAYLOAD_FOR_KIND[kind]).seq);
  }
  assert.deepEqual(seqs, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(sequencer.currentSeq(), 10);
});

test("payload fields are merged into the event, with universal fields winning on collision", () => {
  const sequencer = createChatSseSequencer(CONTEXT);
  const event = sequencer.next("turn.started", {
    custom: "value",
    // These should not override the universal fields the schema sets.
    type: "tool.started",
    seq: 999,
    thread_id: "OTHER",
    run_id: "OTHER",
    turn_id: "OTHER",
  });
  assert.equal(event.custom, "value");
  assert.equal(event.type, "turn.started");
  assert.equal(event.seq, 1);
  assert.equal(event.thread_id, CONTEXT.threadId);
  assert.equal(event.run_id, CONTEXT.runId);
  assert.equal(event.turn_id, CONTEXT.turnId);
});

test("block.* events require a non-empty block_id", () => {
  for (const kind of ["block.began", "block.delta", "block.completed"] as const) {
    const sequencer = createChatSseSequencer(CONTEXT);
    assert.throws(
      () => sequencer.next(kind, {}),
      new RegExp(`${kind.replace(".", "\\.")}\\.block_id is required`),
      `${kind}: missing block_id should throw`,
    );
    assert.throws(
      () => sequencer.next(kind, { block_id: "  " }),
      new RegExp(`${kind.replace(".", "\\.")}\\.block_id is required`),
      `${kind}: whitespace-only block_id should throw`,
    );
  }
});

test("tool.* events require a non-empty tool_call_id", () => {
  for (const kind of ["tool.started", "tool.completed"] as const) {
    const sequencer = createChatSseSequencer(CONTEXT);
    assert.throws(
      () => sequencer.next(kind, {}),
      new RegExp(`${kind.replace(".", "\\.")}\\.tool_call_id is required`),
    );
  }
});

test("snapshot.* events require a non-empty snapshot_id", () => {
  for (const kind of ["snapshot.staged", "snapshot.sealed"] as const) {
    const sequencer = createChatSseSequencer(CONTEXT);
    assert.throws(
      () => sequencer.next(kind, {}),
      new RegExp(`${kind.replace(".", "\\.")}\\.snapshot_id is required`),
    );
  }
});

test("turn.* events do not require any extra correlation field beyond the universal ones", () => {
  for (const kind of ["turn.started", "turn.completed", "turn.error"] as const) {
    const sequencer = createChatSseSequencer(CONTEXT);
    const event = sequencer.next(kind);
    assert.equal(event.type, kind);
    assert.equal(event.seq, 1);
  }
});

test("createChatSseEvent rejects non-positive or non-integer seq values", () => {
  for (const seq of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () => createChatSseEvent(CONTEXT, "turn.started", seq),
      /chat SSE event seq must be a positive integer/,
      `seq=${seq} should be rejected`,
    );
  }
});

test("stubSuccessEvents returns the nine canonical success-path events with monotonic seq and required correlation fields", () => {
  // turn.error is intentionally absent from the success-path stub — that is
  // the only one of the ten kinds reserved for the failure path.
  const sequencer = createChatSseSequencer(CONTEXT);
  const events = stubSuccessEvents(sequencer);

  assert.deepEqual(events.map((e) => e.type), [
    "turn.started",
    "tool.started",
    "tool.completed",
    "snapshot.staged",
    "snapshot.sealed",
    "block.began",
    "block.delta",
    "block.completed",
    "turn.completed",
  ]);
  assert.deepEqual(events.map((e) => e.seq), [1, 2, 3, 4, 5, 6, 7, 8, 9]);

  for (const event of events) {
    assert.equal(event.thread_id, CONTEXT.threadId);
    assert.equal(event.run_id, CONTEXT.runId);
    assert.equal(event.turn_id, CONTEXT.turnId);
  }
});
