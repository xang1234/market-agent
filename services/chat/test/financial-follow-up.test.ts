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
import { parseProposal, proposalQuestion, proposeScope } from "../src/scope-proposal.ts";
import type { ChatResolvedSubjectPreResolution, ChatSubjectPreResolution } from "../src/subjects.ts";
import { chatDatabase, chatHarness, completed, resolveMention, revenueModel } from "./financial-fixtures.ts";

const QUESTION = "Why did it change?";

// AAA as the resolver hands it to the analyst path, with its handoff.
async function withHandoff(mention: string): Promise<ChatSubjectPreResolution> {
  const resolution = await resolveMention(mention);
  if (resolution.status !== "resolved") return resolution;
  const handoff = { subject_ref: resolution.subject_ref, context: {}, display_labels: { ticker: mention } };
  return { ...resolution, handoff } as unknown as ChatSubjectPreResolution;
}

// A plan that reports AAA's FY2023 figures.
const reporting = (...metricKeys: string[]) => (async () => ({
  model: "stub-model",
  text: JSON.stringify({
    outcome: "ready",
    subjects: [{ slot_id: "a", mention: "AAA" }],
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
    replies: [{ match: proposalQuestion(QUESTION), text: '{"metrics":[],"asks":["explains"],"turns_off":{"facets":[],"metrics":[]},"income_items":[],"period":{"kind":"none"},"companies":{"kind":"as_named","names":[]}}' }],
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

  const harness = chatHarness(pool, { model: reporting(...metricKeys), researchScope: financialResearchScope, resolveMention: withHandoff });
  const answer = completed((await harness.run({ threadId, userId: IDS.owner, userIntent: question })).events);
  const saved = (await db.query(`select research_scope from chat_messages where message_id = $1`, [answer.message_id])).rows[0].research_scope;

  const aaa = await withHandoff("AAA") as ChatResolvedSubjectPreResolution;
  const scope = (await analystTurnScope(threadId, QUESTION, [aaa], proposeScope({ question: QUESTION })))("2026-09-01T00:00:00.000Z");
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

test("a company picked in a clarification is saved labelled, so follow-ups with peers on and then off keep it (#425)", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for the financial follow-up");
    return;
  }
  const { db, pool, threadId } = await chatDatabase(t, "chat-fin-follow-up-pick");
  const replies = join(mkdtempSync(join(tmpdir(), "fin-follow-up-")), "replies.json");
  const reading = (turnsOff: string[]) => JSON.stringify({ metrics: [], asks: ["explains"], turns_off: { facets: turnsOff, metrics: [] }, income_items: [], period: { kind: "none" }, companies: { kind: "as_named", names: [] } });
  writeFileSync(replies, JSON.stringify({
    replies: [
      { match: proposalQuestion(QUESTION), text: reading([]) },
      { match: proposalQuestion("Without the peers, why did it change?"), text: reading(["peers"]) },
    ],
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

  const question = "How does AMB's FY2023 revenue compare with its peers?";
  // hand-labelled 2026-10-22 #472: period and companies added by hand; replace on live re-record.
  const readQuestion = async () => parseProposal(JSON.stringify({ metrics: [{ metric: "income_statement" }], asks: ["peers"], turns_off: { facets: [], metrics: [] }, income_items: ["revenue"], period: { kind: "fiscal_year", fiscal_year: 2023 }, companies: { kind: "as_named", names: ["AMB"] } }), question);
  const harness = chatHarness(pool, { model: revenueModel(["AMB"]), researchScope: financialResearchScope, readQuestion, resolveMention: withHandoff });
  const offered = completed((await harness.run({ threadId, userId: IDS.owner, userIntent: question })).events).financial_clarification as { clarification_id: string; choices: Array<{ choice_id: string; label: string }> };
  const alpha = offered.choices.find((choice) => choice.label === "Alpha Industries Inc.")!;
  const answer = completed((await harness.run({ threadId, userId: IDS.owner, userIntent: question, clarificationAnswer: { clarification_id: offered.clarification_id, choice_id: alpha.choice_id } })).events);
  const saved = (await db.query(`select research_scope from chat_messages where message_id = $1`, [answer.message_id])).rows[0]?.research_scope;
  assert.deepEqual([saved?.companies, saved?.peers, saved?.fiscal_year], [[{ issuer_id: IDS.issuerA, label: "Alpha Industries Inc." }], true, 2023]);

  const aaa = await withHandoff("AAA") as ChatResolvedSubjectPreResolution;
  const followUp = async (text: string) => {
    const scope = (await analystTurnScope(threadId, text, [aaa], proposeScope({ question: text })))("2026-09-01T00:00:00.000Z");
    return { companies: scope.companies, peers: scope.peers, fiscal_year: scope.fiscal_year };
  };
  assert.deepEqual(await followUp(QUESTION), { companies: [{ issuer_id: IDS.issuerA, label: "AAA" }], peers: true, fiscal_year: 2023 });
  assert.deepEqual(await followUp("Without the peers, why did it change?"), { companies: [{ issuer_id: IDS.issuerA, label: "AAA" }], peers: false, fiscal_year: 2023 });
});

test("an engine answer to an evidence question after a gap saves that it showed figures (#425)", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for the financial follow-up");
    return;
  }
  const { db, pool, threadId } = await chatDatabase(t, "chat-fin-follow-up-gap-evidence");
  Object.assign(process.env, { CHAT_DATABASE_URL: databaseUrl(db) });
  registerLifoCleanup(t, () => closeLocalRuntimePoolForTests());
  const { rows: [snapshot] } = await db.query<{ snapshot_id: string }>(
    `insert into snapshots (subject_refs, as_of, basis, normalization, allowed_transforms)
     values (jsonb_build_array(jsonb_build_object('kind', 'issuer', 'id', $1::text)), now(), 'unadjusted', 'raw', '{}')
     returning snapshot_id::text as snapshot_id`,
    [IDS.issuerA],
  );
  const gapScope = {
    route: "financial_gap", reads: "financial_gap", companies: [{ issuer_id: IDS.issuerA, label: "AAA" }],
    peers: false, segments: false, margin_trend: false, margins: false, metrics: [], fiscal_year: null, fiscal_quarter: null, price_window: null, benchmark: false, inherited: [],
  };
  await db.query(
    `insert into chat_messages (thread_id, role, snapshot_id, blocks, content_hash, research_scope)
     values ($1::uuid, 'assistant', $2::uuid, '[]'::jsonb, 'gap', $3::jsonb)`,
    [threadId, snapshot!.snapshot_id, JSON.stringify(gapScope)],
  );
  const readQuestion = async () => parseProposal(JSON.stringify({ metrics: [{ metric: "eps_diluted" }], asks: ["evidence"], turns_off: { facets: [], metrics: [] }, income_items: [], period: { kind: "none" }, companies: { kind: "as_named", names: [] } }), "Show the evidence for AAA's EPS");
  const harness = chatHarness(pool, { model: reporting("eps_diluted"), researchScope: financialResearchScope, readQuestion, resolveMention: withHandoff });
  const answer = completed((await harness.run({ threadId, userId: IDS.owner, userIntent: "Show the evidence for AAA's EPS" })).events);
  const saved = (await db.query(`select research_scope from chat_messages where message_id = $1`, [answer.message_id])).rows[0]?.research_scope;
  assert.deepEqual([saved?.route, saved?.reads], ["evidence_followup", "financial_answer"]);
});
