import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  MASKED_LLM_SECRET,
  LlmSettingsVersionConflictError,
  editableLlmSettingsFromEnv,
  writeLlmSettingsEnvFile,
} from "../src/settings-file.ts";

test("editableLlmSettingsFromEnv masks API keys", () => {
  const editable = editableLlmSettingsFromEnv({
    LLM_CHANNELS: "openai",
    LLM_OPENAI_API_KEY: "sk-secret",
    LLM_OPENAI_MODELS: "gpt-4.1",
    LITELLM_MODEL: "openai/gpt-4.1",
  });

  assert.equal(editable.channels[0]?.apiKey, MASKED_LLM_SECRET);
  assert.deepEqual(editable.channels[0]?.apiKeys, [MASKED_LLM_SECRET]);
});

test("writeLlmSettingsEnvFile preserves masked secrets and unrelated env lines", async () => {
  const dir = await mkdtemp(join(tmpdir(), "llm-settings-file-"));
  const file = join(dir, ".env.dev");
  await writeFile(file, [
    "DATABASE_URL=postgres://local",
    "LLM_CHANNELS=openai",
    "LLM_OPENAI_API_KEY=sk-old",
    "LLM_OPENAI_MODELS=gpt-4.1",
    "LITELLM_MODEL=openai/gpt-4.1",
    "",
  ].join("\n"));

  const written = await writeLlmSettingsEnvFile(file, {
    channels: [{
      name: "openai",
      protocol: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiKey: MASKED_LLM_SECRET,
      apiKeys: [MASKED_LLM_SECRET],
      models: ["gpt-4.1", "o3"],
      enabled: true,
    }],
    primaryModel: "openai/o3",
    fallbackModels: ["openai/gpt-4.1"],
    agentModel: null,
  });

  const text = await readFile(file, "utf8");
  assert.match(text, /DATABASE_URL=postgres:\/\/local/);
  assert.match(text, /LLM_OPENAI_API_KEY=sk-old/);
  assert.match(text, /LLM_OPENAI_MODELS=gpt-4\.1,o3/);
  assert.match(text, /LITELLM_MODEL=openai\/o3/);
  assert.equal(written.version, versionForText(text));
});

test("writeLlmSettingsEnvFile rejects stale versions before writing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "llm-settings-file-conflict-"));
  const file = join(dir, ".env.dev");
  await writeFile(file, "LLM_CHANNELS=openai\n");

  await assert.rejects(
    () => writeLlmSettingsEnvFile(file, {
      expectedVersion: "sha256:stale",
      channels: [],
      primaryModel: null,
      fallbackModels: [],
      agentModel: null,
    }),
    (error) => error instanceof LlmSettingsVersionConflictError,
  );

  assert.equal(await readFile(file, "utf8"), "LLM_CHANNELS=openai\n");
});

test("writeLlmSettingsEnvFile uses a rename-only final file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "llm-settings-file-atomic-"));
  const file = join(dir, ".env.dev");

  await writeLlmSettingsEnvFile(file, {
    channels: [],
    primaryModel: null,
    fallbackModels: [],
    agentModel: null,
  });

  assert.deepEqual((await readdir(dir)).sort(), [".env.dev"]);
});

function versionForText(text: string): string {
  return `sha256:${createHash("sha256").update(text).digest("hex")}`;
}
