import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { dockerAvailable } from "../../../db/test/docker-pg.ts";
import { createEvidenceFinancialPort } from "../../financial-engine/src/evidence-adapter.ts";
import { IDS, ORIGINAL_REVENUE } from "../../financial-engine/test/db-fixtures.ts";
import { createChatCoordinator } from "../src/coordinator.ts";
import { createChatFinancialRuntime } from "../src/financial-runtime.ts";
import { CHAT_SSE_EVENT_TYPES } from "../src/sse.ts";
import { chatDatabase, forbiddenAnalyst, resolveMention, revenueModel } from "./financial-fixtures.ts";
import { parseSseEvents, startChatTestServer } from "./sse-helpers.ts";

test("financial answers over SSE", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for financial SSE coverage");
    return;
  }
  const { db, pool, threadId } = await chatDatabase(t, "chat-fin-sse");
  const model = revenueModel(["AAA"]);
  const coordinator = createChatCoordinator({
    analystToolRuntime: forbiddenAnalyst,
    persistAssistantMessage: async () => ({ snapshot_id: randomUUID(), message_id: randomUUID() }),
    financialRuntime: createChatFinancialRuntime({ mode: "enforce", pool, planningModel: model, resolveMention, evidence: createEvidenceFinancialPort }),
  });
  const base = await startChatTestServer(t, { coordinator });
  /** Reads the stream until the turn ends (the server keeps it open with heartbeats), keeping only turn events. */
  const stream = async (turnId: string, headers: Record<string, string> = {}) => {
    const url = `${base}/v1/chat/threads/${threadId}/stream?run_id=${turnId}&turn_id=${turnId}&user_intent=${encodeURIComponent("Revenue for AAA")}`;
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

  await t.test("a committed answer streams only references, with the existing event vocabulary", async () => {
    const { transcript, events } = await stream(randomUUID());
    assert.deepEqual(events.map((event) => event.event), ["turn.started", "snapshot.sealed", "block.began", "block.completed", "turn.completed"]);
    for (const event of events) assert.ok((CHAT_SSE_EVENT_TYPES as ReadonlyArray<string>).includes(event.event!), "older clients know every event type");
    assert.ok(!transcript.includes("383,285"), "values arrive with the committed message, not the stream");
    const done = events.at(-1)!.data;
    const message = (await db.query(`select blocks from chat_messages where message_id = $1`, [done.message_id])).rows[0];
    assert.equal(message.blocks[0].kind, "financial_answer");
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
