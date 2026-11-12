// A turn's owner stops it: the turn ends with turn.stopped and saves no answer,
// unless its answer's save began first, when the stop is refused.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { type TestContext } from "node:test";
import type { Pool } from "pg";

import { dockerAvailable } from "../../../db/test/docker-pg.ts";
import { createEvidenceFinancialPort } from "../../financial-engine/src/evidence-adapter.ts";
import { IDS as ENGINE_IDS } from "../../financial-engine/test/db-fixtures.ts";

import { createChatCoordinator, type ChatAnalystToolRuntime, type ChatTurnRunner } from "../src/coordinator.ts";
import type { ChatReadMessage } from "../src/messages.ts";
import { parseLlmEnv } from "../../llm/src/channel-config.ts";
import { createLlmRouter } from "../../llm/src/router.ts";
import { chatDatabase, chatHarness, completed, revenueModel } from "./financial-fixtures.ts";
import { deferred, startChatTestServer } from "./sse-helpers.ts";
import { buildRow, fakeDb, THREAD_ID, USER_ID } from "./threads-fixtures.ts";

const U1 = "11111111-1111-4111-8111-111111111111";
const IDS = { userId: U1, threadId: "thread-1", runId: "run-1", turnId: "run-1" };
const TERMINAL = new Set(["turn.completed", "turn.error", "turn.stopped"]);

const answer: Awaited<ReturnType<ChatAnalystToolRuntime>> = {
  snapshot_id: "s-1",
  verification: { ok: true, failures: [] },
  blocks: [{ id: "block-1", kind: "rich_text", segments: [{ type: "text", text: "Answer." }] }],
};

// Saves through `gate` (when given) and records each save it began.
function persistence(gate?: Promise<void>) {
  const saves: string[] = [];
  const began = deferred<void>();
  return {
    saves,
    began: began.promise,
    persistAssistantMessage: async (input: { message_id: string; threadId: string }) => {
      saves.push(input.message_id);
      began.resolve();
      await gate;
      return { message_id: input.message_id, thread_id: input.threadId, role: "assistant", snapshot_id: "s-1", blocks: [] } as unknown as ChatReadMessage;
    },
  };
}

const types = (events: ReadonlyArray<{ type: string }>) => events.map((event) => event.type);
const terminals = (events: ReadonlyArray<{ type: string }>) => types(events).filter((type) => TERMINAL.has(type));

test("a stop during the answer's model call aborts the call, ends the turn stopped, and saves nothing", async () => {
  const called = deferred<void>();
  const aborted = deferred<unknown>();
  const router = createLlmRouter({
    settings: parseLlmEnv({ LLM_CHANNELS: "openai", LLM_OPENAI_PROTOCOL: "openai", LLM_OPENAI_API_KEY: "k", LLM_OPENAI_MODELS: "gpt-4.1", LITELLM_MODEL: "openai/gpt-4.1" }),
    client: (_deployment, _request, options) => new Promise((_resolve, reject) => {
      called.resolve();
      options?.signal?.addEventListener("abort", () => {
        aborted.resolve(options.signal?.reason);
        reject(new Error("socket closed"));
      }, { once: true });
    }),
  });
  const saved = persistence();
  const coordinator = createChatCoordinator({
    analystToolRuntime: async () => {
      await router.complete({ messages: [{ role: "user", content: "Analyze MU" }] });
      return answer;
    },
    persistAssistantMessage: saved.persistAssistantMessage,
  });
  const turn = coordinator.getOrCreateTurn({ ...IDS, userIntent: "Analyze MU" });
  await called.promise;

  assert.equal(coordinator.stopTurn(IDS), "stopped");
  await turn.completed;
  assert.equal((await aborted.promise as Error).name, "ChatTurnStoppedError");
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(types(turn.events), ["turn.started", "turn.stopped"]);
  assert.deepEqual(saved.saves, []);
  const read = await coordinator.readThread({ userId: U1, threadId: "thread-1" }, async () => []);
  assert.deepEqual(read, { messages: [], activeRun: null, runs: [{ runId: "run-1", turnId: "run-1", status: "stopped" }] });
});

