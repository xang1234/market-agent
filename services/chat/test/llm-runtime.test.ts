import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { LlmProviderError, LlmRouterError } from "../../llm/src/index.ts";
import {
  ANSWER_DEADLINES,
  answerContext,
  composeAnalystBlocksWithLlm as composeAnswer,
  TITLE_DEADLINES,
  createLlmThreadTitleModel,
  turnPacket,
} from "../src/llm-runtime.ts";
import { checkAssertions, MAX_ASSERTIONS, type AssertionReport, type Rejection } from "../src/assertions.ts";
import type { EvidencePacket, PacketFigure } from "../src/evidence-packet.ts";
import { scopeGapBlocks } from "../src/local-runtime.ts";
import { resolveResearchScope } from "../src/research-scope.ts";
import { proposal } from "./scope-fixtures.ts";

const BASE_ENV = {
  LLM_CHANNELS: "openai",
  LLM_OPENAI_PROTOCOL: "openai",
  LLM_OPENAI_MODELS: "gpt-4.1",
  LITELLM_MODEL: "openai/gpt-4.1",
};
// The answer as the reader ends with it when the judge entails every inference
// (answer-trace.ts gates them).
const ALL_SHOWN = new Map(Array.from({ length: MAX_ASSERTIONS }, (_, i) => [i, "shown"] as const));
const composeAnalystBlocksWithLlm = async (input: Parameters<typeof composeAnswer>[0]) => (await composeAnswer(input))(ALL_SHOWN);

const NO_ANSWER = "No written answer is available for this question; try asking again.";
// One claim on file, so the answer model is asked: with no figure and no claim it is not (#398).
const ON_FILE = [{
  tool_call_id: "tool-0",
  tool_name: "load_evidence",
  status: "ok",
  result: { evidence: { claims: [{ claim_id: "c0", source_id: "s0", text_canonical: "Apple said demand stayed strong.", predicate: "management.tone", polarity: "positive" }] } },
}] as never;

test("createLlmThreadTitleModel delegates to the shared router", async () => {
  const calls: string[] = [];
  const model = createLlmThreadTitleModel({
    env: BASE_ENV,
    createClient: () => async (_deployment, request) => {
      calls.push(request.messages.map((message) => `${message.role}:${message.content}`).join("\n"));
      return { text: "Apple Margin Watch" };
    },
  });

  const title = await model({
    userIntent: "Why did Apple sell off?",
    assistantText: "Margins compressed after guidance.",
  });

  assert.equal(title, "Apple Margin Watch");
  assert.match(calls[0], /Why did Apple sell off\?/);
  assert.match(calls[0], /Margins compressed/);
});

test("createLlmThreadTitleModel gives reasoning models enough output budget", async () => {
  let observedMaxTokens: number | undefined;
  const model = createLlmThreadTitleModel({
    env: BASE_ENV,
    createClient: () => async (_deployment, request) => {
      observedMaxTokens = request.maxTokens;
      return { text: "Apple Margin Watch" };
    },
  });

  await model({ userIntent: "Why did Apple sell off?", assistantText: "Margins compressed." });

  assert.ok((observedMaxTokens ?? 0) >= 256, `expected a generous title budget for reasoning models, got ${observedMaxTokens}`);
});

test("composeAnalystBlocksWithLlm gives reasoning models room to think and still answer", async () => {
  let observedMaxTokens: number | undefined;
  await composeAnalystBlocksWithLlm({
    env: BASE_ENV,
    context: { userIntent: "Analyze AAPL", bundleId: "single_subject_analysis" },
    blocks: [richTextBlock("Deterministic note")],
    toolCalls: ON_FILE,
    createClient: () => async (_deployment, request) => {
      observedMaxTokens = request.maxTokens;
      return { text: "Apple's revenue rose." };
    },
  });

  // At 800, qwen3.8-max spent the whole budget reasoning and returned no text (#124).
  assert.ok((observedMaxTokens ?? 0) >= 4096, `expected an answer budget that survives reasoning, got ${observedMaxTokens}`);
});

test("composeAnalystBlocksWithLlm reports the model exchange raw, before the checks", async () => {
  const exchanges: unknown[] = [];
  await composeAnalystBlocksWithLlm({
    env: BASE_ENV,
    context: { userIntent: "Analyze AAPL", bundleId: "single_subject_analysis" },
    blocks: [richTextBlock("Deterministic note")],
    toolCalls: ON_FILE,
    createClient: () => async () => ({
      text: "Apple's revenue rose 12%.",
      usage: { inputTokens: 900, outputTokens: 40, totalTokens: 940 },
    }),
    onModelExchange: (exchange) => exchanges.push({ ...exchange, latency_ms: typeof exchange.latency_ms, messages: exchange.messages.map((m) => m.role) }),
  });

  assert.deepEqual(exchanges, [{
    messages: ["system", "user"],
    text: "Apple's revenue rose 12%.",
    truncated: false,
    deployment: "openai/gpt-4.1",
    latency_ms: "number",
    usage: { input_tokens: 900, output_tokens: 40 },
  }]);
});

test("composeAnalystBlocksWithLlm returns original blocks when no deployment is configured", async () => {
  const blocks = [richTextBlock("Deterministic note")];
  const result = await composeAnalystBlocksWithLlm({
    env: {},
    context: { userIntent: "Analyze AAPL", bundleId: "single_subject_analysis" },
    blocks,
    toolCalls: [],
    createClient: () => {
      throw new Error("client should not be created");
    },
  });

  assert.equal(result, blocks);
});

test("composeAnalystBlocksWithLlm rewrites the first rich text block", async () => {
  const result = await composeAnalystBlocksWithLlm({
    env: BASE_ENV,
    context: { userIntent: "Analyze AAPL", bundleId: "single_subject_analysis" },
    blocks: [richTextBlock("Deterministic note")],
    toolCalls: [{
      tool_call_id: "tool-1",
      tool_name: "load_evidence",
      status: "ok",
      bundle_id: "single_subject_analysis",
      arguments: { query: "Analyze AAPL" },
      result: { evidence: { claims: [{ claim_id: "c0", source_id: "s0", text_canonical: "Apple said demand stayed strong.", predicate: "management.tone", polarity: "positive" }] } },
    }],
    createClient: () => async (_deployment, request) => {
      // The question goes in; the raw tool call does not (#181).
      assert.match(request.messages[1]?.content ?? "", /"question":"Analyze AAPL"/);
      assert.doesNotMatch(request.messages[1]?.content ?? "", /load_evidence/);
      return { text: "LLM-grounded note" };
    },
  });

  assert.notEqual(result[0], undefined);
  // The reply lists no assertion, so the answer is the fallback sentence.
  assert.deepEqual(result[0]?.segments, [
    { type: "text", text: "No written answer is available for this question; try asking again." },
  ]);
});

const TWO_DEPLOYMENTS = {
  LLM_CHANNELS: "openai,deepseek",
  LLM_OPENAI_PROTOCOL: "openai",
  LLM_OPENAI_MODELS: "gpt-4.1",
  LLM_DEEPSEEK_BASE_URL: "https://api.deepseek.com/v1",
  LLM_DEEPSEEK_MODELS: "deepseek-chat",
  LITELLM_MODEL: "openai/gpt-4.1",
  LITELLM_FALLBACK_MODELS: "deepseek/deepseek-chat",
};

test("an answer model that hangs falls back at its attempt deadline (#184)", async (t) => {
  const calls: string[] = [];
  const read: string[] = [];
  const startedAt = Date.now();
  await composeAnalystBlocksWithLlm({
    env: TWO_DEPLOYMENTS,
    context: { userIntent: "Analyze AAPL", bundleId: "single_subject_analysis" },
    blocks: [richTextBlock("Deterministic note")],
    toolCalls: ON_FILE,
    deadlines: { attemptMs: 50, totalMs: 5_000 },
    createClient: () => async (deployment) => {
      calls.push(deployment.model);
      // The primary accepts the request and never answers.
      if (calls.length === 1) return hang(t);
      return { text: "fallback note" };
    },
    onModelExchange: (exchange) => read.push(`${exchange.deployment}: ${exchange.text}`),
  });

  assert.deepEqual(calls, ["gpt-4.1", "deepseek-chat"]);
  assert.deepEqual(read, ["deepseek/deepseek-chat: fallback note"]);
  assert.ok(Date.now() - startedAt < 2_000, "the hang cost about the attempt deadline");
});

test("when every model hangs, the answer call ends with an error at its deadline (#184)", async (t) => {
  const startedAt = Date.now();
  await assert.rejects(composeAnalystBlocksWithLlm({
    env: TWO_DEPLOYMENTS,
    context: { userIntent: "Analyze AAPL", bundleId: "single_subject_analysis" },
    blocks: [richTextBlock("Deterministic note")],
    toolCalls: ON_FILE,
    deadlines: { attemptMs: 50, totalMs: 5_000 },
    createClient: () => () => hang(t),
  }), /all LLM deployments failed/);
  assert.ok(Date.now() - startedAt < 2_000);
});

test("only attempts the total can finish are made, so a failure names each timeout (#184)", async (t) => {
  // Two 60 ms attempts can't finish in 100 ms: one is made, and it ends on its own deadline.
  const calls: string[] = [];
  await assert.rejects(composeAnalystBlocksWithLlm({
    env: TWO_DEPLOYMENTS,
    context: { userIntent: "Analyze AAPL", bundleId: "single_subject_analysis" },
    blocks: [richTextBlock("Deterministic note")],
    toolCalls: ON_FILE,
    deadlines: { attemptMs: 60, totalMs: 100 },
    createClient: () => (deployment) => {
      calls.push(deployment.model);
      return hang(t);
    },
  }), (error) => error instanceof LlmRouterError && error.attempts.length === 1 && error.attempts[0]!.code === "timeout");
  assert.deepEqual(calls, ["gpt-4.1"]);
});

