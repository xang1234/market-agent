import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { dockerAvailable } from "../../../db/test/docker-pg.ts";
import { IDS } from "../../financial-engine/test/db-fixtures.ts";
import { createChatServer } from "../src/http.ts";
import { chatDatabase, chatHarness, completed, revenueModel } from "./financial-fixtures.ts";

type Offered = { clarification_id: string; question: string; choices: Array<{ choice_id: string; label: string }> };

test("financial clarifications", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for chat clarification coverage");
    return;
  }
  const { db, pool, threadId } = await chatDatabase(t, "chat-clarify");
  const base = { threadId, userId: IDS.owner, userIntent: "Revenue for AMB" };
  const ask = async (clarificationAnswer?: { clarification_id: string; choice_id: string }) => {
    const model = revenueModel(["AMB"]);
    const { events } = await chatHarness(pool, { model }).run({ ...base, ...(clarificationAnswer ? { clarificationAnswer } : {}) });
    return { done: completed(events), model };
  };

  const first = await ask();
  const offered = first.done.financial_clarification as Offered;

  await t.test("an ambiguous company is offered as versioned choices, before any model call", () => {
    assert.equal(first.done.clarification, true);
    assert.match(offered.question, /Which company did you mean by "AMB"\?/u);
    assert.deepEqual(offered.choices.map((choice) => choice.label), ["Alpha Industries Inc.", "Beta Holdings Corp."]);
    assert.match(offered.clarification_id, /^[0-9a-f]{64}$/u);
    assert.equal(first.model.calls, 0);
  });

  await t.test("answering creates a new plan for the chosen company and publishes it", async () => {
    const alpha = offered.choices.find((choice) => choice.label === "Alpha Industries Inc.")!;
    const { done, model } = await ask({ clarification_id: offered.clarification_id, choice_id: alpha.choice_id });
    assert.ok(done.message_id && !done.clarification, JSON.stringify(done));
    assert.equal(model.calls, 1);
    const [block] = (await db.query(`select blocks from chat_messages where message_id = $1`, [done.message_id])).rows[0].blocks;
    assert.equal(block.kind, "financial_answer");
    assert.ok(Object.values(block.financial.labels as Record<string, { text: string }>).some((label) => label.text === "Alpha Industries Inc."));
  });

  await t.test("a stale or forged answer changes nothing: the same question is asked again", async () => {
    for (const answer of [
      { clarification_id: "0".repeat(64), choice_id: offered.choices[0]!.choice_id },
      { clarification_id: offered.clarification_id, choice_id: `issuer:${randomUUID()}` },
    ]) {
      const { done, model } = await ask(answer);
      assert.equal(done.clarification, true, JSON.stringify(answer));
      assert.equal((done.financial_clarification as Offered).clarification_id, offered.clarification_id);
      assert.equal(model.calls, 0);
    }
  });
});

test("a clarification answer must name both the clarification and the choice", async () => {
  const server = createChatServer({ allowSyntheticAnalystFallback: true });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${port}/v1/chat/threads/${randomUUID()}/stream?run_id=${randomUUID()}&clarification_id=${"a".repeat(64)}`);
    assert.equal(response.status, 400);
    await response.body?.cancel();
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
