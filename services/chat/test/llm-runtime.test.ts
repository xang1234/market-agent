import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { LlmProviderError, LlmRouterError } from "../../llm/src/index.ts";
import {
  ANSWER_DEADLINES,
  composeAnalystBlocksWithLlm,
  TITLE_DEADLINES,
  createLlmThreadTitleModel,
} from "../src/llm-runtime.ts";

const BASE_ENV = {
  LLM_CHANNELS: "openai",
  LLM_OPENAI_PROTOCOL: "openai",
  LLM_OPENAI_MODELS: "gpt-4.1",
  LITELLM_MODEL: "openai/gpt-4.1",
};

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
    toolCalls: [],
    createClient: () => async (_deployment, request) => {
      observedMaxTokens = request.maxTokens;
      return { text: "Apple's revenue rose." };
    },
  });

  // At 800, qwen3.8-max spent the whole budget reasoning and returned no text (#124).
  assert.ok((observedMaxTokens ?? 0) >= 4096, `expected an answer budget that survives reasoning, got ${observedMaxTokens}`);
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
      result: { evidence_status: "available" },
    }],
    createClient: () => async (_deployment, request) => {
      // The question goes in; the raw tool call does not (#181).
      assert.match(request.messages[1]?.content ?? "", /"question":"Analyze AAPL"/);
      assert.doesNotMatch(request.messages[1]?.content ?? "", /load_evidence/);
      return { text: "LLM-grounded note" };
    },
  });

  assert.notEqual(result[0], undefined);
  assert.deepEqual(result[0]?.segments, [
    { type: "text", text: "LLM-grounded note" },
  ]);
});

test("composeAnalystBlocksWithLlm instructs the analyst to caveat stale data", async () => {
  let systemPrompt = "";
  await composeAnalystBlocksWithLlm({
    env: BASE_ENV,
    context: { userIntent: "Analyze AAPL", bundleId: "single_subject_analysis" },
    blocks: [richTextBlock("Deterministic note")],
    toolCalls: [],
    createClient: () => async (_deployment, request) => {
      systemPrompt = request.messages[0]?.content ?? "";
      return { text: "answer" };
    },
  });

  // The stale signals (quote.stale, fact_recency.stale) are inert unless the
  // prompt tells the analyst to honor them.
  assert.match(systemPrompt, /stale/i);
  assert.match(systemPrompt, /fact_recency|out of date|age_days/i);
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
  const startedAt = Date.now();
  const result = await composeAnalystBlocksWithLlm({
    env: TWO_DEPLOYMENTS,
    context: { userIntent: "Analyze AAPL", bundleId: "single_subject_analysis" },
    blocks: [richTextBlock("Deterministic note")],
    toolCalls: [],
    deadlines: { attemptMs: 50, totalMs: 5_000 },
    createClient: () => async (deployment) => {
      calls.push(deployment.model);
      // The primary accepts the request and never answers.
      if (calls.length === 1) return hang(t);
      return { text: "fallback note" };
    },
  });

  assert.deepEqual(calls, ["gpt-4.1", "deepseek-chat"]);
  assert.equal((result[0].segments as Array<{ text: string }>)[0].text, "fallback note");
  assert.ok(Date.now() - startedAt < 2_000, "the hang cost about the attempt deadline");
});