test("deadlines that leave no room for a whole attempt are rejected before any model call", async () => {
  let called = 0;
  for (const deadlines of [{ attemptMs: 100, totalMs: 100 }, { attemptMs: 200, totalMs: 100 }, { attemptMs: 0, totalMs: 100 }]) {
    await assert.rejects(composeAnalystBlocksWithLlm({
      env: TWO_DEPLOYMENTS,
      context: { userIntent: "Analyze AAPL", bundleId: "single_subject_analysis" },
      blocks: [richTextBlock("Deterministic note")],
      toolCalls: ON_FILE,
      deadlines,
      createClient: () => () => {
        called += 1;
        return { text: "unexpected" };
      },
    }), RangeError, JSON.stringify(deadlines));
  }
  assert.equal(called, 0);
});

test("an exact fit leaves the last attempt out, so the total never cuts one", async (t) => {
  // 2 × 60 ms equals the 120 ms total: the second attempt would race the total, so one is made.
  const calls: string[] = [];
  await assert.rejects(composeAnalystBlocksWithLlm({
    env: TWO_DEPLOYMENTS,
    context: { userIntent: "Analyze AAPL", bundleId: "single_subject_analysis" },
    blocks: [richTextBlock("Deterministic note")],
    toolCalls: ON_FILE,
    deadlines: { attemptMs: 60, totalMs: 120 },
    createClient: () => (deployment) => {
      calls.push(deployment.model);
      return hang(t);
    },
  }), (error) => error instanceof LlmRouterError && error.attempts.length === 1);
  assert.deepEqual(calls, ["gpt-4.1"]);
});

test("the last attempt gets only what is left of the total, so it still fails as a router timeout", async (t) => {
  // 2 × 50 ms in 101 ms leaves 1 ms of headroom; routing overhead can use it up, so the
  // second attempt's deadline comes from the remaining budget rather than racing a total timer.
  const startedAt = Date.now();
  await assert.rejects(composeAnalystBlocksWithLlm({
    env: TWO_DEPLOYMENTS,
    context: { userIntent: "Analyze AAPL", bundleId: "single_subject_analysis" },
    blocks: [richTextBlock("Deterministic note")],
    toolCalls: ON_FILE,
    deadlines: { attemptMs: 50, totalMs: 101 },
    createClient: () => () => hang(t),
  }), (error) => error instanceof LlmRouterError && error.attempts.length === 2 && error.attempts.every((a) => a.code === "timeout"));
  assert.ok(Date.now() - startedAt < 1_000, "the chain ends near its total");
});

test("the production deadlines bound the answer and the title calls", () => {
  for (const deadlines of [ANSWER_DEADLINES, TITLE_DEADLINES]) {
    // A primary and its fallback both fit, with headroom, so the total never cuts an attempt.
    assert.ok(deadlines.attemptMs > 0 && 2 * deadlines.attemptMs < deadlines.totalMs);
  }
  assert.ok(ANSWER_DEADLINES.totalMs <= 180_000, "a hung provider costs a user minutes, not the 516 s of #184");
  assert.ok(TITLE_DEADLINES.attemptMs < ANSWER_DEADLINES.attemptMs);
});

async function answerSystemPrompt(): Promise<string> {
  let systemPrompt = "";
  await composeAnalystBlocksWithLlm({
    env: BASE_ENV,
    context: { userIntent: "Analyze NVDA", bundleId: "single_subject_analysis" },
    blocks: [richTextBlock("Deterministic note")],
    toolCalls: ON_FILE,
    createClient: () => async (_deployment, request) => {
      systemPrompt = request.messages[0]?.content ?? "";
      return { text: "answer" };
    },
  });
  return systemPrompt;
}

