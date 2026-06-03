import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { LlmProviderError } from "../../llm/src/index.ts";
import {
  composeAnalystBlocksWithLlm,
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