test("a stop is idempotent, and nothing the stopped work emits after it reaches the stream", async () => {
  const hold = deferred<void>();
  const finished = deferred<void>();
  const coordinator = createChatCoordinator({
    runner: async ({ emit }) => {
      emit("turn.started");
      await hold.promise;
      emit("block.began", { block_id: "b-1", kind: "rich_text" });
      emit("turn.completed", { message_id: "m-1" });
      finished.resolve();
    },
  });
  const turn = coordinator.getOrCreateTurn({ ...IDS, userIntent: "Analyze MU" });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(coordinator.stopTurn(IDS), "stopped");
  assert.equal(coordinator.stopTurn(IDS), "stopped");
  await turn.completed;
  hold.resolve();
  await finished.promise;
  assert.deepEqual(types(turn.events), ["turn.started", "turn.stopped"]);
});

test("stop races a save: the save that began first wins, the stop is refused, and the turn completes once", async () => {
  const commit = deferred<void>();
  const saved = persistence(commit.promise);
  const coordinator = createChatCoordinator({ analystToolRuntime: async () => answer, persistAssistantMessage: saved.persistAssistantMessage });
  const turn = coordinator.getOrCreateTurn({ ...IDS, userIntent: "Analyze MU" });
  await saved.began;

  assert.equal(coordinator.stopTurn(IDS), "saving");
  commit.resolve();
  await turn.completed;

  assert.deepEqual(terminals(turn.events), ["turn.completed"]);
  assert.equal(saved.saves.length, 1);
  assert.equal(coordinator.stopTurn(IDS), "ended");
  const read = await coordinator.readThread({ userId: U1, threadId: "thread-1" }, async () => []);
  assert.equal(read?.runs[0]?.status, "completed");
});

test("stop races a save: a stop that lands first refuses the save, and the turn ends stopped once", async () => {
  const answered = deferred<void>();
  const saved = persistence();
  const failures: unknown[] = [];
  const coordinator = createChatCoordinator({
    // Work that never checks the turn's signal: it reaches the save after the stop.
    analystToolRuntime: async () => {
      await answered.promise;
      return answer;
    },
    persistAssistantMessage: saved.persistAssistantMessage,
  });
  const turn = coordinator.getOrCreateTurn({ ...IDS, userIntent: "Analyze MU" });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(coordinator.stopTurn(IDS), "stopped");
  await turn.completed;
  const log = console.error;
  console.error = (...args: unknown[]) => failures.push(args);
  try {
    answered.resolve();
    for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
  } finally {
    console.error = log;
  }

  assert.deepEqual(saved.saves, []);
  assert.deepEqual(terminals(turn.events), ["turn.stopped"]);
  assert.deepEqual(types(turn.events), ["turn.started", "turn.stopped"]);
  assert.deepEqual(failures, [], "a refused save is the stop working, not a failure");
});

test("a turn stopped while queued never runs, and the thread's next turn does", async () => {
  const hold = deferred<void>();
  const ran: string[] = [];
  const runner: ChatTurnRunner = async ({ runId, emit }) => {
    ran.push(runId);
    emit("turn.started");
    if (runId === "run-0") await hold.promise;
    emit("turn.completed", { message_id: `m-${runId}` });
  };
  const coordinator = createChatCoordinator({ runner });
  const first = coordinator.getOrCreateTurn({ ...IDS, runId: "run-0", turnId: "run-0", userIntent: "first" });
  const queued = coordinator.getOrCreateTurn({ ...IDS, userIntent: "second" });
  const next = coordinator.getOrCreateTurn({ ...IDS, runId: "run-2", turnId: "run-2", userIntent: "third" });

  assert.equal(coordinator.stopTurn(IDS), "stopped");
  hold.resolve();
  await Promise.all([first.completed, queued.completed, next.completed]);

  assert.deepEqual(ran, ["run-0", "run-2"]);
  assert.deepEqual(types(queued.events), ["turn.started", "turn.stopped"]);
  assert.deepEqual(terminals(next.events), ["turn.completed"]);
});

