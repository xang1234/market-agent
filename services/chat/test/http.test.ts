import http from "node:http";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { AddressInfo } from "node:net";
import test, { type TestContext } from "node:test";
import { createChatCoordinator, type ChatTurnRunner } from "../src/coordinator.ts";
import { createChatServer, createSseFrameWriter } from "../src/http.ts";

async function startServer(
  t: TestContext,
  options: Parameters<typeof createChatServer>[0] = {},
): Promise<string> {
  const server = createChatServer(options);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

async function getRaw(base: string, path: string): Promise<{ status: number; body: string }> {
  const url = new URL(base);
  return await new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: url.hostname,
        port: Number(url.port),
        method: "GET",
        path,
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          resolve({ status: res.statusCode ?? 0, body });
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

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
        if (line.startsWith("id: ")) {
          event.id = line.slice("id: ".length);
        } else if (line.startsWith("event: ")) {
          event.event = line.slice("event: ".length);
        } else if (line.startsWith("data: ")) {
          event.data = JSON.parse(line.slice("data: ".length)) as Record<string, unknown>;
        }
      }
      return event;
    });
}

async function readSseEvents(response: Response, expectedCount: number): Promise<ParsedSseEvent[]> {
  const reader = response.body?.getReader();
  assert.ok(reader, "expected a readable stream body");

  const decoder = new TextDecoder();
  let transcript = "";
  let events: ParsedSseEvent[] = [];

  while (events.length < expectedCount) {
    const next = await reader.read();
    assert.equal(next.done, false, "expected the SSE stream to remain open");
    transcript += decoder.decode(next.value, { stream: true });
    events = parseSseEvents(transcript);
  }

  await reader.cancel();
  return events.slice(0, expectedCount);
}

test("SSE writer disconnects clients that exceed the pending frame cap", () => {
  class SlowWritable extends EventEmitter {
    readonly frames: string[] = [];
    destroyedWith: Error | null = null;

    write(frame: string) {
      this.frames.push(frame);
      return false;
    }

    destroy(error: Error) {
      this.destroyedWith = error;
      return this;
    }
  }

  const writable = new SlowWritable();
  const writer = createSseFrameWriter(writable, { maxPendingFrames: 1 });

  writer.writeEvent({
    type: "turn.started",
    seq: 1,
    thread_id: "thread-1",
    run_id: "run-1",
    turn_id: "run-1",
  });
  writer.writeEvent({
    type: "turn.completed",
    seq: 2,
    thread_id: "thread-1",
    run_id: "run-1",
    turn_id: "run-1",
  });
  writer.writeHeartbeat({ threadId: "thread-1", runId: "run-1" });

  assert.equal(writable.frames.length, 1);
  assert.match(writable.destroyedWith?.message ?? "", /SSE client exceeded pending frame limit/);
});

test("SSE schema enumerates the ten coordinator event kinds", async () => {
  const { CHAT_SSE_EVENT_TYPES } = await import("../src/sse.ts");

  assert.deepEqual([...CHAT_SSE_EVENT_TYPES], [
    "turn.started",
    "tool.started",
    "tool.completed",
    "snapshot.staged",
    "snapshot.sealed",
    "block.began",
    "block.delta",
    "block.completed",
    "turn.completed",
    "turn.error",
  ]);
});

test("stream route returns 400 when run_id is missing", async (t) => {
  const base = await startServer(t);

  const response = await fetch(`${base}/v1/chat/threads/thread-123/stream`);
  const body = await response.json() as { error?: string };

  assert.equal(response.status, 400);
  assert.equal(body.error, "'run_id' is required");
});

test("server returns 404 for non-stream routes", async (t) => {
  const base = await startServer(t);

  const response = await fetch(`${base}/v1/chat/threads`);
  const body = await response.json() as { error?: string };

  assert.equal(response.status, 404);
  assert.equal(body.error, "not found");
});

test("server returns 400 for malformed percent-encoding in thread_id and stays alive", async (t) => {
  const base = await startServer(t);

  const malformed = await getRaw(base, "/v1/chat/threads/%ZZ/stream?run_id=run-456");
  assert.equal(malformed.status, 400);
  assert.equal(malformed.body, JSON.stringify({ error: "invalid request path" }));

  const response = await fetch(`${base}/v1/chat/threads/thread-123/stream?run_id=run-456`);
  assert.equal(response.status, 200);

  const reader = response.body?.getReader();
  assert.ok(reader, "expected a readable stream body");
  await reader.cancel();
});

