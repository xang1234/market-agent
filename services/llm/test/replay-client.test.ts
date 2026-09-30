import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createLlmRouterFromEnv } from "../src/settings-loader.ts";

const CHANNEL_ENV = {
  LLM_CHANNELS: "fixture",
  LLM_FIXTURE_PROTOCOL: "openai",
  LLM_FIXTURE_MODELS: "recorded",
  LITELLM_MODEL: "fixture/recorded",
};

async function replayFile(replies: ReadonlyArray<{ match: string; text: string }>): Promise<string> {
  const path = join(await mkdtemp(join(tmpdir(), "llm-replay-")), "replies.json");
  await writeFile(path, JSON.stringify({ replies }));
  return path;
}

test("LLM_REPLAY_FILE answers with the first recorded reply matching the request", async () => {
  const router = await createLlmRouterFromEnv({
    ...CHANNEL_ENV,
    LLM_REPLAY_FILE: await replayFile([
      { match: "research chat title", text: "NVDA revenue check" },
      { match: "investment research answer", text: "NVIDIA revenue grew." },
    ]),
  });
  assert.ok(router);

  const result = await router.complete({
    messages: [
      { role: "system", content: "Write a concise investment research answer for the chat user." },
      { role: "user", content: "Analyze NVDA" },
    ],
  });

  assert.equal(result.text, "NVIDIA revenue grew.");
});

test("LLM_REPLAY_FILE fails loudly when no recorded reply matches", async () => {
  const router = await createLlmRouterFromEnv({
    ...CHANNEL_ENV,
    LLM_REPLAY_FILE: await replayFile([{ match: "something else", text: "unused" }]),
  });
  assert.ok(router);

  await assert.rejects(
    router.complete({ messages: [{ role: "user", content: "Analyze NVDA" }] }),
    (error: { attempts?: ReadonlyArray<{ message: string }> }) =>
      /no recorded reply matches/.test(error.attempts?.[0]?.message ?? ""),
  );
});