test("the answer is asked for the assertion list alone (#374)", async () => {
  const systemPrompt = await answerSystemPrompt();
  // The no-keys golden replay matches on the opening sentence.
  assert.match(systemPrompt, /^Write a concise investment research answer/);
  assert.match(systemPrompt, /Reply with only a fenced block that opens with ```assertions on its own line, and nothing before or after it/);
  assert.doesNotMatch(systemPrompt, /\[\[F3\]\]|Unverified hypothesis/);
});

// F1, F5 and F9 are one metric for three companies, as the prompt's order example cites them.
const EXAMPLE_PACKET: EvidencePacket = {
  route: "comparison",
  cutoff: "2026-09-01T00:00:00.000Z",
  companies: ["NVDA", "AMD", "AAPL"],
  figures: [
    { id: "F1", company: "NVDA", metric: "Revenue", period: "FY2026", value: "$130.5B", source_ids: [] },
    { id: "F5", company: "AMD", metric: "Revenue", period: "FY2025", value: "$25.8B", source_ids: [] },
    { id: "F6", company: "AMD", metric: "Net margin", period: "FY2025", value: "6.4%", source_ids: [] },
    { id: "F9", company: "AAPL", metric: "Revenue", period: "FY2025", value: "$416.2B", source_ids: [] },
  ],
  coverage: [],
  gaps: [],
  query_bounds: {},
  claims: [{ id: "C1", text: "AMD management disclosed a one-time charge.", predicate: "management.explanation.net_income", stance: "challenging", company: "AMD", claim_id: "c1", source_id: "s1" }],
  disagreements: [],
  claims_status: "available",
  claims_truncated: false,
};

test("the prompt's worked examples pass the checks they teach (#374)", async () => {
  const systemPrompt = await answerSystemPrompt();
  const example = (kind: string) => JSON.parse(new RegExp(`\\((\\{"kind":"${kind}".*?\\})\\)`).exec(systemPrompt)![1]!);
  const order = example("comparison");
  const inference = example("analyst_inference");
  const report = checkAssertions([
    order,
    { kind: "observation", text: "AMD's revenue was [[F5]].", evidence: ["F5"] },
    { kind: "observation", text: "AMD's net margin was [[F6]].", evidence: ["F6"] },
    { kind: "management_attribution", text: "Management disclosed a one-time charge.", evidence: ["C1"] },
    inference,
  ], EXAMPLE_PACKET);
  assert.deepEqual(report.rejected, []);
  assert.deepEqual(report.accepted.map((entry) => entry.kind), ["comparison", "observation", "observation", "management_attribution", "analyst_inference"]);
  assert.deepEqual(report.accepted[4]!.supports, [2, 3]);
});

test("composeAnalystBlocksWithLlm falls back through shared router deployments", async () => {
  const calls: string[] = [];
  const read: string[] = [];
  await composeAnalystBlocksWithLlm({
    env: {
      LLM_CHANNELS: "openai,deepseek",
      LLM_OPENAI_PROTOCOL: "openai",
      LLM_OPENAI_MODELS: "gpt-4.1",
      LLM_DEEPSEEK_BASE_URL: "https://api.deepseek.com/v1",
      LLM_DEEPSEEK_MODELS: "deepseek-chat",
      LITELLM_MODEL: "openai/gpt-4.1",
      LITELLM_FALLBACK_MODELS: "deepseek/deepseek-chat",
    },
    context: { userIntent: "Analyze AAPL", bundleId: "single_subject_analysis" },
    blocks: [richTextBlock("Deterministic note")],
    toolCalls: ON_FILE,
    createClient: () => async (deployment) => {
      calls.push(`${deployment.channel}/${deployment.model}`);
      if (calls.length === 1) throw new LlmProviderError("provider_failed", "primary down");
      return { text: "fallback note" };
    },
    onModelExchange: (exchange) => read.push(`${exchange.deployment}: ${exchange.text}`),
  });

  assert.deepEqual(calls, ["openai/gpt-4.1", "deepseek/deepseek-chat"]);
  assert.deepEqual(read, ["deepseek/deepseek-chat: fallback note"]);
});

test("createLlmThreadTitleModel reloads LLM_SETTINGS_ENV_FILE between calls", async () => {
  const dir = await mkdtemp(join(tmpdir(), "chat-llm-env-"));
  const envFile = join(dir, ".env.dev");
  await writeFile(envFile, [
    "LLM_CHANNELS=openai",
    "LLM_OPENAI_PROTOCOL=openai",
    "LLM_OPENAI_MODELS=gpt-4.1",
    "LITELLM_MODEL=openai/gpt-4.1",
    "",
  ].join("\n"));
  const seen: string[] = [];
  const model = createLlmThreadTitleModel({
    env: { LLM_SETTINGS_ENV_FILE: envFile },
    createClient: () => async (deployment) => {
      seen.push(`${deployment.channel}/${deployment.model}`);
      return { text: deployment.model };
    },
  });

  assert.equal(await model({ assistantText: "First answer" }), "gpt-4.1");
  await writeFile(envFile, [
    "LLM_CHANNELS=openai",
    "LLM_OPENAI_PROTOCOL=openai",
    "LLM_OPENAI_MODELS=o3",
    "LITELLM_MODEL=openai/o3",
    "",
  ].join("\n"));
  assert.equal(await model({ assistantText: "Second answer" }), "o3");
  assert.deepEqual(seen, ["openai/gpt-4.1", "openai/o3"]);
});

function richTextBlock(text: string): Record<string, unknown> {
  return {
    id: "block-1",
    kind: "rich_text",
    title: "Research note",
    segments: [{ type: "text", text }],
  };
}

const NARRATIVE_BLOCK = {
  id: "narrative-1",
  kind: "rich_text",
  segments: [{ type: "text", text: "placeholder" }],
};
// The analyst's only figures: a comparison's year-to-date price chart (#398 D2).
const PERF_BLOCKS = [{
  id: "perf-1",
  kind: "perf_comparison",
  title: "Price return YTD 2026 (split-adjusted, excluding dividends)",
  default_range: "YTD 2026: 2025-12-31 close to 2026-08-31 close",
  subject_labels: ["NVDA", "AMD"],
  source_refs: ["s-px"],
  series: [
    { name: "NVDA", points: [{ x: "2025-12-31", y: 0 }, { x: "2026-08-31", y: 5.81 }] },
    { name: "AMD", points: [{ x: "2025-12-31", y: 0 }, { x: "2026-08-31", y: 3.17 }] },
  ],
}];

test("the model is told which figures it may cite, by id and value: its price chart's returns", async () => {
  let prompt = "";
  await composeAnalystBlocksWithLlm({
    env: BASE_ENV,
    context: { userIntent: "Compare NVDA with AMD YTD", bundleId: "peer_comparison" },
    blocks: [NARRATIVE_BLOCK],
    toolCalls: [],
    factBlocks: PERF_BLOCKS,
    createClient: () => async (_deployment, request) => {
      prompt = request.messages.map((message) => message.content).join("\n");
      return { text: "NVDA returned [[F1]] this year." };
    },
  });
  assert.match(prompt, /evidence_packet/);
  assert.match(prompt, /"id":"F1"[^}]*"value":"5\.81%"/);
  assert.match(prompt, /"id":"F2"[^}]*"value":"3\.17%"/);
});

async function composeWith(result: { text: string; truncated?: boolean }, factBlocks?: ReadonlyArray<Record<string, unknown>>) {
  let reasoning: string | undefined;
  const blocks = await composeAnalystBlocksWithLlm({
    env: BASE_ENV,
    context: { userIntent: "What changed in NVDA's gross margin?", bundleId: "single_subject_analysis" },
    blocks: [NARRATIVE_BLOCK],
    toolCalls: [],
    ...(factBlocks ? { factBlocks } : {}),
    createClient: () => async (_deployment, request) => {
      reasoning = request.reasoning;
      return result;
    },
  });
  return { text: (blocks[0].segments as Array<{ text: string }>)[0].text, reasoning };
}

test("an answer cut off at the token limit is never shown; the fallback sentence is", async () => {
  // The #124 baseline showed "...The displayed figures do not include a Q".
  const { text, reasoning } = await composeWith({ text: "Gross margin fell. The displayed figures do not include a Q", truncated: true }, PERF_BLOCKS);
  assert.equal(text, NO_ANSWER);
  assert.equal(reasoning, "low", "the answer asks for low reasoning effort");
});

test("an empty answer replaces the placeholder line instead of leaving it on screen", async () => {
  assert.equal((await composeWith({ text: "  " }, PERF_BLOCKS)).text, NO_ANSWER);
  assert.equal((await composeWith({ text: "  " })).text, "No research claims are on file for this question.");
});

test("a thread title cut off at the token limit falls back instead of being saved", async () => {
  const model = createLlmThreadTitleModel({
    env: BASE_ENV,
    createClient: () => async () => ({ text: "Apple Margin Wa", truncated: true }),
  });
  await assert.rejects(async () => model({ userIntent: "Why did Apple sell off?", assistantText: "Margins compressed." }), /cut off/);
});

async function compareWithReply(reply: string) {
  let prompt = "";
  await composeAnalystBlocksWithLlm({
    env: BASE_ENV,
    context: { userIntent: "Compare NVDA with AMD", bundleId: "peer_comparison" },
    blocks: [NARRATIVE_BLOCK],
    toolCalls: [],
    factBlocks: PERF_BLOCKS,
    createClient: () => async (_deployment, request) => {
      prompt = request.messages.map((message) => message.content).join("\n");
      return { text: reply };
    },
  });
  return { prompt };
}

test("the composer reports the deployment that wrote the answer (#183)", async () => {
  const answered: string[] = [];
  await composeAnalystBlocksWithLlm({
    env: BASE_ENV,
    context: { userIntent: "Compare NVDA with AMD YTD", bundleId: "peer_comparison" },
    blocks: [NARRATIVE_BLOCK],
    toolCalls: [],
    factBlocks: PERF_BLOCKS,
    createClient: () => async () => ({ text: '```assertions\n[{"kind": "observation", "text": "Returns.", "evidence": ["F1", "F2"]}]\n```' }),
    onAnswered: (deployment) => answered.push(deployment),
  });
  assert.deepEqual(answered, ["openai/gpt-4.1"]);
});

test("a fallback sentence shown in place of the answer was written by no model (#183)", async () => {
  const answeredBy = async (reply: { text: string; truncated?: boolean }, factBlocks?: ReadonlyArray<Record<string, unknown>>) => {
    const answered: string[] = [];
    await composeAnalystBlocksWithLlm({
      env: BASE_ENV,
      context: { userIntent: "Compare NVDA with AMD", bundleId: "peer_comparison" },
      blocks: [NARRATIVE_BLOCK],
      toolCalls: [],
      factBlocks,
      createClient: () => async () => reply,
      onAnswered: (deployment) => answered.push(deployment),
    });
    return answered;
  };
  assert.deepEqual(await answeredBy({ text: "" }), [], "empty");
  assert.deepEqual(await answeredBy({ text: "Demand rose and", truncated: true }), [], "cut off");
  assert.deepEqual(await answeredBy({ text: "NVDA returned 99.9%." }, PERF_BLOCKS), [], "no list");
  const both = '```assertions\n[{"kind": "observation", "text": "Returns.", "evidence": ["F1", "F2"]}]\n```';
  assert.deepEqual(await answeredBy({ text: both }, PERF_BLOCKS), ["openai/gpt-4.1"], "rendered");
});

test("the answer model sees a compact context, not raw tool JSON (#181)", async () => {
  let prompt = "";
  const usage: unknown[] = [];
  const toolCall = {
    tool_call_id: "tc-1",
    tool_name: "research_lookup",
    bundle_id: "peer_comparison",
    status: "ok",
    arguments: { query: "Compare NVDA with AMD" },
    result: {
      evidence_status: "available",
      manifest_contribution: { subject_refs: [], claim_refs: ["c1"] },
      structured_context: {
        quote: { ticker: "NVDA", price: 178.4, as_of: "2026-09-01T00:00:00.000Z", stale: true, provider: "polygon", source_id: "s" },
        facts: Array.from({ length: 24 }, (_, i) => ({ fact_id: `f${i}`, metric_key: "revenue", value_num: i })),
        fact_recency: { latest_as_of: "2026-08-01T00:00:00.000Z", age_days: 31, stale: false },
      },
      evidence: {
        claims: [{ claim_id: "c1", source_id: "s-claim", text_canonical: "NVIDIA guided data-center revenue higher.", predicate: "guidance.change", polarity: "positive", effective_time: "2025-11-19T00:00:00.000Z", published_at: "2025-11-20T00:00:00.000Z" }],
        truncated: true,
      },
    },
  } as never;
  const gap = { kind: "rich_text", segments: [{ type: "text", text: "Year-to-date price performance is not shown: AMD has no prices from before 2026." }] };
  await composeAnalystBlocksWithLlm({
    env: BASE_ENV,
    context: { userIntent: "Compare NVDA with AMD", bundleId: "peer_comparison" },
    blocks: [NARRATIVE_BLOCK],
    toolCalls: [toolCall],
    factBlocks: [...PERF_BLOCKS, gap],
    createClient: () => async (_deployment, request) => {
      prompt = request.messages.at(-1)!.content;
      return { text: "NVDA is larger.", usage: { inputTokens: 900, outputTokens: 120, totalTokens: 1020, reasoningTokens: 80 } };
    },
    onUsage: (reported) => usage.push(reported),
  });
  const context = JSON.parse(prompt) as Record<string, unknown>;
  assert.deepEqual(Object.keys(context).sort(), ["conversation", "evidence_packet", "question"].sort());
  const packet = context.evidence_packet as Record<string, unknown>;
  // The figures carry short packet ids; the series behind them stay server-side (#207).
  assert.deepEqual((packet.figures as Array<{ id: string }>).map((figure) => figure.id), ["F1", "F2"]);
  // Each claim keeps its dates, so a past claim is not read as current, and a
  // short id: its claim and source ids stay server-side (#207).
  assert.deepEqual(packet.claims, [{
    id: "C1",
    text: "NVIDIA guided data-center revenue higher.",
    predicate: "guidance.change",
    stance: "supporting",
    effective_time: "2025-11-19T00:00:00.000Z",
    published_at: "2025-11-20T00:00:00.000Z",
  }]);
  assert.equal(packet.claims_truncated, true);
  assert.deepEqual(packet.gaps, ["Year-to-date price performance is not shown: AMD has no prices from before 2026."]);
  assert.equal(packet.staleness, undefined, "the analyst shows no quote or fact, so their staleness is not its evidence");
  // None of the raw tool JSON: no facts, prices, ids, or the placeholder block.
  for (const absent of ["fact_id", "178.4", "manifest_contribution", "tool_calls", "existing_blocks", "bundle_id"]) {
    assert.ok(!prompt.includes(absent), absent);
  }
  assert.deepEqual(usage, [{ input_tokens: 900, output_tokens: 120, reasoning_tokens: 80 }]);
});

test("the model sees each comparison figure with the company and metric it belongs to", async () => {
  const { prompt } = await compareWithReply("NVDA leads.");
  const figure = { id: "F2", company: "AMD", metric: "Price return", period: PERF_BLOCKS[0]!.default_range, value: "3.17%", shown_in: PERF_BLOCKS[0]!.title };
  assert.ok(prompt.includes(JSON.stringify(figure)), prompt);
});

// A provider that accepts the request and never answers. Its open connection keeps
// the event loop alive; a bare pending promise doesn't (AbortSignal.timeout's timer is
// unref'd), so the interval stands in for it.
function hang(t: { after(fn: () => void): void }): Promise<never> {
  const connection = setInterval(() => {}, 1_000);
  t.after(() => clearInterval(connection));
  return new Promise<never>(() => {});
}

test("an answer whose every sentence goes beside a gap note falls back without pointing to figures (#263)", async () => {
  const gap = { kind: "rich_text", segments: [{ type: "text", text: "Free cash flow is not available for AMD in this data." }] };
  const blocks = await composeAnalystBlocksWithLlm({
    env: BASE_ENV,
    context: { userIntent: "What is AMD's free cash flow?", bundleId: "single_subject_analysis" },
    blocks: [NARRATIVE_BLOCK],
    toolCalls: ON_FILE,
    factBlocks: [gap],
    createClient: () => async () => ({ text: "It fell due to heavy spending." }),
  });
  assert.equal((blocks[0].segments as Array<{ text: string }>)[0].text, "No written answer is available for this question; try asking again.");
});

test("an analyst packet with no figure and no claim calls no model, and says what is missing, never to ask again (#498, #398)", async () => {
  const shown = async (unavailable: boolean, scope = resolveResearchScope({ companies: AMD, prior: null, asOf: GAP_AS_OF, proposal: proposal({ asks: ["guidance"] }) })) => {
    let calls = 0;
    const toolCall = { tool_call_id: "tc-1", tool_name: "research_lookup", status: "ok", result: { evidence: { claims: [], ...(unavailable ? { unavailable } : {}) } } } as never;
    const blocks = await composeAnalystBlocksWithLlm({
      env: BASE_ENV,
      context: { userIntent: "What guidance did AMD give?", bundleId: "single_name" },
      blocks: [NARRATIVE_BLOCK],
      toolCalls: [toolCall],
      factBlocks: [],
      scope,
      createClient: () => async () => {
        calls += 1;
        return { text: "AMD is a strong buy." };
      },
    });
    return [calls, (blocks[0].segments as Array<{ text: string }>)[0].text];
  };
  assert.deepEqual(await shown(false), [0, "No research claims are on file for AMD."]);
  assert.deepEqual(await shown(true), [0, "Research claims could not be read for AMD, and no figure is shown."]);
});

test("a year-to-date window over one company is a gap note: only a comparison is charted (#398)", () => {
  const scope = resolveResearchScope({ companies: AMD, prior: null, asOf: GAP_AS_OF, proposal: proposal({ asks: ["price_window"] }) });
  assert.deepEqual(gapTurn(scope).factBlocks.map((block) => (block.segments as Array<{ text: string }>)[0]!.text), [
    "A year-to-date price return is charted only to compare two or more companies, so none is shown for AMD.",
  ]);
});

test("with no figure and no claim there is nothing to bind or write from: no model is asked (#208, #398)", async () => {
  const reports: Array<{ status: string }> = [];
  let calls = 0;
  const composed = await composeAnalystBlocksWithLlm({
    env: BASE_ENV,
    context: { userIntent: "Analyze ACME", bundleId: "single_name" },
    blocks: [NARRATIVE_BLOCK],
    toolCalls: [],
    factBlocks: [],
    createClient: () => async () => {
      calls += 1;
      return { text: "```assertions\n[{\"kind\":\"observation\",\"text\":\"ACME trades at $12.\",\"evidence\":[]}]\n```" };
    },
    onAssertions: (report) => reports.push(report),
  });
  assert.equal((composed[0].segments as Array<{ text: string }>)[0].text, "No research claims are on file for this question.");
  assert.deepEqual([calls, reports.map((report) => report.status)], [0, ["skipped"]]);
});

