// Pin the mid-stream-disconnect-and-resume contract: the runner must keep
// producing events while no client is subscribed, and a Last-Event-ID resume
// must recover them. The synchronous-stub tests in http.test.ts can't prove
// this because they finish emitting before the first read returns.

import test from "node:test";
import assert from "node:assert/strict";

import { createChatCoordinator, type ChatTurnRunner } from "../src/coordinator.ts";
import { deferred, parseSseEvents, startChatTestServer, type ParsedSseEvent } from "./sse-helpers.ts";

// Reads non-heartbeat events from `reader` into `state.transcript` until
// `expectedCount` accumulate. Heartbeats are filtered (they fire on idle
// streams and would otherwise inflate counts during a wait).
//
// Re-parses the full transcript per iteration: O(N²) in event count. Fine
// for small tests; replace with incremental parsing if reused for high
// event counts. If the runner can error while the server keeps the stream
// alive (heartbeat interval), this loop blocks until the test timeout —
// callers with fallible runners must race against the turn handle's
// `completed` promise.
async function drainNonHeartbeats(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  decoder: TextDecoder,
  state: { transcript: string },
  expectedCount: number,
): Promise<ParsedSseEvent[]> {
  let dataEvents = parseSseEvents(state.transcript).filter((e) => e.event !== "heartbeat");
  while (dataEvents.length < expectedCount) {
    const next = await reader.read();
    assert.equal(next.done, false, "expected the SSE stream to remain open");
    state.transcript += decoder.decode(next.value, { stream: true });
    dataEvents = parseSseEvents(state.transcript).filter((e) => e.event !== "heartbeat");
  }
  return dataEvents;
}

async function readDataEventsWithReader(
  response: Response,
  expectedCount: number,
): Promise<{
  events: ParsedSseEvent[];
  reader: ReadableStreamDefaultReader<Uint8Array>;
  decoder: TextDecoder;
  state: { transcript: string };
}> {
  const reader = response.body?.getReader();
  assert.ok(reader, "expected a readable stream body");
  const decoder = new TextDecoder();
  const state = { transcript: "" };
  const events = await drainNonHeartbeats(reader, decoder, state, expectedCount);
  return { events: events.slice(0, expectedCount), reader, decoder, state };
}

test("reconnect resumes from missed sequence emitted while the client was disconnected", { timeout: 10000 }, async (t) => {
  const clientDisconnected = deferred();
  const clientReconnected = deferred();
  const runnerCompleted = deferred();

  const runner: ChatTurnRunner = async ({ emit }) => {
    emit("turn.started", { phase: "pre-disconnect" });
    emit("tool.started", { tool_call_id: "tc-1", phase: "pre-disconnect" });
    emit("tool.completed", { tool_call_id: "tc-1", phase: "pre-disconnect" });

    await clientDisconnected.promise;

    emit("snapshot.staged", { snapshot_id: "snap-1", phase: "during-disconnect" });
    emit("snapshot.sealed", { snapshot_id: "snap-1", phase: "during-disconnect" });
    emit("block.began", { block_id: "b1", phase: "during-disconnect" });

    await clientReconnected.promise;

    emit("block.delta", { block_id: "b1", phase: "post-reconnect" });
    emit("block.completed", { block_id: "b1", phase: "post-reconnect" });
    emit("turn.completed", { message_id: "msg-1", phase: "post-reconnect" });

    runnerCompleted.resolve();
  };

  const base = await startChatTestServer(t, {
    coordinator: createChatCoordinator({ runner }),
  });

  const initial = await fetch(`${base}/v1/chat/threads/thread-cty/stream?run_id=run-cty`);
  assert.equal(initial.status, 200);
  const { events: preDisconnect, reader } = await readDataEventsWithReader(initial, 3);
  assert.deepEqual(preDisconnect.map((e) => e.id), ["1", "2", "3"]);

  await reader.cancel();
  clientDisconnected.resolve();

  // Resolving the gate queues the runner's continuation as a microtask; 20ms
  // bounds the event-loop drain so events 4-6 are in coordinator history
  // before the resume fetch lands. Coordinator doesn't expose a deterministic
  // event-count barrier (MutableChatTurnHandle.waitForEventCount exists but
  // is not surfaced).
  await new Promise((resolve) => setTimeout(resolve, 20));

  const resumed = await fetch(`${base}/v1/chat/threads/thread-cty/stream?run_id=run-cty`, {
    headers: { "Last-Event-ID": "3" },
  });
  assert.equal(resumed.status, 200);
  const {
    events: duringDisconnect,
    reader: resumedReader,
    decoder: resumedDecoder,
    state: resumedState,
  } = await readDataEventsWithReader(resumed, 3);

  assert.deepEqual(duringDisconnect.map((e) => e.id), ["4", "5", "6"]);
  assert.equal(duringDisconnect[0].event, "snapshot.staged");
  assert.equal(duringDisconnect[1].event, "snapshot.sealed");
  assert.equal(duringDisconnect[2].event, "block.began");
  assert.equal(
    duringDisconnect.every((e) => Number(e.data.seq) > 3),
    true,
    "resume must not replay events at or below Last-Event-ID",
  );

  clientReconnected.resolve();

  const allEvents = await drainNonHeartbeats(resumedReader, resumedDecoder, resumedState, 6);
  await resumedReader.cancel();

  const postReconnect = allEvents.slice(3, 6);
  assert.deepEqual(postReconnect.map((e) => e.id), ["7", "8", "9"]);
  assert.equal(postReconnect[2].event, "turn.completed");

  await runnerCompleted.promise;
});