test("a stopped turn's thread takes its next turn without waiting for the stopped work to return", async () => {
  const never = deferred<void>();
  const ran: string[] = [];
  const coordinator = createChatCoordinator({
    runner: async ({ runId, emit }) => {
      ran.push(runId);
      emit("turn.started");
      if (runId === "run-1") await never.promise;
      emit("turn.completed", { message_id: `m-${runId}` });
    },
  });
  coordinator.getOrCreateTurn({ ...IDS, userIntent: "Analyze MU" });
  await new Promise((resolve) => setImmediate(resolve));
  coordinator.stopTurn(IDS);
  const next = coordinator.getOrCreateTurn({ ...IDS, runId: "run-2", turnId: "run-2", userIntent: "Analyze NVDA" });
  await next.completed;
  assert.deepEqual(ran, ["run-1", "run-2"]);
  assert.deepEqual(terminals(next.events), ["turn.completed"]);
});

test("stopTurn finds nothing for unknown ids or another user's turn", async () => {
  const hold = deferred<void>();
  const coordinator = createChatCoordinator({ runner: async () => { await hold.promise; } });
  coordinator.getOrCreateTurn({ ...IDS, userIntent: "Analyze MU" });
  assert.equal(coordinator.stopTurn({ ...IDS, runId: "run-9", turnId: "run-9" }), null);
  assert.equal(coordinator.stopTurn({ ...IDS, userId: "22222222-2222-4222-8222-222222222222" }), null);
  hold.resolve();
});

