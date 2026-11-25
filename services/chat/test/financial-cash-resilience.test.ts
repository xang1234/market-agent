// The annual cash-resilience view in chat (#210): an explicit request is
// planned deterministically, with no model, and sealed like any certified answer.

import assert from "node:assert/strict";
import test from "node:test";
import { dockerAvailable } from "../../../db/test/docker-pg.ts";
import { createEvidenceFinancialPort } from "../../financial-engine/src/evidence-adapter.ts";
import { IDS, seedCashResilience } from "../../financial-engine/test/db-fixtures.ts";
import type { ControlledRouter } from "../../llm/src/router.ts";
import { analystAgentRunner } from "../src/analyst-agent.ts";
import type { AnalystToolResult } from "../src/analyst-tools.ts";
import { answerTurn } from "../src/answer-trace.ts";
import { listChatMessagesForThread } from "../src/messages.ts";
import { chatDatabase, chatHarness, completed, resolveMention } from "./financial-fixtures.ts";

const LLM_ENV = { LLM_CHANNELS: "openai", LLM_OPENAI_PROTOCOL: "openai", LLM_OPENAI_MODELS: "gpt-4.1,o3", LITELLM_MODEL: "openai/gpt-4.1", AGENT_LITELLM_MODEL: "openai/o3" };