test("an answer cut off inside its assertion list shows the fallback: the list does not parse (#208)", async () => {
  const reports: Array<{ status: string }> = [];
  const composed = await composeAnalystBlocksWithLlm({
    env: BASE_ENV,
    context: { userIntent: "Compare NVDA with AMD", bundleId: "peer_comparison" },
    blocks: [NARRATIVE_BLOCK],
    toolCalls: [],
    factBlocks: PERF_BLOCKS,
    createClient: () => async () => ({ text: "NVDA is larger.\n\n```assertions\n[{\"kind\":\"obs", truncated: true }),
    onAssertions: (report) => reports.push(report),
  });
  assert.equal((composed[0].segments as Array<{ text: string }>)[0].text, NO_ANSWER);
  assert.deepEqual(reports.map((report) => report.status), ["malformed"]);
});

const FACT = (n: number) => `f2080000-0000-4000-8000-00000000000${n}`;
const RENDER_BLOCKS = [{
  id: "comparison-1",
  kind: "metrics_comparison",
  title: "Side by side (latest fiscal year)",
  subjects: [{ kind: "issuer", id: "issuer-nvda" }, { kind: "issuer", id: "issuer-amd" }],
  subject_labels: ["NVDA", "AMD"],
  metrics: ["Revenue", "Gross Margin"],
  source_refs: ["s-nvda", "s-amd"],
  cells: [
    [{ value_ref: FACT(1), format: "$130.5B" }, { value_ref: FACT(2), format: "74.6%" }],
    [{ value_ref: FACT(3), format: "$25.8B" }, { value_ref: FACT(4), format: "49.2%" }],
  ],
  data_ref: { kind: "metrics_comparison", id: "comparison-1", params: { fact_bindings: [1, 2, 3, 4].map((n) => ({
    fact_id: FACT(n), unit: n % 2 ? "USD" : "ratio", period_kind: "fiscal_y", fiscal_year: n < 3 ? 2026 : 2025, fiscal_period: "FY",
    period_end: n < 3 ? "2026-01-25" : "2025-12-27", as_of: "2026-02-26T00:00:00.000Z", source_id: n < 3 ? "s-nvda" : "s-amd",
  })) } },
}];
// The composer reads any packet it is given (engine answers', answer-lab
// traces'); these hold reported facts as a recorded turn's packet does, beside
// the turn's own claims, and the blocks whose bindings seal each fact.
function recorded(
  figures: ReadonlyArray<PacketFigure>,
  input: { toolCalls?: ReadonlyArray<never>; factBlocks?: ReadonlyArray<Record<string, unknown>> } = {},
): EvidencePacket {
  const packet = turnPacket({ toolCalls: input.toolCalls ?? [], factBlocks: input.factBlocks ?? [], cutoff: "2026-09-01T00:00:00.000Z" });
  // A single company's figures name no company: they are all its own.
  const shown = (company: string) => figures.some((figure) => figure.company === company) || (packet.companies.length === 1 && figures.length > 0);
  return { ...packet, figures, coverage: packet.companies.map((company) => ({ company, status: shown(company) ? "shown" : "not_shown" })) };
}
const reported = (id: string, company: string | undefined, metric: string, period: string, period_end: string, value: string, fact_id: string): PacketFigure => ({
  id, ...(company ? { company } : {}), metric, period, period_end, value, shown_in: "Side by side (latest fiscal year)", fact_id, source_ids: ["s-nvda", "s-amd"],
});
const RENDER_FIGURES = [
  reported("F1", "NVDA", "Revenue", "FY2026", "2026-01-25", "$130.5B", FACT(1)),
  reported("F2", "NVDA", "Gross Margin", "FY2026", "2026-01-25", "74.6%", FACT(2)),
  reported("F3", "AMD", "Revenue", "FY2025", "2025-12-27", "$25.8B", FACT(3)),
  reported("F4", "AMD", "Gross Margin", "FY2025", "2025-12-27", "49.2%", FACT(4)),
];
const RENDER_PACKET = recorded(RENDER_FIGURES, { factBlocks: RENDER_BLOCKS });

async function renderWithReply(reply: string | { text: string; truncated: boolean }, env: Record<string, string> = BASE_ENV) {
  const reports: Array<Record<string, unknown>> = [];
  const blocks = await composeAnalystBlocksWithLlm({
    env,
    context: { userIntent: "Compare NVDA with AMD", bundleId: "peer_comparison" },
    blocks: [NARRATIVE_BLOCK],
    toolCalls: [],
    factBlocks: RENDER_BLOCKS,
    packet: RENDER_PACKET,
    createClient: () => async () => (typeof reply === "string" ? { text: reply } : reply),
    onAssertions: (report) => reports.push(report as unknown as Record<string, unknown>),
  });
  return { block: blocks[0] as Record<string, unknown>, report: reports[0]! };
}
const withList = (list: unknown[]) => `NVDA earns more on each sale than AMD.\n\n\`\`\`assertions\n${JSON.stringify(list)}\n\`\`\``;

// One company, "A", a one-letter ticker that reads as the article, and one
// sourced claim.
const A_CLAIM = "c2080000-0000-4000-8000-000000000021";
const A_BLOCKS = [{ ...RENDER_BLOCKS[0]!, subject_labels: ["A"], cells: [RENDER_BLOCKS[0]!.cells[0]!] }];
const A_TOOL_CALL = {
  tool_call_id: "tc-a",
  tool_name: "research_lookup",
  status: "ok",
  result: { evidence: { claims: [{ claim_id: A_CLAIM, source_id: "s-a", text_canonical: "Management raised its outlook.", predicate: "guidance.change", polarity: "positive", published_at: "2026-02-25T00:00:00.000Z" }] } },
} as never;
const A_FIGURES = RENDER_FIGURES.slice(0, 2).map((figure) => ({ ...figure, company: "A" }));
async function renderA(list: unknown[]) {
  const reports: Array<Record<string, unknown>> = [];
  const composed = await composeAnalystBlocksWithLlm({
    env: BASE_ENV,
    context: { userIntent: "Analyze A", bundleId: "single_name" },
    blocks: [NARRATIVE_BLOCK],
    toolCalls: [A_TOOL_CALL],
    factBlocks: A_BLOCKS,
    packet: recorded(A_FIGURES, { toolCalls: [A_TOOL_CALL], factBlocks: A_BLOCKS }),
    createClient: () => async () => ({ text: withList(list) }),
    onAssertions: (report) => reports.push(report as unknown as Record<string, unknown>),
  });
  const text = (composed[0].segments as Array<{ text?: string; format?: string }>).map((segment) => segment.text ?? segment.format).join("");
  return { text, report: reports[0]! };
}

test("the answer is written from its accepted assertions, values as sealed refs (#208)", async () => {
  const { block, report } = await renderWithReply(withList([
    { kind: "observation", text: "NVDA's gross margin was [[F2]] and AMD's was [[F4]].", evidence: ["F2", "F4"] },
    { kind: "observation", text: "NVDA's revenue was $99B.", evidence: ["F1"] },
    // Two companies in one period show no change.
    { kind: "unknown_cause", text: "The figures do not show why.", evidence: ["F2", "F4"] },
  ]));
  const segments = block.segments as Array<{ type: string; text?: string; format?: string; ref_id?: string }>;
  assert.equal(
    segments.map((segment) => segment.text ?? segment.format).join(""),
    "NVDA's gross margin was 74.6% in FY2026 (ended Jan 2026); AMD's gross margin was 49.2% in FY2025 (ended Dec 2025).\n\nNVDA's revenue was $130.5B in FY2026 (ended Jan 2026).",
  );
  assert.deepEqual(segments.filter((segment) => segment.type === "ref").map((segment) => segment.ref_id), [FACT(2), FACT(4), FACT(1)]);
  assert.deepEqual(
    ((block.data_ref as { params: { fact_bindings: Array<{ fact_id: string }> } }).params.fact_bindings).map((binding) => binding.fact_id),
    [FACT(2), FACT(4), FACT(1)],
  );
  assert.deepEqual(block.source_refs, ["s-nvda", "s-amd"]);
  assert.equal(report.rendered, true);
  assert.deepEqual((report.rejected as Array<{ index: number; reason: string }>).map((entry) => [entry.index, entry.reason]), [
    [2, "an unknown cause cites a change: one company's metric, two periods, two values"],
  ]);
});

