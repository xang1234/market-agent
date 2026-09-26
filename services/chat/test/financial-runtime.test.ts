import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { dockerAvailable } from "../../../db/test/docker-pg.ts";
import type { PlanningModel } from "../../financial-engine/src/planner.ts";
import { IDS } from "../../financial-engine/test/db-fixtures.ts";
import type { ChatAnalystToolRuntime } from "../src/coordinator.ts";
import { createChatFinancialRuntime, isFinancialRequest } from "../src/financial-runtime.ts";
import { createEvidenceFinancialPort } from "../../financial-engine/src/evidence-adapter.ts";
import type { FinancialPool } from "../../financial-engine/src/ports.ts";
import { chatDatabase, chatHarness, completed, revenueModel } from "./financial-fixtures.ts";

test("financial intent is recognized from the definition catalog", () => {
  for (const text of ["Compare revenue for AAA and BBB", "What was AAA's gross margin?", "EPS for AAA", "net income trend"]) assert.ok(isFinancialRequest(text), text);
  for (const text of ["tell me about AAA", "what is the latest news", "who is the CEO"]) assert.ok(!isFinancialRequest(text), text);
});

test("with the lane on, an unready engine stops the server instead of leaving turns on legacy numbers", async () => {
  // A database missing every financial table: every readiness check reports absent.
  const unready = { query: async () => ({ rows: [{ kind: "relation", name: "financial_runs", present: false }] }), connect: async () => assert.fail("no turn runs") } as unknown as FinancialPool;
  const lane = (mode: "off" | "enforce") => createChatFinancialRuntime({ mode, pool: unready, planningModel: null, resolveMention: async () => assert.fail("no turn runs"), evidence: createEvidenceFinancialPort });
  await assert.rejects(() => lane("enforce").assertReady(), /verified finance is not ready for chat: schema: relation financial_runs is missing/u);
  await lane("off").assertReady();
});

test("chat financial lane", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for chat financial coverage");
    return;
  }
  const { db, pool, threadId } = await chatDatabase(t, "chat-financial");
  const base = { threadId, userId: IDS.owner };

  await t.test("an unresolved company is asked about; nothing is planned or answered for the rest", async () => {
    const model = revenueModel(["AAA", "BBB", "CCC", "ZZZ"]);
    const { events } = await chatHarness(pool, { model }).run({ ...base, userIntent: "Compare revenue for AAA, BBB, CCC and ZZZ" });
    const done = completed(events);
    assert.equal(done.clarification, true);
    assert.match((done.financial_clarification as { question: string }).question, /"ZZZ" did not match a known company/u);
    assert.equal(model.calls, 0, "no model call before every company resolves");
    assert.equal((await db.query(`select count(*)::int as n from financial_runs where parent_id = $1`, [threadId])).rows[0].n, 0);
  });

  await t.test("a company without eligible data stays in the answer as an explicit gap", async () => {
    const model = revenueModel(["AAA", "BBB"]);
    const { events } = await chatHarness(pool, { model }).run({ ...base, userIntent: "Compare revenue for AAA and BBB" });
    const done = completed(events);
    assert.deepEqual(events.map((event) => event.type), ["turn.started", "snapshot.sealed", "block.began", "block.completed", "turn.completed"], "nothing but the start is streamed before commit");
    assert.equal(events[0]!.bundle_id, "financial_answer");
    const message = (await db.query(`select blocks, snapshot_id::text from chat_messages where message_id = $1`, [done.message_id])).rows[0];
    const [block] = message.blocks;
    assert.equal(block.kind, "financial_answer");
    assert.equal(block.snapshot_id, message.snapshot_id);
    assert.deepEqual(block.financial.results.map((result: { disposition: string }) => result.disposition), ["verified", "missing"]);
    assert.equal(block.financial.coverage.state, "partial", "two companies were asked about; the answer covers both");
  });

  await t.test("a missing or failing planning model yields a gap, never the narrative composer", async () => {
    for (const model of [null, (async () => { throw new Error("provider down"); }) as PlanningModel]) {
      const { events } = await chatHarness(pool, { model }).run({ ...base, userIntent: "Compare revenue for AAA and BBB" });
      assert.deepEqual(completed(events).financial_gap, { reason_code: "planning_unavailable" });
    }
  });

  await t.test("a calculation that fails verification is a gap, never the narrative composer", async () => {
    const { events } = await chatHarness(pool, { model: revenueModel(["CCC"]) }).run({ ...base, userIntent: "Revenue for CCC" });
    assert.deepEqual(completed(events).financial_gap, { reason_code: "verification_failed" });
  });

  await t.test("narrative turns keep the analyst path", async () => {
    let analystCalls = 0;
    const analyst: ChatAnalystToolRuntime = () => {
      analystCalls += 1;
      return { snapshot_id: randomUUID(), blocks: [], verification: { ok: true } };
    };
    await chatHarness(pool, { model: revenueModel([]), analyst }).run({ ...base, userIntent: "tell me about AAA" });
    assert.equal(analystCalls, 1);
    const off = chatHarness(pool, { model: revenueModel(["AAA"]), mode: "off", analyst });
    await off.run({ ...base, userIntent: "Revenue for AAA" });
    assert.equal(analystCalls, 2, "the lane is off: financial requests stay on the existing path");
  });

  await t.test("a retried turn resumes its reserved run and publishes one message", async () => {
    const turnId = randomUUID();
    const first = revenueModel(["AAA"]);
    const answered = completed((await chatHarness(pool, { model: first }).run({ ...base, turnId, userIntent: "Revenue for AAA" })).events);
    const second = revenueModel(["AAA"]);
    // A new coordinator stands in for a restarted process that never saw the first commit.
    const retried = completed((await chatHarness(pool, { model: second }).run({ ...base, turnId, userIntent: "Revenue for AAA" })).events);
    assert.equal(retried.message_id, answered.message_id);
    assert.equal(second.calls, 0, "the retry does not plan again");
    assert.equal((await db.query(`select count(*)::int as n from chat_messages where message_id = $1`, [answered.message_id])).rows[0].n, 1);
  });
});