test("turn keeps running server-side after a client disconnect — events accumulate in history", { timeout: 10000 }, async (t) => {
  const clientDisconnected = deferred();
  const runnerCompleted = deferred<string[]>();

  const emittedKinds: string[] = [];
  const runner: ChatTurnRunner = async ({ emit }) => {
    emit("turn.started", { stub: true });
    emittedKinds.push("turn.started");

    await clientDisconnected.promise;

    const payloadFor: Record<string, Record<string, unknown>> = {
      "tool.started": { tool_call_id: "tc-2" },
      "tool.completed": { tool_call_id: "tc-2" },
      "snapshot.staged": { snapshot_id: "snap-2" },
      "snapshot.sealed": { snapshot_id: "snap-2" },
      "block.began": { block_id: "b2" },
      "block.delta": { block_id: "b2" },
      "block.completed": { block_id: "b2" },
      "turn.completed": { message_id: "msg-2" },
    };
    for (const kind of [
      "tool.started",
      "tool.completed",
      "snapshot.staged",
      "snapshot.sealed",
      "block.began",
      "block.delta",
      "block.completed",
      "turn.completed",
    ] as const) {
      emit(kind, { ...payloadFor[kind], phase: "post-disconnect" });
      emittedKinds.push(kind);
    }
    runnerCompleted.resolve(emittedKinds.slice());
  };

  const base = await startChatTestServer(t, {
    coordinator: createChatCoordinator({ runner }),
  });

  const response = await fetch(`${base}/v1/chat/threads/thread-cty-2/stream?run_id=run-cty-2`);
  assert.equal(response.status, 200);
  const { reader } = await readDataEventsWithReader(response, 1);

  await reader.cancel();
  clientDisconnected.resolve();

  const finalEmitted = await runnerCompleted.promise;
  assert.deepEqual(finalEmitted, [
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

  const resumed = await fetch(`${base}/v1/chat/threads/thread-cty-2/stream?run_id=run-cty-2`, {
    headers: { "Last-Event-ID": "1" },
  });
  assert.equal(resumed.status, 200);
  const { events: missed, reader: missedReader } = await readDataEventsWithReader(resumed, 8);
  await missedReader.cancel();

  assert.deepEqual(missed.map((e) => e.id), ["2", "3", "4", "5", "6", "7", "8", "9"]);
  assert.deepEqual(missed.map((e) => e.event), [
    "tool.started",
    "tool.completed",
    "snapshot.staged",
    "snapshot.sealed",
    "block.began",
    "block.delta",
    "block.completed",
    "turn.completed",
  ]);
});

test("reconnect across a wall-clock gap with no new emissions delivers nothing until the runner releases more events", { timeout: 10000 }, async (t) => {
  const releaseEnd = deferred();
  const runner: ChatTurnRunner = async ({ emit }) => {
    emit("turn.started", { stub: true });
    emit("tool.started", { tool_call_id: "tc-3" });
    emit("tool.completed", { tool_call_id: "tc-3" });
    await releaseEnd.promise;
    emit("turn.completed", { message_id: "msg-cty-3" });
  };

  const base = await startChatTestServer(t, {
    coordinator: createChatCoordinator({ runner }),
  });

  const initial = await fetch(`${base}/v1/chat/threads/thread-cty-3/stream?run_id=run-cty-3`);
  assert.equal(initial.status, 200);
  const { events: pre, reader } = await readDataEventsWithReader(initial, 3);
  assert.deepEqual(pre.map((e) => e.id), ["1", "2", "3"]);

  await reader.cancel();
  await new Promise((resolve) => setTimeout(resolve, 80));

  const resumed = await fetch(`${base}/v1/chat/threads/thread-cty-3/stream?run_id=run-cty-3`, {
    headers: { "Last-Event-ID": "3" },
  });
  assert.equal(resumed.status, 200);

  // The timer may fire before or after the resumed connection subscribes.
  // Either delivery path is acceptable: live through the new subscriber, or
  // replay from history via http.ts's `for (const event of turn.events)
  // writeIfNew(event)` loop. A regression that dropped that replay loop
  // could make this test flaky on loaded CI.
  setTimeout(() => releaseEnd.resolve(), 20);

  const { events: final, reader: finalReader } = await readDataEventsWithReader(resumed, 1);
  await finalReader.cancel();

  assert.equal(final.length, 1);
  assert.equal(final[0].id, "4");
  assert.equal(final[0].event, "turn.completed");
});
