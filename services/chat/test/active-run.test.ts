// The thread's messages read reports the caller's turn still in flight (#332),
// and the stream route attaches to a turn by its ids without ever starting one.
import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import { createChatCoordinator, type ChatAnalystToolRuntime, type ChatCoordinator, type ChatTurnRunner } from "../src/coordinator.ts";
import type { ChatReadMessage } from "../src/messages.ts";
import { financialMessageId } from "../src/chat-ids.ts";
import { deferred, parseSseEvents, startChatTestServer } from "./sse-helpers.ts";
import { buildRow, fakeDb, THREAD_ID, USER_ID } from "./threads-fixtures.ts";

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";

// Each turn emits turn.started, waits for its gate, then completes naming
// message m-<runId>, or fails when its run id starts with "fail".
function gatedCoordinator() {
  const gates = new Map<string, ReturnType<typeof deferred<void>>>();
  const ran: string[] = [];
  const gate = (runId: string) => {
    let entry = gates.get(runId);
    if (!entry) {
      entry = deferred();
      gates.set(runId, entry);
    }
    return entry;
  };
  const runner: ChatTurnRunner = async ({ runId, emit }) => {
    ran.push(runId);
    emit("turn.started", { bundle_id: "test" });
    await gate(runId).promise;
    if (runId.startsWith("fail")) {
      emit("turn.error", { error_code: "boom", message: "boom" });
      return;
    }
    emit("turn.completed", { message_id: `m-${runId}` });
  };
  const coordinator = createChatCoordinator({ runner });
  return {
    coordinator,
    ran,
    gate: (runId: string) => ({ release: () => gate(runId).resolve() }),
  };
}

const messages = (...ids: string[]) => ids.map((message_id) => ({ message_id }));

const verifiedRuntime: ChatAnalystToolRuntime = async () => ({
  snapshot_id: "s-1",
  verification: { ok: true, failures: [] },
  blocks: [{ id: "block-1", kind: "rich_text", segments: [{ type: "text", text: "Answer." }] }],
});

async function settle(coordinator: ChatCoordinator, input: { threadId: string; runId: string; userId: string; turnId?: string }) {
  await coordinator.findTurn({ turnId: input.runId, ...input })!.completed;
}

test("readThread reports the running turn, then the queued one, for its user and thread only", async () => {
  const { coordinator, gate } = gatedCoordinator();
  coordinator.getOrCreateTurn({ threadId: "thread-1", runId: "run-1", userId: U1, userIntent: "Analyze NVDA" });
  coordinator.getOrCreateTurn({ threadId: "thread-1", runId: "run-2", turnId: "turn-2", userId: U1, userIntent: "Compare AMD" });
  await new Promise((resolve) => setImmediate(resolve));

  const read = (userId: string, threadId: string, rows = messages()) =>
    coordinator.readThread({ userId, threadId }, async () => rows).then((result) => result?.activeRun ?? null);

  assert.deepEqual(await read(U1, "thread-1"), { runId: "run-1", turnId: "run-1" });
  assert.equal(await read(U2, "thread-1"), null);
  assert.equal(await read(U1, "thread-2"), null);

  gate("run-1").release();
  await settle(coordinator, { threadId: "thread-1", runId: "run-1", userId: U1 });
  assert.deepEqual(await read(U1, "thread-1", messages("m-run-1")), { runId: "run-2", turnId: "turn-2" });

  gate("run-2").release();
  await settle(coordinator, { threadId: "thread-1", runId: "run-2", turnId: "turn-2", userId: U1 });
  assert.equal(await read(U1, "thread-1", messages("m-run-1", "m-run-2")), null);
});

test("readThread reports a queued turn before its runner starts", async () => {
  const { coordinator, ran } = gatedCoordinator();
  coordinator.getOrCreateTurn({ threadId: "thread-1", runId: "run-1", userId: U1 });
  assert.deepEqual(ran, []);

  const result = await coordinator.readThread({ userId: U1, threadId: "thread-1" }, async () => messages());
  assert.deepEqual(result, { messages: [], activeRun: { runId: "run-1", turnId: "run-1" }, runs: [{ runId: "run-1", turnId: "run-1", status: "in_flight" }] });
});