test("a data gap the model writes never reaches the answer: what is missing is the packet's to say (#302)", async () => {
  const { block, report } = await renderWithReply(withList([
    { kind: "observation", text: "NVDA's revenue was [[F1]] and AMD's was [[F3]].", evidence: ["F1", "F3"] },
    { kind: "data_gap", text: "No revenue is shown." },
  ]));
  assert.equal(
    (block.segments as Array<{ text?: string; format?: string }>).map((segment) => segment.text ?? segment.format).join(""),
    "NVDA's revenue was $130.5B in FY2026 (ended Jan 2026); AMD's revenue was $25.8B in FY2025 (ended Dec 2025).",
  );
  assert.deepEqual(report.rejected, [{ index: 1, text: "No revenue is shown.", check: "format", reason: "unknown kind \"data_gap\"" }]);
});

const AMD = [{ issuer_id: "60000000-0000-4000-8000-000000000002", label: "AMD" }];
const GAP_AS_OF = "2026-09-01T00:00:00.000Z";

// The blocks and scope local-runtime gives the answer for a scope with nothing shown.
function gapTurn(scope: ReturnType<typeof resolveResearchScope>) {
  return { scope, factBlocks: scopeGapBlocks(scope, { snapshotId: "00000000-0000-4000-8000-0000000000aa", asOf: GAP_AS_OF }) };
}
const BENCHMARK = resolveResearchScope({ companies: AMD, prior: null, asOf: GAP_AS_OF, proposal: proposal({ asks: ["benchmark"] }) });

test("a price return over another window than year to date is a gap note, and no window is charted (#398)", () => {
  const read = proposal({ asks: ["price_history"] });
  const scope = resolveResearchScope({ companies: AMD, prior: null, asOf: GAP_AS_OF, proposal: read });
  assert.deepEqual(
    scopeGapBlocks(scope, { snapshotId: "00000000-0000-4000-8000-0000000000aa", asOf: GAP_AS_OF }, read).map((block) => (block.segments as Array<{ text: string }>)[0]!.text),
    ["Only a year-to-date price return is charted here, not the window this question asks for."],
  );
});

test("a turn with no figure and only gap notes points to its notes, never the model's prose (#302)", async () => {
  const turn = gapTurn(BENCHMARK);
  assert.deepEqual(turn.factBlocks.map((block) => (block.segments as Array<{ text: string }>)[0]!.text), ["A benchmark index is not in this data, so AMD is not compared with one."]);
  const prose = "AMD beat the S&P 500 by 12 points.";
  const shown = async (env: Record<string, string>, reply: string, toolCalls: ReadonlyArray<never> = []) => {
    const answered: string[] = [];
    const composed = await composeAnalystBlocksWithLlm({
      env,
      context: { userIntent: "What is AMD's free cash flow?", bundleId: "single_subject_analysis" },
      blocks: [NARRATIVE_BLOCK],
      toolCalls,
      ...turn,
      createClient: () => async () => ({ text: reply }),
      onAnswered: (deployment) => answered.push(deployment),
    });
    return { segments: composed[0]!.segments, answered };
  };
  const pointer = { segments: [{ type: "text", text: "The data here does not answer this question; the note below says what is missing." }], answered: [] };
  assert.deepEqual(await shown(BASE_ENV, prose), pointer);
  // The data does not hold what was asked whatever the model replied.
  assert.deepEqual(await shown(BASE_ENV, ""), pointer);
  assert.deepEqual(await shown(BASE_ENV, `${prose}\n\n\`\`\`assertions\n${JSON.stringify([{ kind: "data_gap", text: "No benchmark is shown." }])}\n\`\`\``), pointer);
  // A claim the model attributes is an answer, rendered as such.
  assert.deepEqual(
    (await shown(BASE_ENV, withList([{ kind: "management_attribution", text: "Management raised its outlook.", evidence: ["C1"] }]), [A_TOOL_CALL])).segments,
    [
      { type: "text", text: "According to a source dated Feb 2026: " },
      { type: "ref", ref_kind: "claim", ref_id: A_CLAIM, format: "Management raised its outlook." },
      { type: "text", text: "\n\nNo figures are shown for AMD." },
    ],
  );
});

test("a financial-engine answer's evidence follow-up never reads its note as missing data (#358 review)", async () => {
  const served = resolveResearchScope({
    companies: AMD,
    prior: null,
    asOf: GAP_AS_OF,
    served: true,
    proposal: proposal({ asks: ["margins"], metrics: ["income_statement"], items: ["operating_income"] }),
  });
  const turn = gapTurn(resolveResearchScope({ companies: AMD, prior: served, asOf: GAP_AS_OF, proposal: proposal({ asks: ["evidence"] }) }));
  assert.deepEqual(turn.factBlocks.map((block) => (block.segments as Array<{ text: string }>)[0]!.text), [
    "The previous answer's figures were calculated and verified by the financial engine; each one links to its sources in that answer, and no other figure is shown in their place.",
  ]);
  const prose = "The previous answer's operating margin came from the financial engine, and each figure links to its filing.";
  const shown = async (reply: string) => (await composeAnalystBlocksWithLlm({
    env: BASE_ENV,
    context: { userIntent: "Show the evidence", bundleId: "single_subject_analysis" },
    blocks: [NARRATIVE_BLOCK],
    toolCalls: [],
    ...turn,
    createClient: () => async () => ({ text: reply }),
  }))[0]!.segments;
  // No figure and no claim: no model is asked, and the note is no gap, so nothing points to it.
  for (const reply of [prose, ""]) {
    assert.deepEqual(await shown(reply), [{ type: "text", text: "No research claims are on file for AMD." }]);
  }
});

test("with claims on file but none rendered, a named gap's answer points to its note (#358 review)", async () => {
  const turn = gapTurn(BENCHMARK);
  const prose = "Management raised its outlook.";
  const composed = await composeAnalystBlocksWithLlm({
    env: BASE_ENV,
    context: { userIntent: "How does AMD compare with the S&P 500?", bundleId: "single_subject_analysis" },
    blocks: [NARRATIVE_BLOCK],
    toolCalls: [A_TOOL_CALL],
    ...turn,
    createClient: () => async () => ({ text: prose }),
  });
  assert.deepEqual(composed[0]!.segments, [{ type: "text", text: "The data here does not answer this question; the note below says what is missing." }]);
});

test("a named gap's empty list is the gap's answer, logged as the model's choice; with no gap named it is a failure (#374)", async (t) => {
  const turn = gapTurn(BENCHMARK);
  const info = t.mock.method(console, "info", () => {});
  const warn = t.mock.method(console, "warn", () => {});
  const composed = await composeAnalystBlocksWithLlm({
    env: BASE_ENV,
    context: { userIntent: "How does AMD compare with the S&P 500?", bundleId: "single_subject_analysis" },
    blocks: [NARRATIVE_BLOCK],
    toolCalls: [A_TOOL_CALL],
    ...turn,
    createClient: () => async () => ({ text: "```assertions\n[]\n```" }),
  });
  assert.deepEqual(composed[0]!.segments, [{ type: "text", text: "The data here does not answer this question; the note below says what is missing." }]);
  assert.deepEqual(info.mock.calls.map((call) => call.arguments[0]), ["[chat] the assertion list was empty; showing the fallback sentence"]);
  assert.equal(warn.mock.callCount(), 0);

  // With figures on file and no gap named, an empty list answers nothing: a failure.
  info.mock.resetCalls();
  await renderWithReply("```assertions\n[]\n```");
  assert.equal(info.mock.callCount(), 0);
  assert.deepEqual(warn.mock.calls.map((call) => call.arguments[0]), ["[chat] no assertion rendered (list checked); showing the fallback sentence"]);
});

test("when no assertion renders, the answer is the fixed fallback sentence, never the model's prose", async () => {
  const fallback = [{ type: "text", text: NO_ANSWER }];
  const prose = "NVDA earns more on each sale than AMD.";
  for (const reply of [
    prose,
    `${prose}\n\n\`\`\`assertions\n{"kind": "observation"\n\`\`\``,
    withList([{ kind: "observation", text: "NVDA's gross margin was [[F9]].", evidence: ["F9"] }]),
    // Cut off inside the list: what was written of it does not parse.
    { text: `${prose}\n\n\`\`\`assertions\n[{"kind": "observation", "text": "NVDA's gross margin was [[F2]].", "evidence": ["F2"]}, {"kind"`, truncated: true },
  ]) {
    const { block, report } = await renderWithReply(reply);
    assert.deepEqual({ segments: block.segments, rendered: report.rendered }, { segments: fallback, rendered: undefined }, JSON.stringify(reply));
  }
  // An attribution quotes its claim as its source wrote it, a magnitude in words included.
  const reports: AssertionReport[] = [];
  const blocks = await composeAnalystBlocksWithLlm({
    env: BASE_ENV,
    context: { userIntent: "What did management say?", bundleId: "single_name" },
    blocks: [NARRATIVE_BLOCK],
    toolCalls: [{
      tool_call_id: "tc-1",
      tool_name: "research_lookup",
      status: "ok",
      result: { evidence: { claims: [{ claim_id: A_CLAIM, source_id: "s-a", text_canonical: "Data center demand doubled.", predicate: "kpi.commentary", polarity: "positive" }] } },
    } as never],
    factBlocks: [],
    createClient: () => async () => ({ text: withList([{ kind: "management_attribution", text: "Demand doubled.", evidence: ["C1"] }]) }),
    onAssertions: (report) => reports.push(report),
  });
  assert.deepEqual({ segments: blocks[0]!.segments, rejected: reports[0]!.rejected }, {
    segments: [
      { type: "text", text: "According to a source: " },
      { type: "ref", ref_kind: "claim", ref_id: A_CLAIM, format: "Data center demand doubled." },
    ],
    rejected: [],
  });
});

