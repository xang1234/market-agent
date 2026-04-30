// Verification tests for fra-cty: SSE reconnect with last-seq resume.
//
// The existing tests in http.test.ts ("stream route resumes strictly after
// Last-Event-ID" and friends) all use a synchronous stub that emits every
// event before the first client read returns — so the resume path is
// effectively exercised against a fully-populated history rather than a
// mid-flight stream. The bead's verification step ("Simulate 5s disconnect
// mid-stream") asks for proof that the coordinator KEEPS producing events
// while the client is disconnected and that the reconnect picks up the
// events emitted during that gap. These tests fill that gap with async
// runners gated on deferred promises so we can deterministically interleave
// emissions, disconnects, and reconnects without sleep-based flakiness.

import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";

import { createChatCoordinator, type ChatTurnRunner } from "../src/coordinator.ts";
import { createChatServer } from "../src/http.ts";

type ParsedSseEvent = {
  id: string | null;
  event: string | null;
  data: Record<string, unknown>;
};

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

function parseSseEvents(transcript: string): ParsedSseEvent[] {
  return transcript
    .split("\n\n")
    .filter((block) => block.trim() !== "")
    .map((block) => {
      const event: ParsedSseEvent = { id: null, event: null, data: {} };
      for (const line of block.split("\n")) {
        if (line.startsWith("id: ")) event.id = line.slice("id: ".length);
        else if (line.startsWith("event: ")) event.event = line.slice("event: ".length);
        else if (line.startsWith("data: ")) {
          event.data = JSON.parse(line.slice("data: ".length)) as Record<string, unknown>;
        }
      }
      return event;
    });
}

// Continues reading data events from an already-acquired reader until we
// accumulate `expectedCount` total non-heartbeat events. Returns the raw
// event list (filters heartbeats — they fire on idle streams and would
// otherwise inflate event counts when we wait through a gap).
//
// Assumes the stream stays open and eventually produces at least
// `expectedCount` non-heartbeat events. If the runner can error after
// emitting fewer events while the server keeps the stream open (e.g., via
// the heartbeat interval), this loop blocks on reader.read() until the
// outer test timeout fires — masking the real failure as a generic
// "test timed out". For tests where the runner can fail, race this
// against the turn handle's `completed` promise and assert on the failure
// path explicitly.
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

// Convenience: open a reader and read the first `expectedCount` non-heartbeat
// events. Returns both the events and the reader/decoder/transcript state so
// the caller can keep reading from the same stream after the initial drain.
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