test("a turn that emitted turn.completed is not active while its runner is still returning", async () => {
  const returned = deferred();
  const coordinator = createChatCoordinator({
    runner: async ({ emit }) => {
      emit("turn.started", {});
      emit("turn.completed", { message_id: "m-1" });
      await returned.promise;
    },
  });
  const turn = coordinator.getOrCreateTurn({ threadId: "thread-1", runId: "run-1", userId: U1 });
  await turn.waitForEventCount(2);

  const result = await coordinator.readThread({ userId: U1, threadId: "thread-1" }, async () => messages());
  assert.deepEqual(result, { messages: [], activeRun: null, runs: [{ runId: "run-1", turnId: "run-1", status: "completed", messageId: "m-1" }] });
  assert.equal(coordinator.stats().completedTurnCount, 0);
  returned.resolve();
});

test("a turn that failed with turn.error is not active", async () => {
  const { coordinator, gate } = gatedCoordinator();
  coordinator.getOrCreateTurn({ threadId: "thread-1", runId: "fail-1", userId: U1 });
  await new Promise((resolve) => setImmediate(resolve));
  const read = () => coordinator.readThread({ userId: U1, threadId: "thread-1" }, async () => messages()).then((result) => result?.activeRun ?? null);

  assert.deepEqual(await read(), { runId: "fail-1", turnId: "fail-1" });
  gate("fail-1").release();
  await settle(coordinator, { threadId: "thread-1", runId: "fail-1", userId: U1 });
  assert.equal(await read(), null);
});

test("a turn that completes during the read is dropped when the read holds its answer, reported when it doesn't", async () => {
  for (const [rows, expected] of [
    [messages("m-run-1"), null],
    [messages(), { runId: "run-1", turnId: "run-1" }],
  ] as const) {
    const { coordinator, gate } = gatedCoordinator();
    coordinator.getOrCreateTurn({ threadId: "thread-1", runId: "run-1", userId: U1 });
    await new Promise((resolve) => setImmediate(resolve));

    const result = await coordinator.readThread({ userId: U1, threadId: "thread-1" }, async () => {
      gate("run-1").release();
      await settle(coordinator, { threadId: "thread-1", runId: "run-1", userId: U1 });
      return rows;
    });
    assert.deepEqual(result?.activeRun, expected);
  }
});

test("a turn created during the read is reported", async () => {
  const { coordinator } = gatedCoordinator();
  const result = await coordinator.readThread({ userId: U1, threadId: "thread-1" }, async () => {
    coordinator.getOrCreateTurn({ threadId: "thread-1", runId: "run-1", userId: U1 });
    return messages();
  });
  assert.deepEqual(result?.activeRun, { runId: "run-1", turnId: "run-1" });
});

test("a thread the caller doesn't own reveals no run", async () => {
  const { coordinator } = gatedCoordinator();
  coordinator.getOrCreateTurn({ threadId: "thread-1", runId: "run-1", userId: U1 });
  assert.equal(await coordinator.readThread({ userId: U1, threadId: "thread-1" }, async () => null), null);
});

