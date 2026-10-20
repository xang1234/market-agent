// The annual cash-resilience view in chat (#210): an explicit request is
// planned deterministically, with no model, and sealed like any certified answer.

import assert from "node:assert/strict";
import test from "node:test";
import { dockerAvailable } from "../../../db/test/docker-pg.ts";
import { IDS, seedCashResilience } from "../../financial-engine/test/db-fixtures.ts";
import { listChatMessagesForThread } from "../src/messages.ts";
import { chatDatabase, chatHarness, completed } from "./financial-fixtures.ts";

test("chat cash resilience", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for chat financial coverage");
    return;
  }
  const { db, pool, threadId } = await chatDatabase(t, "chat-cash-res");
  await seedCashResilience(db);
  const ask = async (userIntent: string) =>
    (await chatHarness(pool, { model: null }).run({ threadId, userId: IDS.owner, userIntent })).events;
  const answer = async (userIntent: string) => {
    const done = completed(await ask(userIntent));
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
        ["Operating cash flow", "latest fiscal year", "120"],
        ["Net income", "latest fiscal year", "100"],
        ["Total liabilities", "end of latest fiscal year", "300"],
        ["Total assets", "end of latest fiscal year", "600"],
        ["Stockholders' equity", "end of latest fiscal year", "200"],
        ["Cash conversion: operating cash flow / net income (reported period)", "latest fiscal year", "1.2"],
        ["Total liabilities / total assets (period-end balance sheet)", "end of latest fiscal year", "0.5"],
        ["Total liabilities / stockholders' equity (period-end balance sheet)", "end of latest fiscal year", "1.5"],
      ],
    });
  });

  await t.test("a named fiscal year is planned for that year", async () => {
    const { rows } = await answer("AAA cash resilience for FY2023");
    assert.deepEqual(rows.map((row: string[]) => row[1]), ["FY2023", "FY2023", "end of FY2023", "end of FY2023", "end of FY2023", "FY2023", "end of FY2023", "end of FY2023"]);
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
      ["Operating cash flow", "latest fiscal year", "120"],
      ["Net income", "latest fiscal year", "100"],
      ["Total liabilities", "end of latest fiscal year", "missing"],
      ["Total assets", "end of latest fiscal year", "600"],
      ["Stockholders' equity", "end of latest fiscal year", "200"],
      ["Cash conversion: operating cash flow / net income (reported period)", "latest fiscal year", "1.2"],
      ["Total liabilities / total assets (period-end balance sheet)", "end of latest fiscal year", "blocked_dependency"],
      ["Total liabilities / stockholders' equity (period-end balance sheet)", "end of latest fiscal year", "blocked_dependency"],
    ]);
  });
});