test("an answer is rendered from its list alone: no prose before it, or prose cut off after it, still renders", async () => {
  const list = [{ kind: "observation", text: "NVDA's gross margin was [[F2]] and AMD's was [[F4]].", evidence: ["F2", "F4"] }];
  const rendered = "NVDA's gross margin was 74.6% in FY2026 (ended Jan 2026); AMD's gross margin was 49.2% in FY2025 (ended Dec 2025).";
  for (const reply of [`\`\`\`assertions\n${JSON.stringify(list)}\n\`\`\``, { text: `${withList(list)}\n\nAMD trails on every metr`, truncated: true }]) {
    const { block, report } = await renderWithReply(reply);
    const text = (block.segments as Array<{ text?: string; format?: string }>).map((segment) => segment.text ?? segment.format).join("");
    assert.deepEqual({ text, rendered: report.rendered }, { text: rendered, rendered: true }, JSON.stringify(reply));
  }
});

test("a claim-only answer is rendered too (#208)", async () => {
  const claimId = "c2080000-0000-4000-8000-000000000001";
  const toolCall = {
    tool_call_id: "tc-1",
    tool_name: "research_lookup",
    status: "ok",
    result: { evidence: { claims: [{ claim_id: claimId, source_id: "s-claim", text_canonical: "Management raised its outlook.", predicate: "guidance.change", polarity: "positive", effective_time: "2026-02-25T00:00:00.000Z" }] } },
  } as never;
  const reports: Array<Record<string, unknown>> = [];
  const composed = await composeAnalystBlocksWithLlm({
    env: BASE_ENV,
    context: { userIntent: "What did management say?", bundleId: "single_name" },
    blocks: [NARRATIVE_BLOCK],
    toolCalls: [toolCall],
    factBlocks: [],
    createClient: () => async () => ({ text: withList([{ kind: "management_attribution", text: "Management raised its outlook.", evidence: ["C1"] }]) }),
    onAssertions: (report) => reports.push(report as unknown as Record<string, unknown>),
  });
  const segments = composed[0].segments as Array<{ type: string; ref_id?: string; text?: string; format?: string }>;
  assert.equal(segments.map((segment) => segment.text ?? segment.format).join(""), "According to a source, effective Feb 2026: Management raised its outlook.");
  assert.equal(segments.at(-1)?.ref_id, claimId);
  assert.equal(reports[0]?.rendered, true);

  const { text } = await renderA([
    { kind: "management_attribution", text: "Management raised its outlook.", evidence: ["C1"] },
    { kind: "observation", text: "A's gross margin was [[F2]].", evidence: ["F2"] },
  ]);
  // A one-letter ticker's observation renders as any other's: its value is the packet's.
  assert.equal(text, "According to a source dated Feb 2026: Management raised its outlook.\n\nA's gross margin was 74.6% in FY2026 (ended Jan 2026).");
});

test("an inference resting on a management attribution renders (#302)", async () => {
  const { text, report } = await renderA([
    { kind: "management_attribution", text: "Management raised its outlook.", evidence: ["C1"] },
    { kind: "observation", text: "A's gross margin was [[F2]].", evidence: ["F2"] },
    { kind: "analyst_inference", text: "The raised outlook signals confidence in demand.", evidence: [], supports: [0] },
    { kind: "analyst_inference", text: "The margin and the outlook point the same way.", evidence: [], supports: [0, 1] },
  ]);
  assert.equal(text, "According to a source dated Feb 2026: Management raised its outlook." +
    "\n\nA's gross margin was 74.6% in FY2026 (ended Jan 2026)." +
    "\n\n> **Analyst inference:** The raised outlook signals confidence in demand." +
    "\n\n> **Analyst inference:** The margin and the outlook point the same way.");
  assert.deepEqual(report.rejected, []);
});

test("a sourced causal claim renders with no figures shown (#208)", async () => {
  const claimId = "c2080000-0000-4000-8000-000000000002";
  const causal = {
    tool_call_id: "tc-2",
    tool_name: "research_lookup",
    status: "ok",
    result: { evidence: { claims: [{ claim_id: claimId, source_id: "s", text_canonical: "Margins rose due to a richer mix.", predicate: "kpi.commentary", polarity: "positive", published_at: "2026-02-25T00:00:00.000Z" }] } },
  } as never;
  const claimAnswer = await composeAnalystBlocksWithLlm({
    env: BASE_ENV,
    context: { userIntent: "Why did margins rise?", bundleId: "single_name" },
    blocks: [NARRATIVE_BLOCK],
    toolCalls: [causal],
    factBlocks: [],
    createClient: () => async () => ({ text: withList([{ kind: "management_attribution", text: "Margins rose due to a richer mix.", evidence: ["C1"] }]) }),
  });
  const claimText = (claimAnswer[0].segments as Array<{ text?: string; format?: string }>).map((segment) => segment.text ?? segment.format).join("");
  assert.equal(claimText, "According to a source dated Feb 2026: Margins rose due to a richer mix.");
});

test("a rendered inference is words only: one with a figure, typed or referenced, is never rendered (#301)", async () => {
  const { block, report } = await renderWithReply(withList([
    { kind: "observation", text: "NVDA's gross margin was [[F2]] and AMD's was [[F4]].", evidence: ["F2", "F4"] },
    // A reference to AMD's figure in a sentence about NVDA would render AMD's value as NVDA's.
    { kind: "analyst_inference", text: "NVDA's [[F4]] margin outruns AMD's.", evidence: [], supports: [0] },
    { kind: "analyst_inference", text: "The leader appears to hold pricing power.", evidence: [], supports: [0] },
    { kind: "analyst_inference", text: "NVDA's 74.6% margin is a durable edge.", evidence: [], supports: [0] },
  ]));
  const segments = block.segments as Array<{ type: string; text?: string; format?: string; ref_id?: string }>;
  assert.equal(
    segments.map((segment) => segment.text ?? segment.format).join(""),
    "NVDA's gross margin was 74.6% in FY2026 (ended Jan 2026); AMD's gross margin was 49.2% in FY2025 (ended Dec 2025)." +
      "\n\n> **Analyst inference:** The leader appears to hold pricing power.",
  );
  // Every figure shown is the observation's, each from its own company's packet entry.
  assert.deepEqual(segments.filter((segment) => segment.type === "ref").map((segment) => segment.ref_id), [FACT(2), FACT(4)]);
  assert.deepEqual((report.rejected as Array<{ index: number; reason: string }>).map((entry) => [entry.index, entry.reason]), [
    [1, "an inference rests on its supports; it writes no figure"],
    [3, "an inference rests on its supports; it writes no figure"],
  ]);
});

const NVDA_ONLY = recorded(RENDER_FIGURES.slice(0, 2), { factBlocks: RENDER_BLOCKS });

test("a rendered answer says which compared companies it shows no figures for (#208)", async () => {
  const composed = await composeAnalystBlocksWithLlm({
    env: BASE_ENV,
    context: { userIntent: "Compare NVDA with AMD", bundleId: "peer_comparison" },
    blocks: [NARRATIVE_BLOCK],
    toolCalls: [],
    factBlocks: RENDER_BLOCKS,
    packet: NVDA_ONLY,
    createClient: () => async () => ({ text: withList([{ kind: "observation", text: "NVDA's gross margin was [[F2]].", evidence: ["F2"] }]) }),
  });
  const text = (composed[0].segments as Array<{ text?: string; format?: string }>).map((segment) => segment.text ?? segment.format).join("");
  assert.equal(text, "NVDA's gross margin was 74.6% in FY2026 (ended Jan 2026).\n\nNo figures are shown for AMD.");
});

test("a cited claim about a compared company does not drop the note that no figures are shown for it (#302 review)", async () => {
  const amdClaim = {
    tool_call_id: "tc-amd",
    tool_name: "research_lookup",
    status: "ok",
    result: { evidence: { claims: [{ claim_id: "c3020000-0000-4000-8000-000000000002", source_id: "s-amd-claim", text_canonical: "AMD expects data center growth.", predicate: "guidance.change", polarity: "positive", published_at: "2026-02-25T00:00:00.000Z", subject_id: "issuer-amd" }] } },
  } as never;
  const composed = await composeAnalystBlocksWithLlm({
    env: BASE_ENV,
    context: { userIntent: "Compare NVDA with AMD", bundleId: "peer_comparison" },
    blocks: [NARRATIVE_BLOCK],
    toolCalls: [amdClaim],
    factBlocks: RENDER_BLOCKS,
    packet: recorded(RENDER_FIGURES.slice(0, 2), { toolCalls: [amdClaim], factBlocks: RENDER_BLOCKS }),
    createClient: () => async () => ({ text: withList([
      { kind: "observation", text: "NVDA's gross margin was [[F2]].", evidence: ["F2"] },
      { kind: "management_attribution", text: "AMD expects data center growth.", evidence: ["C1"] },
    ]) }),
  });
  const text = (composed[0].segments as Array<{ text?: string; format?: string }>).map((segment) => segment.text ?? segment.format).join("");
  assert.equal(text, "NVDA's gross margin was 74.6% in FY2026 (ended Jan 2026).\n\nAccording to a source dated Feb 2026 on AMD: AMD expects data center growth.\n\nNo figures are shown for AMD.");
});

test("a rendered answer keeps the other side of a stored disagreement (#208)", async () => {
  const claim = (n: number, text: string, polarity: string) => ({
    claim_id: `c2080000-0000-4000-8000-00000000001${n}`, source_id: `s${n}`, text_canonical: text, predicate: "kpi.commentary", polarity, published_at: "2026-02-25T00:00:00.000Z",
  });
  const toolCall = {
    tool_call_id: "tc-1",
    tool_name: "research_lookup",
    status: "ok",
    result: { evidence: {
      claims: [claim(1, "Backlog grew.", "positive"), claim(2, "Backlog shrank.", "negative")],
      contradictions: [["c2080000-0000-4000-8000-000000000011", "c2080000-0000-4000-8000-000000000012"]],
    } },
  } as never;
  const composed = await composeAnalystBlocksWithLlm({
    env: BASE_ENV,
    context: { userIntent: "What happened to backlog?", bundleId: "single_name" },
    blocks: [NARRATIVE_BLOCK],
    toolCalls: [toolCall],
    factBlocks: [],
    createClient: () => async () => ({ text: withList([{ kind: "management_attribution", text: "Backlog grew.", evidence: ["C1"] }]) }),
  });
  const segments = composed[0].segments as Array<{ type: string; text?: string; format?: string; ref_id?: string }>;
  assert.equal(
    segments.map((segment) => segment.text ?? segment.format).join(""),
    "According to a source dated Feb 2026: Backlog grew.\n\nA source disagrees. According to a source dated Feb 2026: Backlog shrank.",
  );
  assert.deepEqual(segments.filter((segment) => segment.type === "ref").map((segment) => segment.ref_id), [
    "c2080000-0000-4000-8000-000000000011", "c2080000-0000-4000-8000-000000000012",
  ]);
});