test("readThread lists the caller's retained runs on the thread, oldest first, with each one's status", async () => {
  const { coordinator, gate } = gatedCoordinator();
  coordinator.getOrCreateTurn({ threadId: "thread-1", runId: "run-1", userId: U1 });
  coordinator.getOrCreateTurn({ threadId: "thread-1", runId: "fail-2", userId: U1 });
  coordinator.getOrCreateTurn({ threadId: "thread-1", runId: "run-3", turnId: "turn-3", userId: U1 });
  coordinator.getOrCreateTurn({ threadId: "thread-1", runId: "run-other", userId: U2 });
  coordinator.getOrCreateTurn({ threadId: "thread-2", runId: "run-elsewhere", userId: U1 });
  gate("run-1").release();
  await settle(coordinator, { threadId: "thread-1", runId: "run-1", userId: U1 });
  gate("fail-2").release();
  await settle(coordinator, { threadId: "thread-1", runId: "fail-2", userId: U1 });

  const result = await coordinator.readThread({ userId: U1, threadId: "thread-1" }, async () => messages("m-run-1"));
  assert.deepEqual(result?.runs, [
    { runId: "run-1", turnId: "run-1", status: "completed", messageId: "m-run-1" },
    { runId: "fail-2", turnId: "fail-2", status: "failed" },
    { runId: "run-3", turnId: "turn-3", status: "in_flight" },
  ]);
  assert.deepEqual(result?.activeRun, { runId: "run-3", turnId: "turn-3" });
});

test("readThread lists a run that ended during the read by its status after the read", async () => {
  const { coordinator, gate } = gatedCoordinator();
  coordinator.getOrCreateTurn({ threadId: "thread-1", runId: "run-1", userId: U1 });
  await new Promise((resolve) => setImmediate(resolve));
  const result = await coordinator.readThread({ userId: U1, threadId: "thread-1" }, async () => {
    gate("run-1").release();
    await settle(coordinator, { threadId: "thread-1", runId: "run-1", userId: U1 });
    return messages();
  });
  assert.deepEqual(result?.runs, [{ runId: "run-1", turnId: "run-1", status: "completed", messageId: "m-run-1" }]);
  assert.deepEqual(result?.activeRun, { runId: "run-1", turnId: "run-1" });
});

test("readThread reports a run completed once the read holds its saved answer, before its stream ends", async () => {
  const saved: { message_id: string }[] = [];
  const commit = deferred<void>();
  const committed = deferred<void>();
  const coordinator = createChatCoordinator({
    analystToolRuntime: verifiedRuntime,
    persistAssistantMessage: async (input) => {
      saved.push({ message_id: input.message_id });
      committed.resolve();
      await commit.promise;
      return { message_id: input.message_id, thread_id: input.threadId, role: "assistant", snapshot_id: "s-1", blocks: [] } as unknown as ChatReadMessage;
    },
  });
  const turn = coordinator.getOrCreateTurn({ threadId: "thread-1", runId: "run-1", userId: U1, userIntent: "Analyze NVDA" });
  await committed.promise;

  const result = await coordinator.readThread({ userId: U1, threadId: "thread-1" }, async () => [...saved]);
  assert.deepEqual(result?.runs, [{ runId: "run-1", turnId: "run-1", status: "completed", messageId: saved[0].message_id }]);
  assert.equal(result?.activeRun, null);

  commit.resolve();
  await turn.completed;
  assert.equal(turn.events.at(-1)?.message_id, saved[0].message_id);
});

test("a financial turn's in-progress notice is not saved under the id its published answer takes", async () => {
  const saved: string[] = [];
  const coordinator = createChatCoordinator({
    financialRuntime: {
      answers: () => true,
      run: async () => ({ kind: "gap", reason_code: "run_in_progress", text: "This calculation is already running." }),
      assertReady: async () => {},
    },
    persistAssistantMessage: async (input) => {
      saved.push(input.message_id);
      return { message_id: input.message_id, thread_id: input.threadId, role: "assistant", snapshot_id: "s-1", blocks: [] } as unknown as ChatReadMessage;
    },
  });
  await coordinator.getOrCreateTurn({ threadId: "thread-1", runId: "run-1", userId: U1, userIntent: "NVDA free cash flow" }).completed;

  assert.equal(saved.length, 1);
  assert.notEqual(saved[0], financialMessageId("thread-1", "run-1"));
});

