import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { dockerAvailable } from "../../../db/test/docker-pg.ts";
import { createEvidenceFinancialPort } from "../../financial-engine/src/evidence-adapter.ts";
import { IDS, ORIGINAL_REVENUE } from "../../financial-engine/test/db-fixtures.ts";
import { createChatCoordinator } from "../src/coordinator.ts";
import { createChatFinancialRuntime } from "../src/financial-runtime.ts";
import { listChatMessagesForThread } from "../src/messages.ts";
import { CHAT_SSE_EVENT_TYPES } from "../src/sse.ts";
import { chatDatabase, forbiddenAnalyst, METRIC_READING, resolveMention, revenueModel } from "./financial-fixtures.ts";
import { readMessage } from "./read-message-fixture.ts";
import { parseSseEvents, startChatTestServer } from "./sse-helpers.ts";

test("financial answers over SSE", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for financial SSE coverage");
    return;
  }
  const { db, pool, threadId } = await chatDatabase(t, "chat-fin-sse");
  const model = revenueModel(["AAA"]);
  const coordinator = () => createChatCoordinator({
    analystToolRuntime: forbiddenAnalyst,
    persistAssistantMessage: async ({ threadId }) => readMessage({ snapshot_id: randomUUID(), message_id: randomUUID(), thread_id: threadId }),
    readQuestion: async () => METRIC_READING,
    financialRuntime: createChatFinancialRuntime({ pool, planningModel: model, resolveMention, evidence: createEvidenceFinancialPort }),
  });
  const base = await startChatTestServer(t, { coordinator: coordinator() });
  /** Reads the stream until the turn ends (the server keeps it open with heartbeats), keeping only turn events. */
  const stream = async (turnId: string, headers: Record<string, string> = {}, server = base) => {
    const url = `${server}/v1/chat/threads/${threadId}/stream?run_id=${turnId}&turn_id=${turnId}&user_intent=${encodeURIComponent("Revenue for AAA")}`;
    const response = await fetch(url, { headers: { "x-user-id": IDS.owner, ...headers } });
    if (response.status !== 200) {
      await response.body?.cancel();
      return { status: response.status, transcript: "", events: [] };
    }
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let transcript = "";
    while (!/event: turn\.(completed|error)\n[^]*?\n\n/u.test(transcript)) {
      const { value, done } = await reader.read();
      if (done) break;
      transcript += decoder.decode(value, { stream: true });
    }
    await reader.cancel();
    const turnFrames = parseSseEvents(transcript).filter((event) => (CHAT_SSE_EVENT_TYPES as ReadonlyArray<string>).includes(event.event ?? ""));
    return { status: response.status, transcript, events: turnFrames };
  };

  await t.test("a result that fails verification exposes no number anywhere on the stream", async () => {
    // A writer bug stores a value other than the one computed; verification must catch it before anything is shown.
    await db.query(`
      create function corrupt_financial_value() returns trigger language plpgsql as $$
      begin
        if new.payload->>'kind' = 'value' then new.payload = jsonb_set(new.payload, '{value}', '"987654321"'); end if;
        return new;
      end $$;
      create trigger corrupt_financial_value before insert on financial_results for each row execute function corrupt_financial_value();`);
    try {
      const { status, transcript, events } = await stream(randomUUID());
      assert.equal(status, 200);
      for (const leaked of ["987654321", ORIGINAL_REVENUE, "383285000000", "383,285"]) assert.ok(!transcript.includes(leaked), `the stream carries ${leaked}`);
      assert.deepEqual(events.at(-1)!.data.financial_gap, { reason_code: "verification_failed" });
      assert.equal((await db.query(`select count(*)::int as n from chat_messages m where m.thread_id = $1 and m.blocks @> '[{"kind":"financial_answer"}]'`, [threadId])).rows[0].n, 0);
    } finally {
      await db.query(`drop trigger corrupt_financial_value on financial_results; drop function corrupt_financial_value();`);
    }
  });

  /** The thread's stored message, as the messages GET returns it. */
  const listed = async (messageId: unknown) =>
    (await listChatMessagesForThread(pool, { thread_id: threadId, user_id: IDS.owner }))?.messages.find((message) => message.message_id === messageId);

  await t.test("a committed answer streams only references, then completes with the committed message", async () => {
    const { transcript, events } = await stream(randomUUID());
    assert.deepEqual(events.map((event) => event.event), ["turn.started", "snapshot.sealed", "block.began", "block.completed", "turn.completed"]);
    for (const event of events) assert.ok((CHAT_SSE_EVENT_TYPES as ReadonlyArray<string>).includes(event.event!), "older clients know every event type");
    const completion = transcript.indexOf("event: turn.completed");
    assert.ok(!transcript.slice(0, completion).includes("383,285"), "values arrive with the committed message, not before it");
    const done = events.at(-1)!.data;
    const message = done.message as { message_id: string; snapshot_id: string; blocks: Array<{ id: string; kind: string }> };
    assert.equal(message.message_id, done.message_id);
    assert.equal(message.blocks[0]!.kind, "financial_answer");
    assert.equal(events[1]!.data.snapshot_id, message.snapshot_id);
    assert.equal(events[2]!.data.block_id, message.blocks[0]!.id);
    assert.equal(JSON.stringify(message), JSON.stringify(await listed(done.message_id)));
  });

  await t.test("a retry in a fresh process completes with the message the first attempt stored", async () => {
    const turnId = randomUUID();
    const { events: first } = await stream(turnId);
    const calls = model.calls;
    const restarted = await startChatTestServer(t, { coordinator: coordinator() });
    const { events: retried } = await stream(turnId, {}, restarted);
    assert.equal(model.calls, calls, "the retry plans nothing");
    const done = retried.at(-1)!.data;
    assert.equal(done.message_id, first.at(-1)!.data.message_id);
    assert.equal(JSON.stringify(done.message), JSON.stringify(await listed(done.message_id)));
  });

  await t.test("a committed answer whose read-back fails completes with its id and logs the read error", async (st) => {
    // The publication commits on a checked-out client; only the read after it, on the pool, fails.
    const failingReads = new Proxy(pool, {
      get(target, key) {
        if (key === "query") {
          return (text: unknown, values?: unknown[]) =>
            typeof text === "string" && text.includes("from chat_messages m")
              ? Promise.reject(new Error("Connection terminated unexpectedly"))
              : target.query(text as string, values);
        }
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const logged = st.mock.method(console, "error", () => {});
    const server = await startChatTestServer(t, {
      coordinator: createChatCoordinator({
        analystToolRuntime: forbiddenAnalyst,
        financialRuntime: createChatFinancialRuntime({ pool: failingReads, planningModel: model, resolveMention, evidence: createEvidenceFinancialPort }),
      }),
    });
    const { events } = await stream(randomUUID(), {}, server);
    assert.deepEqual(events.map((event) => event.event), ["turn.started", "block.began", "block.completed", "turn.completed"]);
    const done = events.at(-1)!.data;
    assert.deepEqual([events[1]!.data.block_id, events[1]!.data.kind], [`financial-answer-${done.message_id}`, "financial_answer"]);
    assert.equal("message" in done, false);
    const stored = await listed(done.message_id);
    assert.equal((stored?.blocks as Array<{ kind: string }> | undefined)?.[0]?.kind, "financial_answer");
    assert.equal(logged.mock.callCount(), 1);
    const [note, cause] = logged.mock.calls[0]!.arguments as [string, Error];
    assert.equal(note, `[chat] the committed message ${done.message_id} could not be read back; its turn completes without it`);
    assert.equal(cause.message, "Connection terminated unexpectedly");
  });

  await t.test("a reconnect resumes after its last event without re-running or duplicating", async () => {
    const turnId = randomUUID();
    const { events: first } = await stream(turnId);
    const calls = model.calls;
    const { events: resumed } = await stream(turnId, { "last-event-id": first[1]!.id! });
    assert.deepEqual(resumed.map((event) => event.id), first.slice(2).map((event) => event.id), "only the events after the cursor, once each");
    assert.equal(model.calls, calls, "resuming never plans or executes again");
    assert.equal((await db.query(`select count(*)::int as n from chat_messages where message_id = $1`, [first.at(-1)!.data.message_id])).rows[0].n, 1);
    assert.equal((await stream(turnId, { "last-event-id": "not-a-number" })).status, 400, "a malformed cursor is rejected");
  });
});
