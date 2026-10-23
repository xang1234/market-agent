import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import test from "node:test";

import { bootstrapDatabase, connectedClient, connectedPool, dockerAvailable } from "../../../db/test/docker-pg.ts";
import type { FinancialAnswerContent } from "../../financial-core/src/index.ts";
import type { PlanningModel } from "../../financial-engine/src/planner.ts";
import { createReplayLlmChatClient } from "../../llm/src/replay-client.ts";
import { answerTurn } from "../src/answer-trace.ts";
import { saveCommentary } from "../src/engine-commentary.ts";
import { resultRefProblem } from "../src/prose-refs.ts";
import { plainText } from "../src/render-assertions.ts";
import type { ScopeProposal } from "../src/research-scope.ts";
import type { ChatSubjectPreResolution } from "../src/subjects.ts";
import { chatHarness, completed, NO_ASKS, readingOf } from "./financial-fixtures.ts";
import { GOLDEN_COMPANIES, seedGoldenDataset } from "./golden/dataset.ts";
import { GOLDEN_ENV } from "./golden/harness.ts";

const OWNER = "10000000-0000-4000-8000-000000000001";

// As chat's resolver does, a ticker resolves to its listing, labelled by its ticker.
async function resolveListing(mention: string): Promise<ChatSubjectPreResolution> {
  const company = GOLDEN_COMPANIES.find((candidate) => candidate.ticker === mention);
  return (company
    ? { status: "resolved", subject_ref: { kind: "listing", id: company.listing_id }, display_label: `${company.ticker} (XNAS)`, handoff: { display_labels: { ticker: company.ticker } } }
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
  // The analyst prose on an overview, from the recorded replies; no judge is configured, so inferences stay hidden.
  const commentary = (db: Parameters<typeof saveCommentary>[0], input: Parameters<typeof saveCommentary>[2]) =>
    saveCommentary(db, (answer, turn) => answerTurn(answer, turn, { env: GOLDEN_ENV }), input);

  const ask = async (userIntent: string, readQuestion?: (question: string) => Promise<ScopeProposal | null>) => {
    const { events } = await chatHarness(pool, { model, resolveMention: resolveListing, commentary, ...(readQuestion ? { readQuestion } : {}) }).run({ threadId, userId: OWNER, userIntent });
    const done = completed(events);
    const message = (await client.query(`select blocks from chat_messages where message_id = $1`, [done.message_id])).rows[0];
    assert.ok(message, `expected a published answer; got ${JSON.stringify(done)}`);
    return (message.blocks[0].financial.results as Array<{ output_id: string; disposition: string; presented: { kind: string; text: string } }>)
      .map((result) => [result.output_id, result.disposition, result.presented.kind === "gap" ? null : result.presented.text]);
  };
  // The latest answer's commentary, which follows its engine block and cites
  // only that block's verified results, each with its exact text and period.
  const commentaryText = async () => {
    const { rows: [{ blocks }] } = await client.query(`select blocks from chat_messages where thread_id = $1 and role = 'assistant' order by created_at desc limit 1`, [threadId]);
    const [answer, prose] = blocks as Array<Record<string, unknown> & { kind: string; financial: FinancialAnswerContent }>;
    assert.deepEqual(blocks.map((block: { kind: string; analyst_commentary?: boolean }) => [block.kind, block.analyst_commentary ?? false]), [["financial_answer", false], ["rich_text", true]]);
    const segments = prose!.segments as Parameters<typeof plainText>[0];
    const { results, labels } = answer!.financial;
    assert.deepEqual(segments.flatMap((segment) => segment.type === "ref" ? [segment] : []), segments.flatMap((segment) => {
      const result = segment.type === "ref" ? results.find((entry) => entry.result_id === segment.ref_id && entry.disposition === "verified") : undefined;
      return result ? [{ type: "ref", ref_kind: "result", ref_id: result.result_id, format: result.presented.text, period: labels[result.period_label_id]!.text }] : [];
    }));
    assert.equal(resultRefProblem(prose!, answer!), null);
    return plainText(segments);
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
  // Each reading names the company its question writes, with no figure asked: the overview.
  assert.deepEqual(await ask("Analyze NVDA's profit", readingOf(NO_ASKS)), [
    ["out_revenue_fy2025_q1", "verified", "USD 26,044,000,000.00"],
    ["out_revenue_fy2025_q2", "verified", "USD 30,040,000,000.00"],
    ["out_revenue_fy2025_q3", "verified", "USD 35,082,000,000.00"],
    ["out_revenue_fy2025_q4", "verified", "USD 39,331,000,000.00"],
    ["out_revenue_fy2026_q1", "verified", "USD 44,062,000,000.00"],
    ["out_revenue_fy2026_q2", "verified", "USD 46,743,000,000.00"],
    ["out_revenue_fy2026_q3", "verified", "USD 57,006,000,000.00"],
    ["out_revenue_fy2026_q4", "verified", "USD 62,100,000,000.00"],
    ["out_gross_profit_fy2026_q4", "verified", "USD 46,200,000,000.00"],
    ["out_operating_income_fy2026_q4", "verified", "USD 40,300,000,000.00"],
    ["out_net_income_fy2026_q4", "verified", "USD 35,400,000,000.00"],
    ["out_gross_margin", "verified", "74.40%"],
    ["out_operating_margin", "verified", "64.90%"],
    ["out_net_margin", "verified", "57.00%"],
    ["out_revenue_growth_qoq_fy2025_q2", "verified", "15.34%"],
    ["out_revenue_growth_qoq_fy2025_q3", "verified", "16.78%"],
    ["out_revenue_growth_qoq_fy2025_q4", "verified", "12.11%"],
    ["out_revenue_growth_qoq_fy2026_q1", "verified", "12.03%"],
    ["out_revenue_growth_qoq_fy2026_q2", "verified", "6.08%"],
    ["out_revenue_growth_qoq_fy2026_q3", "verified", "21.96%"],
    ["out_revenue_growth_qoq", "verified", "8.94%"],
    ["out_revenue_growth_yoy", "verified", "57.89%"],
    ["out_revenue_highest", "verified", "Q4 FY2026 has the highest revenue of the 8 quarters ranked"],
    ["out_revenue_lowest", "verified", "Q1 FY2025 has the lowest revenue of the 8 quarters ranked"],
  ]);
  assert.equal(await commentaryText(), [
    "NVDA's revenue rose in every period from Q1 FY2025 (USD 26,044,000,000.00) to Q4 FY2026 (USD 62,100,000,000.00).",
    "NVDA's gross margin (gross profit / revenue) was 74.40%, operating margin (operating income / revenue) 64.90% and net margin (net income / revenue) 57.00% in Q4 FY2026.",
  ].join("\n\n"));
  const latestQuarter = (slot: string, quarter: string, values: string[]) =>
    [`revenue_${quarter}`, `gross_profit_${quarter}`, `operating_income_${quarter}`, `net_income_${quarter}`, "gross_margin", "operating_margin", "net_margin", "revenue_growth_qoq", "revenue_growth_yoy"]
      .map((id, index) => [`out_${slot}_${id}`, "verified", values[index]]);
  const NVDA = ["USD 62,100,000,000.00", "USD 46,200,000,000.00", "USD 40,300,000,000.00", "USD 35,400,000,000.00", "74.40%", "64.90%", "57.00%", "8.94%", "57.89%"];
  const AMD = ["USD 11,200,000,000.00", "USD 6,050,000,000.00", "USD 1,610,000,000.00", "USD 1,480,000,000.00", "54.02%", "14.38%", "13.21%", "4.67%", "45.74%"];
  const AAPL = ["USD 97,100,000,000.00", "USD 45,700,000,000.00", "USD 29,800,000,000.00", "USD 24,900,000,000.00", "47.06%", "30.69%", "25.64%", "-1.62%", "3.26%"];
  // NVDA's latest quarter ends in January and the others' in June, so each lead takes the other company's
  // quarter that ends in December, 29 days before NVDA's: AMD's Q4 FY2025 and AAPL's Q1 FY2026.
  const MARGINS = ["gross_margin", "operating_margin", "net_margin"];
  const closest = (slot: string, quarter: string, values: string[]) => MARGINS.map((metric, index) => [`out_${slot}_${metric}_${quarter}`, "verified", values[index]]);
  const AMD_Q4_FY2025 = closest("b", "fy2025_q4", ["53.98%", "14.08%", "13.11%"]);
  const LEADS: Record<string, string[]> = { b: ["20.42 pp", "50.82 pp", "43.90 pp"], c: ["27.36 pp", "30.44 pp", "27.71 pp"] };
  const leads = (...slots: string[]) => MARGINS.flatMap((metric, index) => slots.map((slot) => [`out_a_minus_${slot}_${metric}`, "verified", LEADS[slot]![index]]));
  assert.deepEqual(await ask("Compare NVDA and AMD profit", readingOf(NO_ASKS)), [...latestQuarter("a", "fy2026_q4", NVDA), ...latestQuarter("b", "fy2026_q2", AMD), ...AMD_Q4_FY2025, ...leads("b")]);
  // The recorded reply's gross margin comparison (NVDA's Q4 FY2026 against AMD's Q2 FY2026) is rejected:
  // AMD is shown for two quarters now, so companies are compared at one period, and the lead states it.
  assert.equal(await commentaryText(), [
    "Of NVDA and AMD, NVDA's year-over-year percent change in revenue was highest: NVDA 57.89% (Q4 FY2026 vs Q4 FY2025), AMD 45.74% (Q2 FY2026 vs Q2 FY2025).",
    "NVDA's revenue was USD 62,100,000,000.00 in Q4 FY2026; AMD's revenue was USD 11,200,000,000.00 in Q2 FY2026.",
  ].join("\n\n"));
  assert.deepEqual(await ask("Compare NVDA, AMD and AAPL profit", readingOf(NO_ASKS)), [
    ...latestQuarter("a", "fy2026_q4", NVDA),
    ...latestQuarter("b", "fy2026_q2", AMD),
    ...latestQuarter("c", "fy2026_q3", AAPL),
    ...AMD_Q4_FY2025,
    ...closest("c", "fy2026_q1", ["47.03%", "34.45%", "29.30%"]),
    ...leads("b", "c"),
  ]);
});