test("a retried run of a turn saves its answer under its own id", async () => {
  const saved: string[] = [];
  const coordinator = createChatCoordinator({
    analystToolRuntime: verifiedRuntime,
    persistAssistantMessage: async (input) => {
      saved.push(input.message_id);
      return { message_id: input.message_id, thread_id: input.threadId, role: "assistant", snapshot_id: "s-1", blocks: [] } as unknown as ChatReadMessage;
    },
  });
  await coordinator.getOrCreateTurn({ threadId: "thread-1", runId: "run-1", turnId: "turn-1", userId: U1, userIntent: "Analyze NVDA" }).completed;
  await coordinator.getOrCreateTurn({ threadId: "thread-1", runId: "run-2", turnId: "turn-1", userId: U1, userIntent: "Analyze NVDA" }).completed;

  assert.equal(saved.length, 2);
  assert.notEqual(saved[0], saved[1]);
});

test("readThread lists no run once its retention has passed and it is tombstoned", async () => {
  let clock = 1_000;
  const coordinator = createChatCoordinator({
    runner: async ({ emit }) => {
      emit("turn.completed", { message_id: "m-1" });
    },
    completedTurnRetentionMs: 100,
    now: () => clock,
  });
  await coordinator.getOrCreateTurn({ threadId: "thread-1", runId: "run-1", userId: U1 }).completed;
  const read = () => coordinator.readThread({ userId: U1, threadId: "thread-1" }, async () => messages("m-1"));
  assert.deepEqual((await read())?.runs, [{ runId: "run-1", turnId: "run-1", status: "completed", messageId: "m-1" }]);

  clock += 101;
  assert.deepEqual(await read(), { messages: messages("m-1"), activeRun: null, runs: [] });
  assert.equal(coordinator.stats().completedTurnTombstoneCount, 1);
});

test("readThread lists a run whose runner returned without a terminal event as failed", async () => {
  const coordinator = createChatCoordinator({ runner: async ({ emit }) => {
    emit("turn.started", {});
  } });
  await coordinator.getOrCreateTurn({ threadId: "thread-1", runId: "run-1", userId: U1 }).completed;
  const result = await coordinator.readThread({ userId: U1, threadId: "thread-1" }, async () => messages());
  assert.deepEqual(result, { messages: [], activeRun: null, runs: [{ runId: "run-1", turnId: "run-1", status: "failed" }] });
});