test("a rendered comparison covers every company it shows figures for, and warns of calendars across observations (#208)", async () => {
  const leftOut = "left out: the answer would show only some of the companies shown";
  const nvdaMargin = { index: 0, text: "NVDA's gross margin was 74.6% in FY2026 (ended Jan 2026).", check: "rendering", reason: leftOut };
  // An answer about one of the two companies shown falls back, and the report says why.
  const oneSided = await renderWithReply(withList([{ kind: "observation", text: "NVDA's gross margin was [[F2]].", evidence: ["F2"] }]));
  assert.deepEqual(
    { segments: oneSided.block.segments, rendered: oneSided.report.rendered, accepted: oneSided.report.accepted, rejected: oneSided.report.rejected },
    { segments: [{ type: "text", text: NO_ANSWER }], rendered: undefined, accepted: [], rejected: [nvdaMargin] },
  );
  // An inference shows no figure, so its evidence covers no company: AMD still has none on the page.
  const inferred = await renderWithReply(withList([
    { kind: "observation", text: "NVDA's gross margin was [[F2]].", evidence: ["F2"] },
    { kind: "analyst_inference", text: "It keeps more of each sale.", subject: "NVDA", evidence: ["F4"], supports: [0] },
  ]));
  assert.deepEqual(
    { segments: inferred.block.segments, rendered: inferred.report.rendered, rejected: inferred.report.rejected },
    {
      segments: [{ type: "text", text: NO_ANSWER }],
      rendered: undefined,
      rejected: [nvdaMargin, { index: 1, text: "> **Analyst inference on NVDA:** It keeps more of each sale.", check: "rendering", reason: leftOut }],
    },
  );
  // A claim on AMD covers AMD's side, whatever its words.
  const reports: AssertionReport[] = [];
  const amdDemand = {
    tool_call_id: "tc-1",
    tool_name: "research_lookup",
    status: "ok",
    result: { evidence: { claims: [{ claim_id: A_CLAIM, source_id: "s-a", text_canonical: "Data center demand doubled.", predicate: "kpi.commentary", polarity: "positive", subject_id: "issuer-amd" }] } },
  } as never;
  const claimedSide = await composeAnalystBlocksWithLlm({
    env: BASE_ENV,
    context: { userIntent: "Compare NVDA with AMD", bundleId: "peer_comparison" },
    blocks: [NARRATIVE_BLOCK],
    toolCalls: [amdDemand],
    factBlocks: RENDER_BLOCKS,
    packet: recorded(RENDER_FIGURES, { toolCalls: [amdDemand], factBlocks: RENDER_BLOCKS }),
    createClient: () => async () => ({ text: withList([
      { kind: "observation", text: "NVDA's gross margin was [[F2]].", evidence: ["F2"] },
      { kind: "management_attribution", text: "Demand doubled.", evidence: ["C1"] },
    ]) }),
    onAssertions: (report) => reports.push(report),
  });
  assert.deepEqual({ text: (claimedSide[0]!.segments as Array<{ text?: string; format?: string }>).map((segment) => segment.text ?? segment.format).join(""), rejected: reports[0]!.rejected }, {
    text: "NVDA's gross margin was 74.6% in FY2026 (ended Jan 2026).\n\nAccording to a source on AMD: Data center demand doubled.",
    rejected: [],
  });

  const sameYear = RENDER_FIGURES.map((figure) => ({ ...figure, period: "FY2026" }));
  const composed = await composeAnalystBlocksWithLlm({
    env: BASE_ENV,
    context: { userIntent: "Compare NVDA with AMD", bundleId: "peer_comparison" },
    blocks: [NARRATIVE_BLOCK],
    toolCalls: [],
    factBlocks: RENDER_BLOCKS,
    packet: recorded(sameYear, { factBlocks: RENDER_BLOCKS }),
    createClient: () => async () => ({ text: withList([
      { kind: "observation", text: "NVDA's gross margin was [[F2]].", evidence: ["F2"] },
      { kind: "observation", text: "AMD's gross margin was [[F4]].", evidence: ["F4"] },
    ]) }),
  });
  const text = (composed[0].segments as Array<{ text?: string; format?: string }>).map((segment) => segment.text ?? segment.format).join("");
  assert.match(text, /\n\nThe periods compared end at different times, so they do not line up: NVDA's FY2026 ended Jan 2026 and AMD's FY2026 ended Dec 2025\.$/);
});

test("a rendered answer says when more claims matched, or none could be read (#208)", async () => {
  const truncated = { ...(A_TOOL_CALL as unknown as Record<string, unknown>) };
  truncated.result = { evidence: { ...((A_TOOL_CALL as unknown as { result: { evidence: Record<string, unknown> } }).result.evidence), truncated: true } };
  const composed = await composeAnalystBlocksWithLlm({
    env: BASE_ENV,
    context: { userIntent: "Analyze A", bundleId: "single_name" },
    blocks: [NARRATIVE_BLOCK],
    toolCalls: [truncated as never],
    factBlocks: A_BLOCKS,
    packet: recorded(A_FIGURES, { toolCalls: [truncated as never], factBlocks: A_BLOCKS }),
    createClient: () => async () => ({ text: withList([{ kind: "management_attribution", text: "Management raised its outlook.", evidence: ["C1"] }]) }),
  });
  const text = (composed[0].segments as Array<{ text?: string; format?: string }>).map((segment) => segment.text ?? segment.format).join("");
  assert.equal(text, "According to a source dated Feb 2026: Management raised its outlook.\n\nMore sources matched than are shown here.");

  const unreadable = { tool_call_id: "tc-u", tool_name: "research_lookup", status: "ok", result: { evidence: { claims: [], unavailable: true } } } as never;
  const answer = await composeAnalystBlocksWithLlm({
    env: BASE_ENV,
    context: { userIntent: "Compare NVDA with AMD", bundleId: "peer_comparison" },
    blocks: [NARRATIVE_BLOCK],
    toolCalls: [unreadable],
    factBlocks: RENDER_BLOCKS,
    packet: recorded(RENDER_FIGURES, { toolCalls: [unreadable], factBlocks: RENDER_BLOCKS }),
    createClient: () => async () => ({ text: withList([{ kind: "observation", text: "NVDA's gross margin was [[F2]] and AMD's was [[F4]].", evidence: ["F2", "F4"] }]) }),
  });
  assert.match((answer[0].segments as Array<{ text?: string; format?: string }>).map((segment) => segment.text ?? segment.format).join(""), /\n\nResearch claims could not be read for this answer\.$/);
});

test("an observation whose value cannot be sealed renders the packet's value as plain text (#301)", async () => {
  // A price return is read off its chart series, with no fact behind it.
  const perf = [{ id: "perf-1", kind: "perf_comparison", title: "Price performance", default_range: "YTD 2026: 2025-12-31 close to 2026-08-31 close",
    series: [{ name: "NVDA", points: [{ x: "2025-12-31", y: 0 }, { x: "2026-08-31", y: 12.5 }] }] }];
  const reports: Array<Record<string, unknown>> = [];
  const composed = await composeAnalystBlocksWithLlm({
    env: BASE_ENV,
    context: { userIntent: "How has NVDA done YTD?", bundleId: "single_name" },
    blocks: [NARRATIVE_BLOCK],
    toolCalls: [],
    factBlocks: perf,
    createClient: () => async () => ({ text: `NVDA returned [[F1]] this year.\n\n\`\`\`assertions\n${JSON.stringify([
      { kind: "observation", text: "NVDA returned [[F1]].", evidence: ["F1"] },
      { kind: "analyst_inference", text: "Momentum is with NVDA.", evidence: [], supports: [0] },
    ])}\n\`\`\`` }),
    onAssertions: (report) => reports.push(report as unknown as Record<string, unknown>),
  });
  const segments = composed[0].segments as Array<{ type: string; text?: string }>;
  assert.equal(segments.every((segment) => segment.type === "text"), true);
  assert.equal(segments.map((segment) => segment.text).join(""),
    "NVDA's price return was 12.5% in YTD 2026: Dec 2025 close to Aug 2026 close.\n\n> **Analyst inference:** Momentum is with NVDA.");
  assert.equal(reports[0]!.rendered, true);
  assert.deepEqual(reports[0]!.rejected, []);
});

