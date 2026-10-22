// Certified market cap and P/E in chat (#444): a turn asking for NVDA's market
// cap or P/E is a financial request, plans the valuation, binds Polygon's
// Friday close beside the filed share count or diluted EPS, and answers with
// the sealed figure and the inputs it read, each inspectable with its date.

import assert from "node:assert/strict";
import test from "node:test";
import { dockerAvailable } from "../../../db/test/docker-pg.ts";
import type { FinancialPlanV1 } from "../../financial-core/src/index.ts";
import { inspectCommittedResult } from "../../financial-engine/src/inspection.ts";
import { buildDeterministicPlan, type PlanningModel } from "../../financial-engine/src/planner.ts";
import { authorityFor, IDS, NVDA, seedNvda } from "../../financial-engine/test/db-fixtures.ts";
import { isFinancialRequest, uncoveredAsks } from "../src/financial-runtime.ts";
import { listChatMessagesForThread } from "../src/messages.ts";
import { parseProposal } from "../src/scope-proposal.ts";
import { extractSubjectMentions } from "../src/subject-extraction.ts";
import type { ChatSubjectPreResolution } from "../src/subjects.ts";
import { chatDatabase, chatHarness, completed, resolveMention } from "./financial-fixtures.ts";

type Valuation = "market_cap" | "pe_ratio";

/** NVDA's market cap or P/E as a planning model drafts it, publishing only the figure. */
function valuationDraft(valuation: Valuation) {
  const reported = (node_id: string, metric_key: string, period: Record<string, unknown>) => ({ node_id, operation: "reported_metric", subject_slot: "a", metric_key, period });
  const operand = valuation === "market_cap"
    ? reported("shares", "shares_outstanding", { kind: "latest", period_type: "quarterly", offset: 0 })
    : reported("eps", "eps_diluted", { kind: "latest", period_type: "annual", offset: 0 });
  return {
    subjects: [{ slot_id: "a", mention: "NVDA" }],
    operations: [
      reported("px", "share_price", { kind: "at_cutoff" }),
      operand,
      valuation === "market_cap"
        ? { node_id: "cap", operation: "market_cap", price: "px", shares: "shares" }
        : { node_id: "pe", operation: "pe_ratio", price: "px", earnings: "eps" },
    ],
    outputs: [{ output_id: "out", node_id: valuation === "market_cap" ? "cap" : "pe" }],
    thresholds: [],
  };
}

function valuationModel(valuation: Valuation): PlanningModel {
  return (async () => ({ model: "stub-model", text: JSON.stringify({ outcome: "ready", ...valuationDraft(valuation) }) })) as unknown as PlanningModel;
}

const resolveNvda = (mention: string): Promise<ChatSubjectPreResolution> => mention === "NVDA"
  ? Promise.resolve({ status: "resolved", subject_ref: { kind: "issuer", id: NVDA.issuer }, display_label: "NVIDIA Corporation", handoff: { display_labels: { ticker: "NVDA" } } } as unknown as ChatSubjectPreResolution)
  : resolveMention(mention);

test("a question about market cap or P/E takes the financial lane, and P/E names no company (#444)", () => {
  assert.deepEqual(
    ["What is NVDA's market cap?", "NVDA market capitalization", "What's NVDA's P/E?", "NVDA PE ratio", "NVDA price-to-earnings", "How is NVDA doing?"].map(isFinancialRequest),
    [true, true, true, true, true, false],
  );
  assert.deepEqual(extractSubjectMentions("Compare the P/E and PE ratio of NVDA and AMD"), ["NVDA", "AMD"]);
});