test("findTurn finds a turn by its ids whatever input started it, and creates nothing", async () => {
  const { coordinator, ran } = gatedCoordinator();
  const started = coordinator.getOrCreateTurn({ threadId: "thread-1", runId: "run-1", turnId: "turn-1", userId: U1, userIntent: "Analyze NVDA" });

  assert.equal(coordinator.findTurn({ userId: U1, threadId: "thread-1", runId: "run-1", turnId: "turn-1" }), started);
  assert.equal(coordinator.findTurn({ userId: U2, threadId: "thread-1", runId: "run-1", turnId: "turn-1" }), null);
  assert.equal(coordinator.findTurn({ userId: U1, threadId: "thread-1", runId: "run-9", turnId: "turn-9" }), null);
  assert.equal(coordinator.stats().retainedTurnCount, 1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(ran, ["run-1"]);
});

// The HTTP surface: the messages GET and the stream route's attach mode.

const STREAM = `/v1/chat/threads/${THREAD_ID}/stream`;
const MESSAGES = `/v1/chat/threads/${THREAD_ID}/messages`;
const ANSWER_ROW = {
  message_id: "33333333-3333-4333-a333-333333333333",
  thread_id: THREAD_ID,
  role: "assistant",
  snapshot_id: "22222222-2222-4222-a222-222222222222",
  blocks: [],
  content_hash: "sha256:abc",
  created_at: "2026-05-06T00:00:00.000Z",
};

async function startStack(t: TestContext, rows: () => unknown[] = () => []) {
  const { coordinator, gate, ran } = gatedCoordinator();
  const { db } = fakeDb(({ text, values }) => {
    if (text.includes("from chat_threads")) return values?.includes(USER_ID) ? [buildRow({ owned: true })] : [];
    if (text.includes("from chat_messages")) return rows();
    if (text.includes("from snapshots") || text.includes("from snapshot_financial_runs")) return [];
    throw new Error(`unexpected query: ${text}`);
  });
  const base = await startChatTestServer(t, { threadsDb: db, coordinator });
  return { base, coordinator, gate, ran };
}

async function getMessages(base: string, userId = USER_ID) {
  const response = await fetch(`${base}${MESSAGES}`, { headers: { "x-user-id": userId } });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

// Reads the stream until `count` events have arrived, then closes it.
async function readEvents(response: Response, count: number) {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let transcript = "";
  while (parseSseEvents(transcript).filter((event) => event.event !== "heartbeat").length < count) {
    const { value, done } = await reader.read();
    if (done) break;
    transcript += decoder.decode(value, { stream: true });
  }
  await reader.cancel();
  return parseSseEvents(transcript).filter((event) => event.event !== "heartbeat").slice(0, count);
}

test("GET messages carries active_run: null and no runs when nothing runs", async (t) => {
  const { base } = await startStack(t, () => [ANSWER_ROW]);
  const { status, body } = await getMessages(base);
  assert.equal(status, 200);
  assert.deepEqual(Object.keys(body), ["messages", "active_run", "runs"]);
  assert.equal(body.active_run, null);
  assert.deepEqual(body.runs, []);
  assert.deepEqual((body.messages as Array<{ message_id: string }>).map((m) => m.message_id), ["33333333-3333-4333-a333-333333333333"]);
});

test("GET messages reports the stream-started run while it runs, 404s for another user, and lists it as completed once done", async (t) => {
  const { base, coordinator, gate } = await startStack(t);
  const stream = await fetch(`${base}${STREAM}?run_id=run-1&turn_id=turn-1&user_intent=Analyze%20NVDA`, { headers: { "x-user-id": USER_ID } });
  assert.equal(stream.status, 200);
  await readEvents(stream, 1);

  assert.deepEqual(await getMessages(base), { status: 200, body: { messages: [], active_run: { run_id: "run-1", turn_id: "turn-1" }, runs: [{ run_id: "run-1", turn_id: "turn-1", status: "in_flight" }] } });
  assert.equal((await getMessages(base, "55555555-5555-4555-8555-555555555555")).status, 404);

  gate("run-1").release();
  await coordinator.findTurn({ userId: USER_ID, threadId: THREAD_ID, runId: "run-1", turnId: "turn-1" })!.completed;
  assert.deepEqual(await getMessages(base), {
    status: 200,
    body: { messages: [], active_run: null, runs: [{ run_id: "run-1", turn_id: "turn-1", status: "completed", message_id: "m-run-1" }] },
  });
});

test("attach=1 replays a known turn from seq 1 with only its ids, and 404s an unknown one without starting it", async (t) => {
  const { base, coordinator, ran } = await startStack(t);
  const headers = { "x-user-id": USER_ID };

  const unknown = await fetch(`${base}${STREAM}?run_id=run-1&turn_id=turn-1&attach=1`, { headers });
  assert.equal(unknown.status, 404);
  assert.deepEqual(await unknown.json(), { error: "turn not found" });
  assert.equal(coordinator.stats().retainedTurnCount, 0);
  assert.deepEqual(ran, []);

  const own = await fetch(`${base}${STREAM}?run_id=run-1&turn_id=turn-1&user_intent=Analyze%20NVDA`, { headers });
  await readEvents(own, 1);
  const attached = await fetch(`${base}${STREAM}?run_id=run-1&turn_id=turn-1&attach=1`, { headers });
  assert.equal(attached.status, 200);
  assert.deepEqual((await readEvents(attached, 1)).map((event) => [event.id, event.event, event.data.run_id]), [["1", "turn.started", "run-1"]]);
  assert.deepEqual(ran, ["run-1"]);

  const otherUser = await fetch(`${base}${STREAM}?run_id=run-1&turn_id=turn-1&attach=1`, { headers: { "x-user-id": "55555555-5555-4555-8555-555555555555" } });
  assert.equal(otherUser.status, 404);
  assert.deepEqual(await otherUser.json(), { error: "chat thread not found" });
});