test("when every model hangs, the answer call ends with an error at its deadline (#184)", async (t) => {
  const startedAt = Date.now();
  await assert.rejects(composeAnalystBlocksWithLlm({
    env: TWO_DEPLOYMENTS,
    context: { userIntent: "Analyze AAPL", bundleId: "single_subject_analysis" },
    blocks: [richTextBlock("Deterministic note")],
    toolCalls: [],
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
    toolCalls: [],
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
      toolCalls: [],
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
    toolCalls: [],
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
    toolCalls: [],
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

test("the answer is asked for an analyst's view: takeaway, trend, strengths, counterpoint, gaps (#179)", async () => {
  let systemPrompt = "";
  await composeAnalystBlocksWithLlm({
    env: BASE_ENV,
    context: { userIntent: "Analyze NVDA", bundleId: "single_subject_analysis" },
    blocks: [richTextBlock("Deterministic note")],
    toolCalls: [],
    createClient: () => async (_deployment, request) => {
      systemPrompt = request.messages[0]?.content ?? "";
      return { text: "answer" };
    },
  });
  for (const part of [/takeaway/i, /trend across every period/i, /strong or weak/i, /counterpoint grounded in the data/i, /cannot tell/i, /concentrated in one segment/i, /does not answer the question/i, /do not analyze other figures\s+in its place/i]) {
    assert.match(systemPrompt, part);
  }
  // Context comes from the data only, and the existing rules stay.
  assert.match(systemPrompt, /never add facts, numbers, or events that are not in the tool context/);
  assert.match(systemPrompt, /never compute new figures/);
  assert.match(systemPrompt, /stale/);
  // The no-keys golden replay matches on the opening sentence.
  assert.match(systemPrompt, /^Write a concise investment research answer/);
});

test("composeAnalystBlocksWithLlm falls back through shared router deployments", async () => {
  const calls: string[] = [];
  const result = await composeAnalystBlocksWithLlm({
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
    toolCalls: [],
    createClient: () => async (deployment) => {
      calls.push(`${deployment.channel}/${deployment.model}`);
      if (calls.length === 1) throw new LlmProviderError("provider_failed", "primary down");
      return { text: "fallback note" };
    },
  });

  assert.deepEqual(calls, ["openai/gpt-4.1", "deepseek/deepseek-chat"]);
  assert.deepEqual(result[0]?.segments, [{ type: "text", text: "fallback note" }]);
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
const FACT_BLOCKS = [{
  id: "metric-row-1",
  kind: "metric_row",
  title: "Latest quarter (Q4 2026)",
  items: [{ label: "Revenue", value_ref: "fact-1", format: "$62.1B" }],
}];

async function composeWithReply(reply: string) {
  let prompt = "";
  let removed: ReadonlyArray<string> = [];
  const blocks = await composeAnalystBlocksWithLlm({
    env: BASE_ENV,
    context: { userIntent: "Analyze NVDA", bundleId: "single_subject_analysis" },
    blocks: [NARRATIVE_BLOCK],
    toolCalls: [],
    factBlocks: FACT_BLOCKS,
    createClient: () => async (_deployment, request) => {
      prompt = request.messages.map((message) => message.content).join("\n");
      return { text: reply };
    },
    onNarrativeRemoved: (sentences) => {
      removed = sentences;
    },
  });
  const text = (blocks[0].segments as Array<{ text: string }>)[0].text;
  return { text, prompt, removed };
}

test("a replayed reply quoting a figure the user is not shown has that sentence stripped", async () => {
  const { text, prompt, removed } = await composeWithReply(
    "Revenue reached $62.1B in Q4 2026. That is 38% growth year over year.",
  );
  assert.equal(text, "Revenue reached $62.1B in Q4 2026.");
  // The dropped sentence is reported, so an eval can count guarded drops (#144).
  assert.deepEqual(removed, ["That is 38% growth year over year."]);
  // The model is told which figures it may quote.
  assert.match(prompt, /displayed_figures/);
  assert.match(prompt, /\$62\.1B/);
});

test("a reply with no supported sentence falls back to a pointer at the cited figures", async () => {
  const { text } = await composeWithReply("Revenue grew 45%. EPS hit $3.10.");
  assert.match(text, /select any value to see its source/);
  assert.doesNotMatch(text, /45|3\.10/);
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

test("an answer cut off at the token limit is never shown; the figures pointer is", async () => {
  // The #124 baseline showed "...The displayed figures do not include a Q".
  const { text, reasoning } = await composeWith({ text: "Gross margin fell. The displayed figures do not include a Q", truncated: true }, FACT_BLOCKS);
  assert.match(text, /select any value to see its source/);
  assert.equal(reasoning, "low", "the answer asks for low reasoning effort");
});

test("an empty answer replaces the placeholder line instead of leaving it on screen", async () => {
  assert.match((await composeWith({ text: "" }, FACT_BLOCKS)).text, /select any value to see its source/);
  // No figures to point to: say there's no answer rather than show the placeholder.
  const { text } = await composeWith({ text: "  " });
  assert.notEqual(text, "placeholder");
  assert.match(text, /No written answer is available/);
});

test("a thread title cut off at the token limit falls back instead of being saved", async () => {
  const model = createLlmThreadTitleModel({
    env: BASE_ENV,
    createClient: () => async () => ({ text: "Apple Margin Wa", truncated: true }),
  });
  await assert.rejects(async () => model({ userIntent: "Why did Apple sell off?", assistantText: "Margins compressed." }), /cut off/);
});

test("without fact blocks the narrative is passed through unguarded, as before", async () => {
  const blocks = await composeAnalystBlocksWithLlm({
    env: BASE_ENV,
    context: { userIntent: "Summarize demand", bundleId: "single_subject_analysis" },
    blocks: [NARRATIVE_BLOCK],
    toolCalls: [],
    createClient: () => async () => ({ text: "Demand rose 12% per the cited note." }),
  });
  assert.equal((blocks[0].segments as Array<{ text: string }>)[0].text, "Demand rose 12% per the cited note.");
});

const COMPARISON_BLOCKS = [{
  id: "comparison-1",
  kind: "metrics_comparison",
  title: "Side by side (latest fiscal year)",
  subjects: [{ kind: "issuer", id: "issuer-nvda" }, { kind: "issuer", id: "issuer-amd" }],
  subject_labels: ["NVDA", "AMD"],
  metrics: ["Revenue", "Gross Margin"],
  cells: [
    [{ value_ref: "f1", format: "$130.5B" }, { value_ref: "f2", format: "74.6%" }],
    [{ value_ref: "f3", format: "$25.8B" }, { value_ref: "f4", format: "49.2%" }],
  ],
}];

async function compareWithReply(reply: string) {
  let prompt = "";
  const blocks = await composeAnalystBlocksWithLlm({
    env: BASE_ENV,
    context: { userIntent: "Compare NVDA with AMD", bundleId: "peer_comparison" },
    blocks: [NARRATIVE_BLOCK],
    toolCalls: [],
    factBlocks: COMPARISON_BLOCKS,
    createClient: () => async (_deployment, request) => {
      prompt = request.messages.map((message) => message.content).join("\n");
      return { text: reply };
    },
  });
  return { text: (blocks[0].segments as Array<{ text: string }>)[0].text, prompt };
}

test("the composer reports the deployment that wrote the answer (#183)", async () => {
  const answered: string[] = [];
  await composeAnalystBlocksWithLlm({
    env: BASE_ENV,
    context: { userIntent: "Summarize demand", bundleId: "single_subject_analysis" },
    blocks: [NARRATIVE_BLOCK],
    toolCalls: [],
    createClient: () => async () => ({ text: "Demand rose." }),
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
  // Every sentence quotes a figure the user is not shown: the guard drops them all.
  assert.deepEqual(await answeredBy({ text: "NVDA's margin is 99.9%." }, COMPARISON_BLOCKS), [], "all guarded");
  assert.deepEqual(await answeredBy({ text: "NVDA is larger." }, COMPARISON_BLOCKS), ["openai/gpt-4.1"], "kept");
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
      evidence: { claims: [{ claim_id: "c1", text_canonical: "NVIDIA guided data-center revenue higher.", effective_time: "2025-11-19T00:00:00.000Z", published_at: "2025-11-20T00:00:00.000Z" }] },
    },
  } as never;
  const gap = { kind: "rich_text", segments: [{ type: "text", text: "Year-to-date price performance is not shown: AMD has no prices from before 2026." }] };
  await composeAnalystBlocksWithLlm({
    env: BASE_ENV,
    context: { userIntent: "Compare NVDA with AMD", bundleId: "peer_comparison" },
    blocks: [NARRATIVE_BLOCK],
    toolCalls: [toolCall],
    factBlocks: [...COMPARISON_BLOCKS, gap],
    createClient: () => async (_deployment, request) => {
      prompt = request.messages.at(-1)!.content;
      return { text: "NVDA is larger.", usage: { inputTokens: 900, outputTokens: 120, totalTokens: 1020, reasoningTokens: 80 } };
    },
    onUsage: (reported) => usage.push(reported),
  });
  const context = JSON.parse(prompt) as Record<string, unknown>;
  assert.deepEqual(Object.keys(context).sort(), ["conversation", "cited_claims", "data_notes", "displayed_figures", "question", "staleness"].sort());
  // Each claim keeps its dates, so a past claim is not read as current.
  assert.deepEqual(context.cited_claims, [{
    text: "NVIDIA guided data-center revenue higher.",
    effective_time: "2025-11-19T00:00:00.000Z",
    published_at: "2025-11-20T00:00:00.000Z",
  }]);
  assert.deepEqual(context.data_notes, ["Year-to-date price performance is not shown: AMD has no prices from before 2026."]);
  assert.deepEqual(context.staleness, {
    quote: [{ ticker: "NVDA", as_of: "2026-09-01T00:00:00.000Z", stale: true }],
    fact_recency: [{ latest_as_of: "2026-08-01T00:00:00.000Z", age_days: 31, stale: false }],
  });
  // None of the raw tool JSON: no facts, prices, ids, or the placeholder block.
  for (const absent of ["fact_id", "178.4", "manifest_contribution", "tool_calls", "existing_blocks", "bundle_id"]) {
    assert.ok(!prompt.includes(absent), absent);
  }
  assert.deepEqual(usage, [{ input_tokens: 900, output_tokens: 120, reasoning_tokens: 80 }]);
});

test("with no figures shown, the model still gets the evidence, compactly, as available_data (#181)", async () => {
  let prompt = "";
  const toolCall = {
    tool_call_id: "tc-1",
    tool_name: "research_lookup",
    bundle_id: "single_subject_analysis",
    status: "ok",
    result: {
      evidence_status: "available",
      structured_context: {
        quote: { ticker: "AAPL", price: 231.6, change_pct: 0.0078, currency: "USD", as_of: "2026-09-01T00:00:00.000Z", stale: false, source_id: "s" },
        facts: [{ fact_id: "f1", metric_key: "revenue", display_name: "Revenue", value_num: 416.161, scale: 1e9, unit: "currency", currency: "USD", fiscal_year: 2025, fiscal_period: "FY", as_of: "2025-10-31T00:00:00.000Z", source_id: "s" }],
      },
    },
  } as never;
  const run = async (factBlocks?: ReadonlyArray<Record<string, unknown>>) => {
    await composeAnalystBlocksWithLlm({
      env: BASE_ENV,
      context: { userIntent: "Analyze AAPL", bundleId: "single_subject_analysis" },
      blocks: [NARRATIVE_BLOCK],
      toolCalls: [toolCall],
      factBlocks,
      createClient: () => async (_deployment, request) => {
        prompt = request.messages.at(-1)!.content;
        return { text: "AAPL trades at $231.6." };
      },
    });
    return JSON.parse(prompt) as Record<string, unknown>;
  };
  assert.deepEqual((await run()).available_data, {
    quotes: [{ ticker: "AAPL", price: 231.6, change: "+0.78%", currency: "USD", as_of: "2026-09-01T00:00:00.000Z" }],
    facts: [{ metric: "Revenue", value: 416161000000, unit: "currency", currency: "USD", period: "FY 2025", as_of: "2025-10-31T00:00:00.000Z" }],
  });
  assert.ok(!prompt.includes("fact_id") && !prompt.includes('"source_id"'), "still compact: no ids");
  // With figures shown, only those may be quoted: no available_data.
  assert.equal("available_data" in (await run(COMPARISON_BLOCKS)), false);
});

test("blocks that show no figures (a gap note) leave the answer unguarded, like no blocks (#181)", async () => {
  const gap = { kind: "rich_text", segments: [{ type: "text", text: "Year-to-date price performance is not shown." }] };
  const blocks = await composeAnalystBlocksWithLlm({
    env: BASE_ENV,
    context: { userIntent: "How is AAPL doing YTD?", bundleId: "single_subject_analysis" },
    blocks: [NARRATIVE_BLOCK],
    toolCalls: [],
    factBlocks: [gap],
    createClient: () => async () => ({ text: "AAPL trades at $231.6 per the latest quote." }),
  });
  assert.equal((blocks[0].segments as Array<{ text: string }>)[0].text, "AAPL trades at $231.6 per the latest quote.");
});

test("a turn showing only a price chart stays guarded against returns it does not show (#181)", async () => {
  const chart = {
    kind: "perf_comparison",
    title: "Price performance",
    default_range: "2026-08-22 to 2026-08-31",
    series: [{ name: "NVDA", points: [{ x: "2026-08-22", y: 0 }, { x: "2026-08-31", y: 12.5 }] }],
  };
  const narrate = async (text: string) => {
    const composed = await composeAnalystBlocksWithLlm({
      env: BASE_ENV,
      context: { userIntent: "How has NVDA done?", bundleId: "peer_comparison" },
      blocks: [NARRATIVE_BLOCK],
      toolCalls: [],
      factBlocks: [chart],
      createClient: () => async () => ({ text }),
    });
    return (composed[0].segments as Array<{ text: string }>)[0].text;
  };
  assert.equal(await narrate("NVDA returned 12.5% over the window."), "NVDA returned 12.5% over the window.");
  assert.notEqual(await narrate("NVDA returned 40.0% over the window."), "NVDA returned 40.0% over the window.");
});

test("a claim the model dates from its effective time keeps its sentence (#181)", async () => {
  const toolCall = {
    tool_call_id: "tc-1",
    tool_name: "research_lookup",
    bundle_id: "peer_comparison",
    status: "ok",
    result: { evidence: { claims: [{ claim_id: "c1", text_canonical: "NVIDIA guided revenue higher.", effective_time: "2025-11-19T00:00:00.000Z" }] } },
  } as never;
  const composed = await composeAnalystBlocksWithLlm({
    env: BASE_ENV,
    context: { userIntent: "Compare NVDA with AMD", bundleId: "peer_comparison" },
    blocks: [NARRATIVE_BLOCK],
    toolCalls: [toolCall],
    factBlocks: COMPARISON_BLOCKS,
    createClient: () => async () => ({ text: "In November 2025, NVIDIA guided revenue higher." }),
  });
  assert.equal((composed[0].segments as Array<{ text: string }>)[0].text, "In November 2025, NVIDIA guided revenue higher.");
});

test("the model sees each comparison figure with the company and metric it belongs to", async () => {
  const { prompt } = await compareWithReply("NVDA leads.");
  assert.ok(
    prompt.includes(JSON.stringify({ company: "AMD", metric: "Gross Margin", value: "49.2%", shown_in: "Side by side (latest fiscal year)" })),
    prompt,
  );
});

test("a replayed reply crediting AMD's margin to NVIDIA loses that sentence; the correct one is kept", async () => {
  const wrong = await compareWithReply("NVDA's gross margin is 49.2%. NVDA is larger.");
  assert.equal(wrong.text, "NVDA is larger.");
  const right = await compareWithReply("AMD's gross margin is 49.2%. NVDA is larger.");
  assert.equal(right.text, "AMD's gross margin is 49.2%. NVDA is larger.");
});

function fiscalComparison(nvda: { year: number; end: string; revenue: string }) {
  return [{
    kind: "metrics_comparison",
    title: "Side by side (fiscal years)",
    subject_labels: ["NVDA", "AAPL"],
    metrics: ["Revenue"],
    cells: [[{ value_ref: "f1", format: nvda.revenue }], [{ value_ref: "f2", format: "$416.2B" }]],
    data_ref: {
      params: {
        fact_bindings: [
          { fact_id: "f1", fiscal_year: nvda.year, fiscal_period: "FY", period_end: nvda.end },
          { fact_id: "f2", fiscal_year: 2025, fiscal_period: "FY", period_end: "2025-09-27" },
        ],
      },
    },
  }];
}

async function narrate(factBlocks: ReadonlyArray<Record<string, unknown>>, reply: string) {
  const composed = await composeAnalystBlocksWithLlm({
    env: BASE_ENV,
    context: { userIntent: "Compare NVDA's and AAPL's revenue", bundleId: "peer_comparison" },
    blocks: [NARRATIVE_BLOCK],
    toolCalls: [],
    factBlocks,
    createClient: () => async () => ({ text: reply }),
  });
  return (composed[0].segments as Array<{ text: string }>)[0].text;
}

test("a fiscal year is credited to the company it belongs to, unless every company shares it (#180)", async () => {
  // Latest years differ: 2026 is NVDA's, 2025 AAPL's.
  const latest = fiscalComparison({ year: 2026, end: "2026-01-25", revenue: "$209.9B" });
  assert.equal(await narrate(latest, "NVDA's FY2025 revenue was $209.9B. NVDA is smaller."), "NVDA is smaller.");
  const right = "NVDA's FY2026 revenue was $209.9B and AAPL's FY2025 revenue was $416.2B.";
  assert.equal(await narrate(latest, right), right);
  // Both FY2025: the year needs no company.
  const shared = fiscalComparison({ year: 2025, end: "2025-01-26", revenue: "$130.5B" });
  const opening = "In fiscal 2025, NVDA's revenue was $130.5B.";
  assert.equal(await narrate(shared, opening), opening);
});

// A provider that accepts the request and never answers. Its open connection keeps
// the event loop alive; a bare pending promise doesn't (AbortSignal.timeout's timer is
// unref'd), so the interval stands in for it.
function hang(t: { after(fn: () => void): void }): Promise<never> {
  const connection = setInterval(() => {}, 1_000);
  t.after(() => clearInterval(connection));
  return new Promise<never>(() => {});
}