test("stream route returns SSE headers for a valid request", async (t) => {
  const base = await startServer(t);

  const response = await fetch(
    `${base}/v1/chat/threads/thread-123/stream?run_id=run-456`,
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/event-stream");
  assert.equal(response.headers.get("cache-control"), "no-cache, no-transform");
  assert.equal(response.headers.get("connection"), "keep-alive");

  const reader = response.body?.getReader();
  assert.ok(reader, "expected a readable stream body");
  await reader.cancel();
});

test("stream route writes an immediate turn.started event", async (t) => {
  const base = await startServer(t);

  const response = await fetch(
    `${base}/v1/chat/threads/thread-123/stream?run_id=run-456`,
  );

  assert.equal(response.status, 200);
  const reader = response.body?.getReader();
  assert.ok(reader, "expected a readable stream body");

  const first = await reader.read();
  assert.equal(first.done, false);

  const chunk = new TextDecoder().decode(first.value);
  assert.match(chunk, /id: 1/);
  assert.match(chunk, /event: turn\.started/);
  assert.match(chunk, /"seq":1/);
  assert.match(chunk, /"thread_id":"thread-123"/);
  assert.match(chunk, /"run_id":"run-456"/);
  assert.match(chunk, /"turn_id":"run-456"/);
  assert.match(chunk, /"stub":true/);

  await reader.cancel();
});

test("stream route emits sequenced success-path coordinator events with correlation fields", async (t) => {
  const base = await startServer(t);

  const response = await fetch(
    `${base}/v1/chat/threads/thread-123/stream?run_id=run-456`,
  );

  assert.equal(response.status, 200);
  const events = await readSseEvents(response, 9);

  assert.deepEqual(events.map((event) => event.event), [
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

  for (const [index, event] of events.entries()) {
    const seq = index + 1;
    assert.equal(event.id, String(seq));
    assert.equal(event.data.type, event.event);
    assert.equal(event.data.seq, seq);
    assert.equal(event.data.thread_id, "thread-123");
    assert.equal(event.data.run_id, "run-456");
    assert.equal(event.data.turn_id, "run-456");
  }

  assert.equal(events[1].data.tool_call_id, "tool-call-1");
  assert.equal(events[2].data.tool_call_id, "tool-call-1");
  assert.equal(events[3].data.snapshot_id, "snapshot-1");
  assert.equal(events[4].data.snapshot_id, "snapshot-1");

  const blockEvents = events.slice(5, 8);
  assert.deepEqual(blockEvents.map((event) => event.data.block_id), ["block-1", "block-1", "block-1"]);
});

test("stream route resumes strictly after Last-Event-ID", async (t) => {
  const base = await startServer(t);

  const firstResponse = await fetch(
    `${base}/v1/chat/threads/thread-123/stream?run_id=run-456`,
  );
  assert.equal(firstResponse.status, 200);
  const firstEvents = await readSseEvents(firstResponse, 4);
  const lastDeliveredId = firstEvents.at(-1)?.id;
  assert.equal(lastDeliveredId, "4");

  const response = await fetch(
    `${base}/v1/chat/threads/thread-123/stream?run_id=run-456`,
    {
      headers: {
        "Last-Event-ID": lastDeliveredId,
      },
    },
  );

  assert.equal(response.status, 200);
  const events = await readSseEvents(response, 5);

  assert.deepEqual(events.map((event) => event.id), ["5", "6", "7", "8", "9"]);
  assert.deepEqual(events.map((event) => event.event), [
    "snapshot.sealed",
    "block.began",
    "block.delta",
    "block.completed",
    "turn.completed",
  ]);
  assert.equal(events.every((event) => Number(event.data.seq) > 4), true);
});

test("stream route leaves heartbeat outside the resume cursor", async (t) => {
  const base = await startServer(t);

  const firstResponse = await fetch(
    `${base}/v1/chat/threads/thread-123/stream?run_id=run-456`,
  );
  assert.equal(firstResponse.status, 200);
  await readSseEvents(firstResponse, 9);

  const response = await fetch(
    `${base}/v1/chat/threads/thread-123/stream?run_id=run-456`,
    {
      headers: {
        "Last-Event-ID": "9",
      },
    },
  );

  assert.equal(response.status, 200);
  const [heartbeat] = await readSseEvents(response, 1);

  assert.equal(heartbeat.id, null);
  assert.equal(heartbeat.event, "heartbeat");
  assert.equal(heartbeat.data.turn_id, "run-456");
});

test("stream route rejects resume for evicted turn history without rerunning the turn", async (t) => {
  const completedRuns: string[] = [];
  const coordinator = createChatCoordinator({
    maxCompletedTurns: 1,
    runner: ({ runId, emit }) => {
      completedRuns.push(runId);
      emit("turn.started", { stub: true });
      emit("turn.completed", { message_id: `message-${runId}` });
    },
  });
  const base = await startServer(t, { coordinator });

  const firstResponse = await fetch(
    `${base}/v1/chat/threads/thread-123/stream?run_id=run-1`,
  );
  assert.equal(firstResponse.status, 200);
  await readSseEvents(firstResponse, 2);

  const secondResponse = await fetch(
    `${base}/v1/chat/threads/thread-123/stream?run_id=run-2`,
  );
  assert.equal(secondResponse.status, 200);
  await readSseEvents(secondResponse, 2);

  const resume = await fetch(
    `${base}/v1/chat/threads/thread-123/stream?run_id=run-1`,
    {
      headers: {
        "Last-Event-ID": "1",
      },
    },
  );
  if (resume.status !== 400) {
    await resume.body?.cancel();
  }
  assert.equal(resume.status, 400);
  const body = await resume.json() as { error?: string };

  assert.equal(body.error, "'Last-Event-ID' is not available for this stream");
  assert.deepEqual(completedRuns, ["run-1", "run-2"]);
});

test("stream route rejects future Last-Event-ID without waiting for a running turn", async (t) => {
  const releaseTurn = deferred();
  const runner: ChatTurnRunner = async ({ emit }) => {
    emit("turn.started", { stub: true });
    await releaseTurn.promise;
    emit("turn.completed", { message_id: "message-1" });
  };
  const base = await startServer(t, {
    coordinator: createChatCoordinator({ runner }),
  });

  const initial = await fetch(
    `${base}/v1/chat/threads/thread-123/stream?run_id=run-456`,
  );
  assert.equal(initial.status, 200);
  await readSseEvents(initial, 1);

  const response = await Promise.race([
    fetch(`${base}/v1/chat/threads/thread-123/stream?run_id=run-456`, {
      headers: {
        "Last-Event-ID": "9",
      },
    }),
    new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 100)),
  ]);

  releaseTurn.resolve();

  assert.notEqual(response, "timeout");
  assert.equal(response.status, 400);
  const body = await response.json() as { error?: string };
  assert.equal(body.error, "'Last-Event-ID' is not available for this stream");
});

test("stream route rejects Last-Event-ID beyond available coordinator history", async (t) => {
  const base = await startServer(t);

  for (const lastEventId of ["10", "9007199254740991"]) {
    const response = await fetch(
      `${base}/v1/chat/threads/thread-123/stream?run_id=run-456`,
      {
        headers: {
          "Last-Event-ID": lastEventId,
        },
      },
    );
    const body = await response.json() as { error?: string };

    assert.equal(response.status, 400, `expected ${lastEventId} to be rejected`);
    assert.equal(body.error, "'Last-Event-ID' is not available for this stream");
  }
});

test("stream route rejects malformed Last-Event-ID values", async (t) => {
  const base = await startServer(t);

  for (const lastEventId of [
    "not-a-sequence",
    "1e3",
    "0x10",
    "+4",
    "4.0",
    "-1",
    "",
    "9007199254740993",
    "9".repeat(400),
  ]) {
    const response = await fetch(
      `${base}/v1/chat/threads/thread-123/stream?run_id=run-456`,
      {
        headers: {
          "Last-Event-ID": lastEventId,
        },
      },
    );
    const body = await response.json() as { error?: string };

    assert.equal(response.status, 400, `expected ${JSON.stringify(lastEventId)} to be rejected`);
    assert.equal(body.error, "'Last-Event-ID' must be a non-negative safe decimal integer");
  }
});

test("stream route stays open long enough to emit a heartbeat", async (t) => {
  const base = await startServer(t);

  const response = await fetch(
    `${base}/v1/chat/threads/thread-123/stream?run_id=run-456`,
  );

  assert.equal(response.status, 200);
  const reader = response.body?.getReader();
  assert.ok(reader, "expected a readable stream body");

  const decoder = new TextDecoder();
  let transcript = "";

  while (!transcript.includes("event: heartbeat")) {
    const next = await reader.read();
    assert.equal(next.done, false, "expected the SSE stream to remain open");
    transcript += decoder.decode(next.value, { stream: true });
  }

  assert.match(transcript, /event: turn\.started/);
  assert.match(transcript, /event: heartbeat/);

  await reader.cancel();
});