test("a ranking of price returns read off their chart renders (#301)", async () => {
  const perf = { id: "perf-1", kind: "perf_comparison", title: "Price performance", default_range: "YTD 2026: 2025-12-31 close to 2026-08-31 close", series: [
    { name: "NVDA", points: [{ x: "2025-12-31", y: 0 }, { x: "2026-08-31", y: 5.81 }] }, { name: "AMD", points: [{ x: "2025-12-31", y: 0 }, { x: "2026-08-31", y: 3.17 }] },
  ] };
  const reports: Array<Record<string, unknown>> = [];
  const composed = await composeAnalystBlocksWithLlm({
    env: BASE_ENV,
    context: { userIntent: "Compare NVDA with AMD YTD", bundleId: "peer_comparison" },
    blocks: [NARRATIVE_BLOCK],
    toolCalls: [],
    factBlocks: [...RENDER_BLOCKS, perf],
    // A recorded packet's reported facts, then the chart's returns.
    packet: recorded([...RENDER_FIGURES, ...turnPacket({ toolCalls: [], factBlocks: [perf] }).figures.map((figure, index) => ({ ...figure, id: `F${5 + index}` }))], { factBlocks: [...RENDER_BLOCKS, perf] }),
    createClient: () => async () => ({ text: withList([
      { kind: "comparison", op: "highest", result: "F5", text: "NVDA's price return was highest.", evidence: ["F5", "F6"] },
      { kind: "observation", text: "NVDA's gross margin was [[F2]] and AMD's was [[F4]].", evidence: ["F2", "F4"] },
    ]) }),
    onAssertions: (report) => reports.push(report as unknown as Record<string, unknown>),
  });
  const text = (composed[0].segments as Array<{ text?: string; format?: string }>).map((segment) => segment.text ?? segment.format).join("");
  assert.equal(text,
    "Of NVDA and AMD, NVDA's price return was highest: NVDA 5.81%, AMD 3.17% (YTD 2026: Dec 2025 close to Aug 2026 close)." +
    "\n\nNVDA's gross margin was 74.6% in FY2026 (ended Jan 2026); AMD's gross margin was 49.2% in FY2025 (ended Dec 2025).");
  assert.deepEqual(reports[0]!.rejected, []);
});

test("across companies, an inference's label states what its comparisons checked (#288, #301)", async () => {
  const { block, report } = await renderWithReply(withList([
    { kind: "analyst_inference", text: "The margin lead leaves more room to invest.", evidence: [], supports: [1] },
    { kind: "comparison", op: "highest", result: "F2", text: "NVDA's gross margin is the highest.", evidence: ["F2", "F4"] },
    { kind: "observation", text: "NVDA's revenue was [[F1]] and AMD's was [[F3]].", evidence: ["F1", "F3"] },
    { kind: "analyst_inference", text: "Scale leaves room to invest.", evidence: [], supports: [2] },
  ]));
  const segments = block.segments as Array<{ type: string; text?: string; format?: string; ref_id?: string }>;
  // In the model's order: its takeaway first.
  assert.equal(
    segments.map((segment) => segment.text ?? segment.format).join(""),
    "> **Analyst inference** (NVDA highest on gross margin): The margin lead leaves more room to invest." +
      "\n\nOf NVDA and AMD, NVDA's gross margin was highest: NVDA 74.6% (FY2026, ended Jan 2026), AMD 49.2% (FY2025, ended Dec 2025)." +
      "\n\nNVDA's revenue was $130.5B in FY2026 (ended Jan 2026); AMD's revenue was $25.8B in FY2025 (ended Dec 2025)." +
      "\n\n> **Analyst inference:** Scale leaves room to invest." +
      "\n\nThe periods compared end at different times, so they do not line up: NVDA's FY2026 ended Jan 2026 and AMD's FY2025 ended Dec 2025.",
  );
  assert.deepEqual(segments.filter((segment) => segment.type === "ref").map((segment) => segment.ref_id), [FACT(2), FACT(4), FACT(1), FACT(3)]);
  assert.deepEqual(report.rejected, []);

  // The wrong winner, every number right: rejected, and the inference with it.
  const wrong = await renderWithReply(withList([
    { kind: "comparison", op: "highest", result: "F4", text: "AMD's gross margin is the highest.", evidence: ["F2", "F4"] },
    { kind: "analyst_inference", text: "It keeps more of each sale.", evidence: [], supports: [0] },
  ]));
  assert.deepEqual((wrong.report.rejected as Array<{ index: number; reason: string }>).map((entry) => entry.reason), [
    "comparison: F2 (74.6%) is higher than F4 (49.2%)",
    "an inference binds the accepted observations it rests on",
  ]);
  assert.equal(wrong.report.rendered, undefined);
});

test("across companies, an inference's subject is named in its label (#308)", async () => {
  const { block, report } = await renderWithReply(withList([
    { kind: "comparison", op: "highest", result: "F2", text: "NVDA's gross margin is the highest.", evidence: ["F2", "F4"] },
    { kind: "analyst_inference", subject: "AMD", text: "Its thinner margin leaves less room to invest.", evidence: [], supports: [0] },
  ]));
  assert.equal(
    (block.segments as Array<{ text?: string; format?: string }>).map((segment) => segment.text ?? segment.format).join(""),
    "Of NVDA and AMD, NVDA's gross margin was highest: NVDA 74.6% (FY2026, ended Jan 2026), AMD 49.2% (FY2025, ended Dec 2025)." +
      "\n\n> **Analyst inference on AMD** (NVDA highest on gross margin): Its thinner margin leaves less room to invest." +
      "\n\nThe periods compared end at different times, so they do not line up: NVDA's FY2026 ended Jan 2026 and AMD's FY2025 ended Dec 2025.",
  );
  assert.deepEqual(report.rejected, []);
});

test("an observation a kept comparison already writes in full is not said twice; it still supports an inference (#301)", async () => {
  const { block, report } = await renderWithReply(withList([
    { kind: "comparison", op: "highest", result: "F2", text: "NVDA's gross margin is the highest.", evidence: ["F2", "F4"] },
    { kind: "observation", text: "NVDA's gross margin was [[F2]] and AMD's was [[F4]].", evidence: ["F2", "F4"] },
    // AMD's revenue is in no comparison, so the whole observation stays.
    { kind: "observation", text: "NVDA's gross margin was [[F2]]; AMD's revenue was [[F3]].", evidence: ["F2", "F3"] },
    { kind: "analyst_inference", text: "Pricing power shows in the margin.", evidence: [], supports: [1] },
  ]));
  assert.equal(
    (block.segments as Array<{ text?: string; format?: string }>).map((segment) => segment.text ?? segment.format).join(""),
    "Of NVDA and AMD, NVDA's gross margin was highest: NVDA 74.6% (FY2026, ended Jan 2026), AMD 49.2% (FY2025, ended Dec 2025)." +
      "\n\nNVDA's gross margin was 74.6% in FY2026 (ended Jan 2026); AMD's revenue was $25.8B in FY2025 (ended Dec 2025)." +
      "\n\n> **Analyst inference:** Pricing power shows in the margin." +
      "\n\nThe periods compared end at different times, so they do not line up: NVDA's FY2026 ended Jan 2026 and AMD's FY2025 ended Dec 2025.",
  );
  assert.deepEqual(report.repeated, [1]);
  assert.deepEqual((report.accepted as Array<{ index: number }>).map((entry) => entry.index), [0, 1, 2, 3]);
});

test("a single company's checked trend and low render (#208)", async () => {
  const quarters = [["Q1 2025", "2025-03-29", "10.8%", 2025, "Q1"], ["Q2 2025", "2025-06-28", "-1.7%", 2025, "Q2"], ["Q3 2025", "2025-09-27", "13.7%", 2025, "Q3"], ["Q4 2025", "2025-12-27", "14.1%", 2025, "Q4"]] as const;
  const id = (n: number) => `d2080000-0000-4000-8000-00000000000${n}`;
  const trendRow = {
    id: "margin-trend", kind: "metric_row", title: "Operating margin by quarter", subjects: [{ kind: "issuer", id: "i-amd" }], subject_labels: ["AMD"],
    items: quarters.map(([label, , format], n) => ({ label, format, value_ref: id(n) })),
    source_refs: ["s-amd"],
    data_ref: { kind: "metric_row", id: "margin-trend", params: { fact_bindings: quarters.map(([, period_end, , fiscal_year, fiscal_period], n) => ({
      fact_id: id(n), unit: "ratio", period_kind: "fiscal_q", fiscal_year, fiscal_period, period_end, as_of: "2026-02-26T00:00:00.000Z",
    })) } },
  };
  const reports: Array<Record<string, unknown>> = [];
  const composed = await composeAnalystBlocksWithLlm({
    env: BASE_ENV,
    context: { userIntent: "How have AMD's operating margins trended?", bundleId: "single_name" },
    blocks: [NARRATIVE_BLOCK],
    toolCalls: [],
    factBlocks: [trendRow],
    packet: recorded(quarters.map(([period, period_end, value], n) => ({
      id: `F${n + 1}`, metric: "Operating margin", period, period_end, value, shown_in: trendRow.title, fact_id: id(n), source_ids: ["s-amd"],
    })), { factBlocks: [trendRow] }),
    createClient: () => async () => ({ text: withList([
      { kind: "comparison", op: "trend", result: "rebounded", text: "AMD's operating margin rebounded.", evidence: ["F1", "F2", "F3", "F4"] },
      { kind: "comparison", op: "lowest", result: "F2", text: "Q2 2025 was the low.", evidence: ["F1", "F2", "F3", "F4"] },
      // The convenient endpoint: rejected.
      { kind: "comparison", op: "lowest", result: "F1", text: "Q1 2025 was the low.", evidence: ["F1", "F3", "F4"] },
    ]) }),
    onAssertions: (report) => reports.push(report as unknown as Record<string, unknown>),
  });
  const text = (composed[0].segments as Array<{ text?: string; format?: string }>).map((segment) => segment.text ?? segment.format).join("");
  assert.equal(text,
    "AMD's operating margin fell from 10.8% in Q1 2025 to a low of -1.7% in Q2 2025, then rebounded to 14.1% in Q4 2025, its highest of the periods compared, above where it started." +
    "\n\nAMD's operating margin was lowest in Q2 2025, at -1.7%, of the periods from Q1 2025 to Q4 2025.");
  assert.deepEqual((reports[0]!.rejected as Array<{ reason: string }>).map((entry) => entry.reason), [
    "comparison: leaves out Q2 2025, which shows operating margin too",
  ]);
});

test("a rejected comparison never falls back to the model's prose (#286 review)", async () => {
  // The prose names the wrong winner; its comparison is rejected, nothing else is listed.
  const reply = "AMD has the highest gross margin.\n\n```assertions\n" + JSON.stringify([
    { kind: "comparison", op: "highest", result: "F4", text: "AMD's gross margin is the highest.", evidence: ["F2", "F4"] },
  ]) + "\n```";
  const { block, report } = await renderWithReply(reply);
  const text = (block.segments as Array<{ text?: string; format?: string }>).map((segment) => segment.text ?? segment.format).join("");
  assert.equal(text, NO_ANSWER);
  assert.equal(report.rendered, undefined);
});