test("an answer that computes a valuation covers the reading that asks for it, and names one it does not compute (#444)", () => {
  const plan = (valuation: Valuation): FinancialPlanV1 => {
    const planned = buildDeterministicPlan({
      plan_id: "4f000000-0000-4000-8000-0000000007a1",
      origin: { kind: "chat_request", ref: "chat:valuation" },
      knowledge_cutoff: NVDA.cutoff,
      cutoff_timezone: "UTC",
      reporting_basis: "as_reported",
      freshness_max_age_days: null,
      authority: authorityFor(IDS.owner, { allowed_source_classes: ["sec_filing", "market_data"] }),
      parent_limits: {},
      max_model_calls: 0,
      requested_subjects: [{ mention: "NVDA", resolution: { status: "resolved", subject_ref: { kind: "issuer", id: NVDA.issuer }, label: "NVIDIA Corporation" } }],
      publication_unit_kind: "chat_section",
    }, valuationDraft(valuation));
    assert.ok(planned.outcome === "ready", JSON.stringify(planned));
    return planned.plan;
  };
  const reading = parseProposal(JSON.stringify({ metrics: ["market_cap", "pe_ratio"], asks: [], turns_off: { facets: [], metrics: [] }, income_items: [], period: { kind: "none" }, companies: { kind: "as_named" } }), "");
  assert.ok(reading);
  assert.deepEqual([uncoveredAsks(reading, plan("market_cap")), uncoveredAsks(reading, plan("pe_ratio"))], [["P/E ratio"], ["market capitalization"]]);
});

test("certified market cap and P/E in chat", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for chat valuation coverage");
    return;
  }
  const { db, pool, threadId } = await chatDatabase(t, "chat-valuation");
  await seedNvda(db);

  type Answer = { kind: string; financial: { labels: Record<string, { text: string }>; results: Array<{ result_id: string; measure_label_id: string; period_label_id: string; disposition: string; presented: { full_text?: string } }> } };
  const ask = async (question: string, valuation: Valuation) => {
    const done = completed((await chatHarness(pool, { model: valuationModel(valuation), resolveMention: resolveNvda, clock: () => new Date(NVDA.cutoff) })
      .run({ threadId, userId: IDS.owner, userIntent: question })).events);
    const read = await listChatMessagesForThread(pool, { thread_id: threadId, user_id: IDS.owner });
    const message = read!.messages.find((candidate) => candidate.message_id === done.message_id)!;
    const block = (message.blocks as unknown as Answer[])[0]!;
    assert.equal(block.kind, "financial_answer");
    const { labels, results } = block.financial;
    return {
      rows: results.map((result) => [labels[result.measure_label_id]!.text, labels[result.period_label_id]!.text, result.disposition, result.presented.full_text]),
      /** The inputs the last result, the figure, read: each one's value and date. */
      inputs: async () => {
        const inspection = await inspectCommittedResult(db, IDS.owner, results.at(-1)!.result_id);
        assert.ok(inspection?.availability === "available");
        return inspection.inputs.map((input) => input.status !== "bound" ? [input.input_slot, input.reason_code]
          : "observation" in input ? [input.input_slot, input.value, input.observation.observed_at]
          : [input.input_slot, input.value, input.period.end, `${input.period.fiscal_period} FY${input.period.fiscal_year}`]);
      },
    };
  };

  await t.test("a market cap turn answers NVDA's certified market cap beside the price and share count it read", async () => {
    const answer = await ask("What is NVDA's market cap?", "market_cap");
    assert.deepEqual(answer.rows, [
      ["Share price", "latest known at the cutoff", "verified", "USD 120 per share"],
      ["Shares outstanding", "end of latest fiscal quarter", "verified", "24640000000 shares"],
      ["Market capitalization (share price × shares outstanding)", "latest known at the cutoff", "verified", "USD 2956800000000"],
    ]);
    // Friday's 1200.00 close and the 10-Q's 2,464,000,000 shares at 2024-05-17, each restated after Monday's 10-for-1 split.
    assert.deepEqual(await answer.inputs(), [["px", "1200", "2024-06-07T20:00:00.000Z"], ["shares", "2464000000", "2024-05-17", "Q1 FY2025"]]);
  });

  await t.test("a P/E turn answers NVDA's certified P/E beside the price and the latest fiscal year's diluted EPS", async () => {
    const answer = await ask("What's NVDA's P/E?", "pe_ratio");
    assert.deepEqual(answer.rows, [
      ["Share price", "latest known at the cutoff", "verified", "USD 120 per share"],
      ["EPS (diluted)", "latest fiscal year", "verified", "USD 1.193 per share"],
      ["P/E ratio (share price / latest fiscal year diluted EPS)", "latest known at the cutoff", "verified", "100.58675607711651299245599329421626152556580050293x"],
    ]);
    assert.deepEqual(await answer.inputs(), [["eps", "11.93", "2024-01-28", "FY FY2024"], ["px", "1200", "2024-06-07T20:00:00.000Z"]]);
  });
});