async function startServer(
  t: TestContext,
  options: Parameters<typeof createChatServer>[0],
): Promise<string> {
  const server = createChatServer(options);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

test("reconnect resumes from missed sequence emitted while the client was disconnected", { timeout: 10000 }, async (t) => {
  // Three deferred gates carve the runner into three phases: emit 1-3, wait
  // for client to disconnect, emit 4-6 into coordinator history with no client
  // subscribed, wait for client to reconnect, emit 7-9 to the resumed stream.
  const clientDisconnected = deferred();
  const clientReconnected = deferred();
  const runnerCompleted = deferred();

  const runner: ChatTurnRunner = async ({ emit }) => {
    emit("turn.started", { phase: "pre-disconnect" });
    emit("tool.started", { tool_call_id: "tc-1", phase: "pre-disconnect" });
    emit("tool.completed", { tool_call_id: "tc-1", phase: "pre-disconnect" });

    await clientDisconnected.promise;

    // These three events are emitted into coordinator history while NO client
    // is subscribed to the stream. The bead's contract says reconnect must
    // recover them.
    emit("snapshot.staged", { snapshot_id: "snap-1", phase: "during-disconnect" });
    emit("snapshot.sealed", { snapshot_id: "snap-1", phase: "during-disconnect" });
    emit("block.began", { block_id: "b1", phase: "during-disconnect" });

    await clientReconnected.promise;

    emit("block.delta", { block_id: "b1", phase: "post-reconnect" });
    emit("block.completed", { block_id: "b1", phase: "post-reconnect" });
    emit("turn.completed", { message_id: "msg-1", phase: "post-reconnect" });

    runnerCompleted.resolve();
  };

  const base = await startServer(t, {
    coordinator: createChatCoordinator({ runner }),
  });

  // Phase 1: connect and read the three pre-disconnect events.
  const initial = await fetch(`${base}/v1/chat/threads/thread-cty/stream?run_id=run-cty`);
  assert.equal(initial.status, 200);
  const { events: preDisconnect, reader } = await readDataEventsWithReader(initial, 3);
  assert.deepEqual(preDisconnect.map((e) => e.id), ["1", "2", "3"]);

  // Disconnect mid-stream. Cancelling the reader closes the underlying socket;
  // node:http fires `req.close` on the server, which the chat server's cleanup
  // handler observes — the turn does NOT abort, only the SSE writer
  // unsubscribes.
  await reader.cancel();
  clientDisconnected.resolve();

  // Wait for the during-disconnect events to actually land in coordinator
  // history before reconnecting. The runner is suspended on `await
  // clientDisconnected.promise`; resolving it queues the runner's
  // continuation as a microtask, and the three subsequent `emit()` calls
  // run synchronously inside that continuation. 20ms is a comfortable
  // bound for the event loop to drain that microtask queue. A more
  // deterministic barrier would require exposing a 6-event gate from the
  // turn handle (e.g., `turn.waitForEventCount(6)`); the helper exists
  // (`MutableChatTurnHandle.waitForEventCount`) but is not surfaced via
  // the coordinator interface.
  await new Promise((resolve) => setTimeout(resolve, 20));

  // Phase 2: reconnect and read the three during-disconnect events that were
  // emitted into history while we were gone.
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
  // No event ≤ resumed sequence is replayed.
  assert.equal(
    duringDisconnect.every((e) => Number(e.data.seq) > 3),
    true,
    "resume must not replay events at or below Last-Event-ID",
  );

  // Phase 3: release the runner's last batch and read it through the still-
  // open resumed stream. drainNonHeartbeats keeps reading from the same
  // reader — by the time it returns, the stream has produced 6 total non-
  // heartbeat events (the 3 from history + the 3 newly emitted).
  clientReconnected.resolve();

  const allEvents = await drainNonHeartbeats(resumedReader, resumedDecoder, resumedState, 6);
  await resumedReader.cancel();

  const postReconnect = allEvents.slice(3, 6);
  assert.deepEqual(postReconnect.map((e) => e.id), ["7", "8", "9"]);
  assert.equal(postReconnect[2].event, "turn.completed");

  // The whole turn ran to completion despite the mid-stream disconnect. This
  // is what protects assistant output on flaky networks.
  await runnerCompleted.promise;
});

test("turn keeps running server-side after a client disconnect — events accumulate in history", { timeout: 10000 }, async (t) => {
  // This test exists to make explicit the property the previous test relies
  // on: the request close handler unsubscribes the SSE writer but does NOT
  // signal the turn runner to stop. A regression that aborted the turn on
  // disconnect would surface here as a missing turn.completed in the snapshot
  // history.
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

  const base = await startServer(t, {
    coordinator: createChatCoordinator({ runner }),
  });

  const response = await fetch(`${base}/v1/chat/threads/thread-cty-2/stream?run_id=run-cty-2`);
  assert.equal(response.status, 200);
  const { reader } = await readDataEventsWithReader(response, 1);

  // Disconnect after receiving only turn.started.
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

  // Reconnect with Last-Event-ID: 1 and verify all 8 missed events are
  // available from coordinator history. This is the same shape as the bead's
  // "Reconnect yields events strictly after the resumed sequence" contract.
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
  // This test compresses the bead's "5s disconnect mid-stream" into a small
  // wall-clock window (~80ms) but keeps the realism: the client is fully
  // disconnected, real time passes, no new events land in history during
  // the gap, the client reconnects, and the stream stays open until the
  // runner produces more events. Heartbeats may land during the wait but
  // must not be confused with data events.
  const releaseEnd = deferred();
  const runner: ChatTurnRunner = async ({ emit }) => {
    emit("turn.started", { stub: true });
    emit("tool.started", { tool_call_id: "tc-3" });
    emit("tool.completed", { tool_call_id: "tc-3" });
    await releaseEnd.promise;
    emit("turn.completed", { message_id: "msg-cty-3" });
  };

  const base = await startServer(t, {
    coordinator: createChatCoordinator({ runner }),
  });

  const initial = await fetch(`${base}/v1/chat/threads/thread-cty-3/stream?run_id=run-cty-3`);
  assert.equal(initial.status, 200);
  const { events: pre, reader } = await readDataEventsWithReader(initial, 3);
  assert.deepEqual(pre.map((e) => e.id), ["1", "2", "3"]);

  await reader.cancel();

  // Real wall-clock gap with no server-side emissions in flight.
  await new Promise((resolve) => setTimeout(resolve, 80));

  const resumed = await fetch(`${base}/v1/chat/threads/thread-cty-3/stream?run_id=run-cty-3`, {
    headers: { "Last-Event-ID": "3" },
  });
  assert.equal(resumed.status, 200);

  // Schedule the runner's final event. Either delivery path is correct:
  //   (a) live — the timer fires AFTER the resumed connection has subscribed,
  //       and event 4 streams directly through the live subscriber, OR
  //   (b) replay — the timer fires BEFORE the subscription completes; event 4
  //       lands in turn history first, and the http handler's history-replay
  //       loop (`for (const event of turn.events) writeIfNew(event)` in
  //       services/chat/src/http.ts) delivers it on subscribe.
  // The test exercises whichever path the timing produces. A regression that
  // dropped the history-replay loop could make this test flaky on loaded
  // CI even though the assertions don't pin which path delivered event 4.
  setTimeout(() => releaseEnd.resolve(), 20);

  const { events: final, reader: finalReader } = await readDataEventsWithReader(resumed, 1);
  await finalReader.cancel();

  assert.equal(final.length, 1);
  assert.equal(final[0].id, "4");
  assert.equal(final[0].event, "turn.completed");
});
