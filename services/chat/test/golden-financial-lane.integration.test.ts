import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import test from "node:test";

import { bootstrapDatabase, connectedClient, connectedPool, dockerAvailable } from "../../../db/test/docker-pg.ts";
import type { PlanningModel } from "../../financial-engine/src/planner.ts";
import { createReplayLlmChatClient } from "../../llm/src/replay-client.ts";
import type { ChatSubjectPreResolution } from "../src/subjects.ts";
import { chatHarness, completed } from "./financial-fixtures.ts";
import { GOLDEN_COMPANIES, seedGoldenDataset } from "./golden/dataset.ts";

const OWNER = "10000000-0000-4000-8000-000000000001";

// As chat's resolver does, a ticker resolves to its listing.
async function resolveListing(mention: string): Promise<ChatSubjectPreResolution> {
  const company = GOLDEN_COMPANIES.find((candidate) => candidate.ticker === mention);
  return (company
    ? { status: "resolved", subject_ref: { kind: "listing", id: company.listing_id }, display_label: `${company.ticker} (XNAS)` }
    : { status: "not_found", input_text: mention, normalized_input: mention, message: "not found" }) as unknown as ChatSubjectPreResolution;
}

test("golden metric questions certify through the chat financial lane on the recorded planner replies", { skip: !dockerAvailable(), timeout: 300_000 }, async (t) => {
  const { databaseUrl } = await bootstrapDatabase(t, "chat-golden-financial-lane");
  const client = await connectedClient(t, databaseUrl);
  await client.query(`insert into users (user_id, email) values ($1::uuid, 'lane@chat.example.test')`, [OWNER]);
  await seedGoldenDataset(client);
  const threadId = randomUUID();
  await client.query(`insert into chat_threads (thread_id, user_id) values ($1, $2)`, [threadId, OWNER]);
  const pool = await connectedPool(t, databaseUrl);
  const replay = await createReplayLlmChatClient(join(import.meta.dirname, "golden", "llm-replies.json"));
  const model: PlanningModel = async ({ messages }) => ({ text: (await replay({} as never, { messages })).text, model: "recorded" });

  const ask = async (userIntent: string) => {
    const { events } = await chatHarness(pool, { model, resolveMention: resolveListing }).run({ threadId, userId: OWNER, userIntent });
    const done = completed(events);
    const message = (await client.query(`select blocks from chat_messages where message_id = $1`, [done.message_id])).rows[0];
    assert.ok(message, `expected a published answer; got ${JSON.stringify(done)}`);
    return (message.blocks[0].financial.results as Array<{ output_id: string; disposition: string; presented: { kind: string; text: string } }>)
      .map((result) => [result.output_id, result.disposition, result.presented.kind === "value" ? result.presented.text : null]);
  };

  assert.deepEqual(await ask("Why did AMD's operating margin turn negative in Q2 2025?"), [["out_a_om", "verified", "-1.74%"]]);
  assert.deepEqual(await ask("Compare NVDA, AMD and AAPL revenue and margins YTD against the S&P 500"), [
    ["out_a_rev", "verified", "USD 209,911,000,000.00"],
    ["out_a_gm", "verified", "70.78%"],
    ["out_a_om", "verified", "60.21%"],
    ["out_a_nm", "verified", "53.60%"],
    ["out_b_rev", "verified", "USD 34,669,000,000.00"],
    ["out_b_gm", "verified", "49.92%"],
    ["out_b_om", "verified", "9.78%"],
    ["out_b_nm", "verified", "12.04%"],
    ["out_c_rev", "verified", "USD 416,161,000,000.00"],
    ["out_c_gm", "verified", "46.91%"],
    ["out_c_om", "verified", "31.97%"],
    ["out_c_nm", "verified", "26.92%"],
  ]);
  assert.deepEqual(await ask("What is AMD's free cash flow?"), [
    ["a_ocf_input", "missing", null],
    ["a_capex_input", "missing", null],
    ["out_a_fcf", "blocked_dependency", null],
  ]);
});