test("chat cash resilience", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for chat financial coverage");
    return;
  }
  const { db, pool, threadId } = await chatDatabase(t, "chat-cash-res");
  await seedCashResilience(db);
  const ask = async (userIntent: string, harness = chatHarness(pool, { model: null })) =>
    (await harness.run({ threadId, userId: IDS.owner, userIntent })).events;
  const answer = async (userIntent: string, harness?: ReturnType<typeof chatHarness>) => {
    const done = completed(await ask(userIntent, harness));
    const read = await listChatMessagesForThread(pool, { thread_id: threadId, user_id: IDS.owner });
    const message = read!.messages.find((candidate) => candidate.message_id === done.message_id)!;
    const block = (message.blocks as Array<{ id: string; financial: any }>)[0]!;
    const { results, labels } = block.financial;
    return {
      proof: message.block_proofs[block.id],
      rows: results.map((result: any) => [labels[result.measure_label_id].text, labels[result.period_label_id].text, result.presented.kind === "value" ? result.presented.value : result.disposition]),
    };
  };

  await t.test("the latest fiscal year's five inputs and three ratios publish as one certified answer, with no model", async () => {
    assert.deepEqual(await answer("Show AAA's cash resilience"), {
      proof: { evidence: "linked", calculation: "verified", public_by_cutoff: "proven" },
      rows: [
        ["Operating cash flow", "FY2023 (ended 2023-12-31)", "120"],
        ["Net income including noncontrolling interest", "FY2023 (ended 2023-12-31)", "100"],
        ["Total liabilities", "FY2023 (as of 2023-12-31)", "300"],
        ["Total assets", "FY2023 (as of 2023-12-31)", "600"],
        ["Stockholders' equity", "FY2023 (as of 2023-12-31)", "200"],
        ["Cash conversion: operating cash flow / net income including noncontrolling interest (reported period)", "FY2023 (ended 2023-12-31)", "1.2"],
        ["Total liabilities / total assets (period-end balance sheet)", "FY2023 (as of 2023-12-31)", "0.5"],
        ["Total liabilities / stockholders' equity (period-end balance sheet)", "FY2023 (as of 2023-12-31)", "1.5"],
      ],
    });
  });

  // #803: with the analyst agent on, its model answering or none configured, each ask is the financial lane's and the agent is never called.
  const scripted: ControlledRouter = { complete: async () => ({ text: "DONE", deployment: { channel: "openai", model: "o3" } }) };
  for (const [name, router] of [["a working model", scripted], ["no model configured", null]] as const) {
    await t.test(`the analyst agent on with ${name}, the view, a named year and a score each stay the financial lane's (#803)`, async () => {
      const turns: unknown[] = [];
      const agent = analystAgentRunner({
        financial: { pool, evidence: createEvidenceFinancialPort, resolveMention },
        router: async () => router,
        read: async (tool) => ({ tool, status: "no_business_claims", truncated: false, reads: [], no_filing: [] }) as AnalystToolResult,
        compose: (input, turn, onAnswered) => answerTurn(input, turn, { env: LLM_ENV, createClient: () => async () => ({ text: "AAA makes things." }), onAnswered }),
        asOf: () => new Date().toISOString(),
      });
      const on = chatHarness(pool, {
        model: null,
        analystAgent: async (turn) => {
          turns.push(turn);
          return agent(turn);
        },
      });
      const ratios = (rows: string[][]) => rows.slice(5).map((row) => row[2]);
      assert.deepEqual(ratios((await answer("Show AAA's cash resilience", on)).rows), ["1.2", "0.5", "1.5"]);
      assert.deepEqual(ratios((await answer("AAA cash resilience for FY2023", on)).rows), ["1.2", "0.5", "1.5"]);
      assert.deepEqual(completed(await ask("Give AAA a cash resilience score", on)).financial_gap, { reason_code: "unsupported" });
      assert.equal(turns.length, 0, "the analyst agent receives no call");
    });
  }

  await t.test("a named fiscal year is planned for that year", async () => {
    const { rows } = await answer("AAA cash resilience for FY2023");
    assert.deepEqual(rows.map((row: string[]) => row[1]), ["FY2023 (ended 2023-12-31)", "FY2023 (ended 2023-12-31)", "FY2023 (as of 2023-12-31)", "FY2023 (as of 2023-12-31)", "FY2023 (as of 2023-12-31)", "FY2023 (ended 2023-12-31)", "FY2023 (as of 2023-12-31)", "FY2023 (as of 2023-12-31)"]);
    assert.deepEqual(rows.map((row: string[]) => row[2]), ["120", "100", "300", "600", "200", "1.2", "0.5", "1.5"]);
  });

  await t.test("a quarterly, TTM, score, peer-rank, or debt request is unsupported, never answered annually", async () => {
    for (const request of ["Quarterly cash resilience for AAA", "AAA cash resilience TTM", "Give AAA a cash resilience score", "Rank AAA's cash resilience against peers", "AAA cash resilience and net debt"]) {
      assert.deepEqual(completed(await ask(request)).financial_gap, { reason_code: "unsupported" }, request);
    }
  });

  await t.test("a company without the inputs keeps every row as a named gap", async () => {
    const { rows } = await answer("Show BBB's cash resilience");
    assert.deepEqual(rows.map((row: string[]) => row[2]), ["missing", "missing", "missing", "missing", "missing", "blocked_dependency", "blocked_dependency", "blocked_dependency"]);
  });

  await t.test("an ambiguous company is asked about before anything is planned", async () => {
    assert.equal(completed(await ask("Cash resilience for AMB")).clarification, true);
  });

  await t.test("an input only filed for an older year is a named gap under the latest fiscal year, never the older balance (#344)", async () => {
    await seedCashResilience(db, { total_liabilities: "999" }, { subject: IDS.issuerB, years: { total_liabilities: 2022 } });
    const { rows } = await answer("Show BBB's cash resilience");
    assert.deepEqual(rows, [
      ["Operating cash flow", "FY2023 (ended 2023-12-31)", "120"],
      ["Net income including noncontrolling interest", "FY2023 (ended 2023-12-31)", "100"],
      ["Total liabilities", "end of latest fiscal year", "missing"],
      ["Total assets", "FY2023 (as of 2023-12-31)", "600"],
      ["Stockholders' equity", "FY2023 (as of 2023-12-31)", "200"],
      ["Cash conversion: operating cash flow / net income including noncontrolling interest (reported period)", "FY2023 (ended 2023-12-31)", "1.2"],
      ["Total liabilities / total assets (period-end balance sheet)", "end of latest fiscal year", "blocked_dependency"],
      ["Total liabilities / stockholders' equity (period-end balance sheet)", "end of latest fiscal year", "blocked_dependency"],
    ]);
  });
});
