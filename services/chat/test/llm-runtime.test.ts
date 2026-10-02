import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { LlmProviderError } from "../../llm/src/index.ts";
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
      assert.match(request.messages[1]?.content ?? "", /load_evidence/);
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

test("the production deadlines bound the answer and the title calls", () => {
  for (const deadlines of [ANSWER_DEADLINES, TITLE_DEADLINES]) {
    assert.ok(deadlines.attemptMs > 0 && deadlines.attemptMs < deadlines.totalMs);
  }
  assert.ok(ANSWER_DEADLINES.totalMs <= 180_000, "a hung provider costs a user minutes, not the 516 s of #184");
  assert.ok(TITLE_DEADLINES.attemptMs < ANSWER_DEADLINES.attemptMs);
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

// A provider that accepts the request and never answers. Its open connection keeps
// the event loop alive; a bare pending promise doesn't (AbortSignal.timeout's timer is
// unref'd), so the interval stands in for it.
function hang(t: { after(fn: () => void): void }): Promise<never> {
  const connection = setInterval(() => {}, 1_000);
  t.after(() => clearInterval(connection));
  return new Promise<never>(() => {});
}
