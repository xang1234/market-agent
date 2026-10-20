// A follow-up to the engine's answer reads the figures it published (#378
// review): the saved scope takes the plan's metrics.

import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { dockerAvailable, registerLifoCleanup } from "../../../db/test/docker-pg.ts";
import type { PlanningModel } from "../../financial-engine/src/planner.ts";
import { databaseUrl, IDS } from "../../financial-engine/test/db-fixtures.ts";
import { analystTurnScope, closeLocalRuntimePoolForTests, financialResearchScope } from "../src/local-runtime.ts";
import { proposalQuestion } from "../src/scope-proposal.ts";
import type { ChatResolvedSubjectPreResolution, ChatSubjectPreResolution } from "../src/subjects.ts";
import { chatDatabase, chatHarness, completed, INSTRUMENT_A, LISTING_A, resolveMention } from "./financial-fixtures.ts";

const QUESTION = "Why did it change?";

// AAA as the resolver hands it to the analyst path, with its handoff.
async function withHandoff(mention: string): Promise<ChatSubjectPreResolution> {
  const resolution = await resolveMention(mention);
  if (resolution.status !== "resolved") return resolution;
  const handoff = { subject_ref: resolution.subject_ref, context: {}, display_labels: { ticker: mention } };
  return { ...resolution, handoff } as unknown as ChatSubjectPreResolution;
}

// A plan that reports FY2023 figures for the company `mention` names.
const reporting = (mention: string, ...metricKeys: string[]) => (async () => ({
  model: "stub-model",
  text: JSON.stringify({
    outcome: "ready",
    subjects: [{ slot_id: "a", mention }],
    operations: metricKeys.map((metricKey, i) => ({ node_id: `a_metric_${i}`, operation: "reported_metric", subject_slot: "a", metric_key: metricKey, period: { kind: "fiscal_period", fiscal_year: 2023, fiscal_period: "FY" } })),
    outputs: metricKeys.map((_, i) => ({ output_id: `a_out_${i}`, node_id: `a_metric_${i}` })),
    thresholds: [],
  }),
})) as unknown as PlanningModel;

// The engine answers the question with the plan, then QUESTION follows it up:
// the scope the engine's answer saved, and the follow-up's.
async function followUpToEngine(t: TestContext, prefix: string, metricKeys: string[], question: string) {
  const { db, pool, threadId } = await chatDatabase(t, prefix);
  const replies = join(mkdtempSync(join(tmpdir(), "fin-follow-up-")), "replies.json");
  writeFileSync(replies, JSON.stringify({
    replies: [{ match: proposalQuestion(QUESTION), text: '{"metrics":[],"asks":["explains"],"turns_off":{"facets":[],"metrics":[]},"income_items":[]}' }],
  }));
  Object.assign(process.env, {
    CHAT_DATABASE_URL: databaseUrl(db),
    LLM_CHANNELS: "fixture",
    LLM_FIXTURE_PROTOCOL: "openai",
    LLM_FIXTURE_MODELS: "recorded",
    LITELLM_MODEL: "fixture/recorded",
    LLM_REPLAY_FILE: replies,
  });
  // Closed before the database it connects to stops.
  registerLifoCleanup(t, () => closeLocalRuntimePoolForTests());

  const harness = chatHarness(pool, { model: reporting("AAA", ...metricKeys), researchScope: financialResearchScope, resolveMention: withHandoff });
  const answer = completed((await harness.run({ threadId, userId: IDS.owner, userIntent: question })).events);
  const saved = (await db.query(`select research_scope from chat_messages where message_id = $1`, [answer.message_id])).rows[0].research_scope;

  const aaa = await withHandoff("AAA") as ChatResolvedSubjectPreResolution;
  const scope = (await analystTurnScope(threadId, QUESTION, [aaa]))("2026-09-01T00:00:00.000Z");
  return {
    saved: [saved.reads, saved.metrics],
    followUp: { route: scope.route, reads: scope.reads, metrics: scope.metrics.map((metric) => metric.metric_key), explains: scope.explains },
  };
}

test("a follow-up to the engine's EPS answer reads EPS", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for the financial follow-up");
    return;
  }
  assert.deepEqual(await followUpToEngine(t, "chat-fin-follow-up", ["eps_diluted"], "What was AAA's EPS?"), {
    saved: ["financial_answer", [{ metric_key: "eps_diluted", label: "Earnings per share", available: true }]],
    followUp: { route: "statements", reads: "statements", metrics: ["eps_diluted"], explains: true },
  });
});

