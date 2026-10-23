// An engine answer's coverage note and a declined turn's retry, on the chat
// server over the frozen golden dataset with recorded model replies (#425).
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { bootstrapDatabase, connectedClient, dockerAvailable, registerLifoCleanup } from "../../../db/test/docker-pg.ts";
import { closeLocalRuntimePoolForTests } from "../src/local-runtime.ts";
import { seedGoldenDataset } from "./golden/dataset.ts";
import {
  api,
  completedTurn,
  GOLDEN_ENV,
  latestAssistantMessage,
  requireRecordedScopes,
  runTurn,
  startChatServer,
  streamTurn,
  USER_ID,
  withEnv,
  type ChatMessage,
} from "./golden/harness.ts";

// The text of each block that has some: an engine answer's notes, a gap's text.
const texts = (message: ChatMessage) => message.blocks.flatMap((block) =>
  Array.isArray(block.segments) ? [(block.segments as Array<{ text?: string }>).map((segment) => segment.text ?? "").join("")] : []);

test("golden coverage notes and declined-turn retries (#425)", { skip: !dockerAvailable(), timeout: 180_000 }, async (t) => {
  const { databaseUrl } = await bootstrapDatabase(t, "chat-golden-coverage");
  withEnv(t, { ...GOLDEN_ENV, CHAT_DATABASE_URL: databaseUrl });
  registerLifoCleanup(t, () => closeLocalRuntimePoolForTests());
  const client = await connectedClient(t, databaseUrl);
  await client.query(`insert into users (user_id, email) values ($1::uuid, 'golden-coverage@chat.example.test')`, [USER_ID]);
  await seedGoldenDataset(client);
  const base = await startChatServer(t, databaseUrl);

  await t.test("a comparison that plans each company's metrics names nothing left out, and shows a metric it could not compute (#517)", async (st) => {
    requireRecordedScopes(st);
    const { thread_id } = await api<{ thread_id: string }>(base, "POST", "/v1/chat/threads", { title: "Coverage" });
    completedTurn(await runTurn(base, thread_id, "Compare NVDA and AMD operating margin and EPS growth"));
    const answer = await latestAssistantMessage(base, thread_id);
    assert.equal(answer.blocks[0]?.kind, "financial_answer");
    const results = (answer.blocks[0]?.financial as { results: Array<{ output_id: string; disposition: string; presented: { text: string } }> }).results;
    assert.deepEqual(results.map((result) => [result.output_id, result.disposition, result.presented.text]), [
      ["nvda_operating_margin", "verified", "60.21%"],
      ["amd_operating_margin", "verified", "9.78%"],
      ["nvda_eps_growth", "blocked_dependency", "A required input or calculation is unavailable."],
      ["amd_eps_growth", "blocked_dependency", "A required input or calculation is unavailable."],
    ]);
    assert.deepEqual(texts(answer), []);
  });

  await t.test("with the scope reading off, the answer says its coverage was not checked", async (st) => {
    withEnv(st, { CHAT_SCOPE_PROPOSAL: "off" });
    const { thread_id } = await api<{ thread_id: string }>(base, "POST", "/v1/chat/threads", { title: "Unchecked" });
    completedTurn(await runTurn(base, thread_id, "What was AMD's revenue in Q2 2019?"));
    const answer = await latestAssistantMessage(base, thread_id);
    assert.deepEqual(texts(answer), ["It was not checked whether this answer covers everything the question asks for."]);
    const { rows } = await client.query(`select research_scope->'coverage_unchecked' as unchecked from chat_messages where message_id = $1::uuid`, [answer.message_id]);
    assert.equal(rows[0]?.unchecked, true);
  });

  await t.test("a retry of a declined turn returns the gap it saved", async (st) => {
    requireRecordedScopes(st);
    const { thread_id } = await api<{ thread_id: string }>(base, "POST", "/v1/chat/threads", { title: "Retried gap" });
    const question = "Break down AMD's revenue by segment";
    const turnId = randomUUID();
    await api(base, "POST", `/v1/chat/threads/${thread_id}/messages`, { message_id: turnId, snapshot_id: randomUUID(), content: question });
    const first = completedTurn(await streamTurn(base, thread_id, question, turnId));
    const retried = completedTurn(await streamTurn(base, thread_id, question, turnId));
    assert.equal(retried.data.message_id, first.data.message_id);
    const { messages } = await api<{ messages: ChatMessage[] }>(base, "GET", `/v1/chat/threads/${thread_id}/messages`);
    assert.deepEqual(messages.filter((message) => message.role === "assistant").map((message) => message.message_id), [first.data.message_id]);
    assert.deepEqual(texts(await latestAssistantMessage(base, thread_id)), [
      "This request asks for a calculation outside the verified financial definitions I can compute: revenue or results by business segment.",
    ]);
  });
});