// Resolves once every client the pool lent out is back: the work that held one has returned.
async function drained(pool: Pool): Promise<void> {
  for (const deadline = Date.now() + 10_000; pool.totalCount !== pool.idleCount || pool.waitingCount > 0;) {
    assert.ok(Date.now() < deadline, "the stopped work still holds a database client");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test("a financial turn stopped mid-calculation and asked again at once answers, and the stopped work takes no lease again", { skip: !dockerAvailable(), timeout: 300_000 }, async (t) => {
  const { db, pool, threadId } = await chatDatabase(t, "chat-stop-fin");
  const turn = { userId: ENGINE_IDS.owner, threadId, turnId: randomUUID(), userIntent: "Revenue for AAA" };
  const leased = async () => (await db.query(`select count(*)::int as n from financial_runs where request_key = $1 and lease_expires_at > now()`, [turn.turnId])).rows[0].n === 1;
  const reached = deferred<void>();
  const hold = deferred<void>();
  let held = false;
  // The stop's release, the one lease write made on the pool, is slow, as on a busy pool: the re-ask must still wait for it.
  const slowRelease = new Proxy(pool, {
    get(target, key) {
      if (key !== "query") return Reflect.get(target, key, target);
      return async (text: string, values?: unknown[]) => {
        if (text.includes("set lease_expires_at = now()")) await new Promise((resolve) => setTimeout(resolve, 500));
        return target.query(text, values);
      };
    },
  });
  const { coordinator } = chatHarness(slowRelease, {
    model: revenueModel(["AAA"]),
    // The first evidence read under the run's lease waits on `hold`: the calculation the stop lands in.
    evidence: (executor) => {
      const port = createEvidenceFinancialPort(executor);
      return {
        listInputCandidates: async (request) => {
          if (!held && await leased()) {
            held = true;
            reached.resolve();
            await hold.promise;
          }
          return port.listInputCandidates(request);
        },
        readSplitHistory: (request) => port.readSplitHistory(request),
        readPriceObservations: (request) => port.readPriceObservations(request),
      };
    },
  });
  const first = coordinator.getOrCreateTurn({ ...turn, runId: randomUUID() });
  try {
    await Promise.race([reached.promise, first.completed.then(() => assert.fail(`the turn ended before its calculation: ${JSON.stringify(first.events)}`))]);

    assert.equal(coordinator.stopTurn({ ...turn, runId: first.input.runId }), "stopped");
    const again = coordinator.getOrCreateTurn({ ...turn, runId: randomUUID() });
    // The read the stop landed in finishes, as a database read does; the stopped work goes on to its next step.
    hold.resolve();
    await again.completed;
    const done = completed(again.events);
    assert.equal(done.financial_gap, undefined, `asked again, the turn answers: ${JSON.stringify(done.financial_gap)}`);
    const [block] = (await db.query(`select blocks from chat_messages where message_id = $1`, [done.message_id])).rows[0].blocks;
    assert.equal(block.kind, "financial_answer");
  } finally {
    hold.resolve();
  }

  await drained(pool);
  assert.deepEqual(types(first.events), ["turn.started", "turn.stopped"]);
  assert.equal((await db.query(`select count(*)::int as n from chat_messages where thread_id = $1 and role = 'assistant'`, [threadId])).rows[0].n, 1);
  const leases = await db.query(
    `select count(*)::int as n from financial_run_events e join financial_runs r using (run_id) where r.request_key = $1 and e.event_kind = 'lease_acquired'`,
    [turn.turnId],
  );
  assert.equal(leases.rows[0].n, 2, "the stopped attempt and the re-ask each took the lease once");
});

// The HTTP route.

const STOP = (runId: string, turnId?: string) =>
  `/v1/chat/threads/${THREAD_ID}/runs/${runId}/stop${turnId ? `?turn_id=${turnId}` : ""}`;

async function startStack(t: TestContext) {
  const hold = deferred<void>();
  const coordinator = createChatCoordinator({
    runner: async ({ runId, emit }) => {
      emit("turn.started");
      await hold.promise;
      emit("turn.completed", { message_id: `m-${runId}` });
    },
  });
  const { db } = fakeDb(({ text, values }) => {
    if (text.includes("from chat_threads")) return values?.includes(USER_ID) ? [buildRow({ owned: true })] : [];
    if (text.includes("from chat_messages")) return [];
    if (text.includes("from snapshots") || text.includes("from snapshot_financial_runs")) return [];
    throw new Error(`unexpected query: ${text}`);
  });
  const base = await startChatTestServer(t, { threadsDb: db, coordinator });
  return { base, coordinator, release: () => hold.resolve() };
}

const post = (base: string, path: string, userId: string | null = USER_ID) =>
  fetch(`${base}${path}`, { method: "POST", headers: userId ? { "x-user-id": userId } : {} })
    .then(async (response) => ({ status: response.status, body: await response.json() as Record<string, unknown> }));

test("POST stop stops the owner's turn once, and the messages read lists it stopped", async (t) => {
  const { base, coordinator } = await startStack(t);
  const turn = coordinator.getOrCreateTurn({ userId: USER_ID, threadId: THREAD_ID, runId: "run-1", turnId: "turn-1", userIntent: "Analyze MU" });

  assert.deepEqual(await post(base, STOP("run-1", "turn-1")), { status: 200, body: { status: "stopped" } });
  assert.deepEqual(await post(base, STOP("run-1", "turn-1")), { status: 200, body: { status: "stopped" } });
  await turn.completed;
  assert.deepEqual(terminals(turn.events), ["turn.stopped"]);

  const read = await fetch(`${base}/v1/chat/threads/${THREAD_ID}/messages`, { headers: { "x-user-id": USER_ID } });
  assert.deepEqual(await read.json(), { messages: [], active_run: null, runs: [{ run_id: "run-1", turn_id: "turn-1", status: "stopped" }] });
});

test("POST stop is the owner's alone: 401 without a user, 404 for another user or an unknown turn", async (t) => {
  const { base, coordinator, release } = await startStack(t);
  const turn = coordinator.getOrCreateTurn({ userId: USER_ID, threadId: THREAD_ID, runId: "run-1", userIntent: "Analyze MU" });

  assert.equal((await post(base, STOP("run-1"), null)).status, 401);
  assert.deepEqual(await post(base, STOP("run-1"), "55555555-5555-4555-8555-555555555555"), { status: 404, body: { error: "chat thread not found" } });
  assert.deepEqual(await post(base, STOP("run-9")), { status: 404, body: { error: "turn not found" } });
  assert.deepEqual(terminals(turn.events), []);

  release();
  await turn.completed;
  assert.deepEqual(terminals(turn.events), ["turn.completed"]);
});

test("POST stop after the turn completed is a 409 that changes nothing", async (t) => {
  const { base, coordinator, release } = await startStack(t);
  const turn = coordinator.getOrCreateTurn({ userId: USER_ID, threadId: THREAD_ID, runId: "run-1", userIntent: "Analyze MU" });
  release();
  await turn.completed;

  assert.deepEqual(await post(base, STOP("run-1")), { status: 409, body: { status: "ended", error: "the turn already ended" } });
  assert.deepEqual(terminals(turn.events), ["turn.completed"]);
});