test("a follow-up to the engine's share count does not call the figure it just showed unavailable (#381)", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for the financial follow-up");
    return;
  }
  assert.deepEqual(await followUpToEngine(t, "chat-fin-follow-up-shares", ["shares_outstanding"], "What were AAA's shares outstanding?"), {
    saved: ["financial_answer", []],
    followUp: { route: "latest_quarter", reads: "latest_quarter", metrics: [], explains: true },
  });
});

test("a follow-up to the engine's revenue and share count keeps the revenue and names no gap (#381)", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for the financial follow-up");
    return;
  }
  assert.deepEqual(await followUpToEngine(t, "chat-fin-follow-up-mixed", ["revenue", "shares_outstanding"], "What were AAA's revenue and shares outstanding?"), {
    saved: ["financial_answer", [{ metric_key: "income_statement", label: "Revenue, profit and margins", available: true }]],
    followUp: { route: "latest_quarter", reads: "latest_quarter", metrics: ["income_statement"], explains: true },
  });
});

test("a follow-up continues an answer whose company came from a clarification pick or from listings of one company", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for the financial follow-up");
    return;
  }
  for (const [prefix, mention, pick] of [["chat-fin-follow-up-pick", "AMB", "Alpha Industries Inc."], ["chat-fin-follow-up-listings", "AMBX", null]] as const) {
    const { db, pool, threadId } = await chatDatabase(t, prefix);
    const replies = join(mkdtempSync(join(tmpdir(), "fin-follow-up-")), "replies.json");
    writeFileSync(replies, JSON.stringify({
      replies: [{ match: proposalQuestion(QUESTION), text: '{"metrics":[],"asks":["explains"],"turns_off":{"facets":[],"metrics":[]},"income_items":[]}' }],
    }));
    Object.assign(process.env, {
      CHAT_DATABASE_URL: databaseUrl(db),
      LLM_CHANNELS: "fixture",
      LLM_FIXTURE_PROTOCOL: "openai",
      LLM_FIXTURE_MODELS: "recorded",
      LITELLM_MODEL: "fixture/recorded",
      LLM_REPLAY_FILE: replies,
    });
    registerLifoCleanup(t, () => closeLocalRuntimePoolForTests());
    await db.query(`insert into instruments (instrument_id, issuer_id, asset_type) values ($1::uuid, $2::uuid, 'common_stock')`, [INSTRUMENT_A, IDS.issuerA]);
    await db.query(
      `insert into listings (listing_id, instrument_id, mic, ticker, trading_currency, timezone)
       values ($1::uuid, $2::uuid, 'XNAS', 'ALPX', 'USD', 'America/New_York')`,
      [LISTING_A, INSTRUMENT_A],
    );

    const harness = chatHarness(pool, { model: reporting(mention, "eps_diluted"), researchScope: financialResearchScope, resolveMention: withHandoff });
    const turn = { threadId, userId: IDS.owner, userIntent: `What was ${mention}'s EPS?` };
    let answer = completed((await harness.run(turn)).events);
    if (pick) {
      const offered = answer.financial_clarification as { clarification_id: string; choices: Array<{ choice_id: string; label: string }> };
      const choice = offered.choices.find((candidate) => candidate.label === pick)!;
      answer = completed((await harness.run({ ...turn, clarificationAnswer: { clarification_id: offered.clarification_id, choice_id: choice.choice_id } })).events);
    }
    const saved = (await db.query(`select research_scope from chat_messages where message_id = $1`, [answer.message_id])).rows[0].research_scope;
    const aaa = await withHandoff("AAA") as ChatResolvedSubjectPreResolution;
    const followUp = (await analystTurnScope(threadId, QUESTION, [aaa]))("2026-09-01T00:00:00.000Z");
    assert.deepEqual(
      [saved.companies.map((company: { issuer_id: string }) => company.issuer_id), followUp.metrics.map((metric) => metric.metric_key)],
      [[IDS.issuerA], ["eps_diluted"]],
      `${mention}: the answer saves the company it answered for, and the follow-up continues it`,
    );
    await closeLocalRuntimePoolForTests();
  }
});
