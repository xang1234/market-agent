import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";

import { MASKED_LLM_SECRET } from "../../llm/src/index.ts";
import { LlmProviderError, type LlmProviderErrorCode } from "../../llm/src/router.ts";
import {
  handleLlmSettingsRequest,
  type DevApiLlmSettingsOptions,
} from "../src/llm-settings-http.ts";

test("LLM settings endpoints require the explicit dev flag", async () => {
  const response = await invoke("/v1/dev/llm-settings", { env: {} });

  assert.equal(response.status, 404);
});

test("GET /v1/dev/llm-settings returns masked env-file settings", async () => {
  const envFile = await seedEnvFile();
  const response = await invoke("/v1/dev/llm-settings", { env: enabledEnv(envFile) });
  const body = response.body as {
    version?: string;
    settings: { channels: Array<{ apiKey: string; apiKeys: string[] }> };
  };

  assert.equal(response.status, 200);
  assert.match(String(body.version), /^sha256:/);
  assert.equal(body.settings.channels[0].apiKey, MASKED_LLM_SECRET);
  assert.deepEqual(body.settings.channels[0].apiKeys, [MASKED_LLM_SECRET]);
});

test("GET /v1/dev/llm-settings reports validation issues", async () => {
  const envFile = await seedEnvFile([
    "LLM_CHANNELS=custom,custom",
    "",
  ]);
  const response = await invoke("/v1/dev/llm-settings", { env: enabledEnv(envFile) });
  const body = response.body as { settings: { issues: string[] } };

  assert.equal(response.status, 200);
  assert.deepEqual(body.settings.issues, [
    "LLM_CHANNELS: duplicate channel 'custom' ignored",
    "LLM_CUSTOM_BASE_URL: required for openai-compatible channel 'custom'",
    "LLM_CUSTOM_MODELS: at least one model is required for channel 'custom'",
  ]);
});

test("PUT /v1/dev/llm-settings preserves masked keys and detects version conflicts", async () => {
  const envFile = await seedEnvFile();
  const current = await invoke("/v1/dev/llm-settings", { env: enabledEnv(envFile) });
  const currentBody = current.body as { version: string };

  const saved = await invoke("/v1/dev/llm-settings", {
    method: "PUT",
    env: enabledEnv(envFile),
    body: {
      version: currentBody.version,
      settings: {
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
      },
    },
  });
  assert.equal(saved.status, 200);
  const text = await readFile(envFile, "utf8");
  assert.match(text, /LLM_OPENAI_API_KEY=sk-old/);
  assert.match(text, /LITELLM_MODEL=openai\/o3/);

  const conflict = await invoke("/v1/dev/llm-settings", {
    method: "PUT",
    env: enabledEnv(envFile),
    body: {
      version: currentBody.version,
      settings: { channels: [], primaryModel: null, fallbackModels: [], agentModel: null },
    },
  });
  assert.equal(conflict.status, 409);
});

test("POST /v1/dev/llm-settings/test-channel uses the shared router", async () => {
  const envFile = await seedEnvFile();
  const response = await invoke("/v1/dev/llm-settings/test-channel", {
    method: "POST",
    env: enabledEnv(envFile),
    options: {
      createClient: () => async () => ({ text: "Reply OK" }),
    },
  });

  assert.equal(response.status, 200);
  assert.equal((response.body as { ok?: boolean }).ok, true);
  assert.equal((response.body as { reply?: string }).reply, "Reply OK");
});

test("POST /v1/dev/llm-settings/test-channel distinguishes provider failures", async () => {
  const envFile = await seedEnvFile();
  const response = await invoke("/v1/dev/llm-settings/test-channel", {
    method: "POST",
    env: enabledEnv(envFile),
    options: {
      createClient: () => async () => {
        throw new LlmProviderError("auth_failed", "bad key");
      },
    },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    ok: false,
    error_code: "auth_failed",
    message: "bad key",
    attempts: [{
      deployment: { channel: "openai", model: "gpt-4.1" },
      code: "auth_failed",
      message: "bad key",
    }],
  });
});

test("POST /v1/dev/llm-settings/test-channel classifies retryable provider failures", async () => {
  for (const failure of [
    { code: "model_not_found", message: "missing model" },
    { code: "provider_failed", message: "provider down" },
    { code: "timeout", message: "timed out" },
  ] satisfies Array<{ code: LlmProviderErrorCode; message: string }>) {
    const envFile = await seedEnvFile();
    const response = await invoke("/v1/dev/llm-settings/test-channel", {
      method: "POST",
      env: enabledEnv(envFile),
      options: {
        createClient: () => async () => {
          throw new LlmProviderError(failure.code, failure.message);
        },
      },
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.ok, false);
    assert.equal(response.body.error_code, failure.code);
    assert.equal(response.body.message, failure.message);
  }
});

test("POST /v1/dev/llm-settings/discover-models reads OpenAI-compatible /models", async () => {
  const envFile = await seedEnvFile();
  const response = await invoke("/v1/dev/llm-settings/discover-models", {
    method: "POST",
    env: enabledEnv(envFile),
    body: { baseUrl: "https://provider.example/v1" },
    options: {
      fetch: async (url) => {
        assert.equal(String(url), "https://provider.example/v1/models");
        return new Response(JSON.stringify({ data: [{ id: "model-a" }, { id: "model-b" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { ok: true, models: ["model-a", "model-b"] });
});

test("POST /v1/dev/llm-settings/discover-models classifies provider failures", async () => {
  const envFile = await seedEnvFile();
  const unauthorized = await invoke("/v1/dev/llm-settings/discover-models", {
    method: "POST",
    env: enabledEnv(envFile),
    body: { baseUrl: "https://provider.example/v1" },
    options: {
      fetch: async () => new Response(JSON.stringify({ error: "bad key" }), { status: 401 }),
    },
  });
  const malformed = await invoke("/v1/dev/llm-settings/discover-models", {
    method: "POST",
    env: enabledEnv(envFile),
    body: { baseUrl: "https://provider.example/v1" },
    options: {
      fetch: async () => new Response(JSON.stringify({ data: "not an array" }), { status: 200 }),
    },
  });
  const unsupported = await invoke("/v1/dev/llm-settings/discover-models", {
    method: "POST",
    env: enabledEnv(envFile),
    body: { baseUrl: "https://provider.example/v1" },
    options: {
      fetch: async () => new Response(JSON.stringify({ error: "not found" }), { status: 404 }),
    },
  });
  const network = await invoke("/v1/dev/llm-settings/discover-models", {
    method: "POST",
    env: enabledEnv(envFile),
    body: { baseUrl: "https://provider.example/v1" },
    options: {
      fetch: async () => {
        throw new Error("ENOTFOUND");
      },
    },
  });
  const timeout = await invoke("/v1/dev/llm-settings/discover-models", {
    method: "POST",
    env: enabledEnv(envFile),
    body: { baseUrl: "https://provider.example/v1" },
    options: {
      fetch: async () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        throw error;
      },
    },
  });

  assert.equal(unauthorized.status, 200);
  assert.deepEqual(unauthorized.body, {
    ok: false,
    error_code: "auth_failed",
    models: [],
    message: "model discovery failed with HTTP 401",
  });
  assert.equal(malformed.status, 200);
  assert.deepEqual(malformed.body, {
    ok: false,
    error_code: "malformed_response",
    models: [],
    message: "provider response did not include a model data array",
  });
  assert.deepEqual(unsupported.body, {
    ok: false,
    error_code: "model_listing_unavailable",
    models: [],
    message: "model discovery failed with HTTP 404",
  });
  assert.deepEqual(network.body, {
    ok: false,
    error_code: "network_failed",
    models: [],
    message: "ENOTFOUND",
  });
  assert.deepEqual(timeout.body, {
    ok: false,
    error_code: "timeout",
    models: [],
    message: "aborted",
  });
});

test("LLM settings endpoints reject forwarded non-local requests", async () => {
  const envFile = await seedEnvFile();
  const response = await invoke("/v1/dev/llm-settings", {
    env: enabledEnv(envFile),
    headers: { "x-forwarded-for": "203.0.113.10" },
  });

  assert.equal(response.status, 403);
});

async function invoke(path: string, input: {
  method?: string;
  env: Record<string, string | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
  options?: DevApiLlmSettingsOptions;
}): Promise<{ status: number; body: Record<string, unknown> }> {
  const payload = input.body === undefined ? "" : JSON.stringify(input.body);
  const req = Readable.from(payload === "" ? [] : [payload]) as unknown as {
    method?: string;
    headers: Record<string, string>;
    socket: { remoteAddress?: string };
  } & AsyncIterable<Uint8Array | string>;
  req.method = input.method ?? "GET";
  req.headers = input.headers ?? {};
  req.socket = { remoteAddress: "127.0.0.1" };

  let status = 200;
  let text = "";
  let finishedResolve!: () => void;
  const finished = new Promise<void>((resolve) => {
    finishedResolve = resolve;
  });
  const res = {
    headersSent: false,
    set statusCode(value: number) {
      status = value;
    },
    get statusCode() {
      return status;
    },
    setHeader() {},
    end(chunk?: unknown) {
      this.headersSent = true;
      text = chunk === undefined ? "" : String(chunk);
      finishedResolve();
    },
  };

  await handleLlmSettingsRequest({
    req: req as never,
    res: res as never,
    url: new URL(path, "http://localhost"),
    env: input.env,
    flags: {
      llmSettingsEnabled: input.env.MA_FLAG_LLM_SETTINGS === "true",
      placeholderApiEnabled: true,
      showDevBanner: false,
    },
    options: input.options,
  });
  await finished;
  return { status, body: text ? JSON.parse(text) : {} };
}

function enabledEnv(envFile: string): Record<string, string> {
  return {
    MA_FLAG_LLM_SETTINGS: "true",
    LLM_SETTINGS_ENV_FILE: envFile,
  };
}

async function seedEnvFile(lines = [
  "LLM_CHANNELS=openai",
  "LLM_OPENAI_PROTOCOL=openai",
  "LLM_OPENAI_BASE_URL=https://api.openai.com/v1",
  "LLM_OPENAI_API_KEY=sk-old",
  "LLM_OPENAI_MODELS=gpt-4.1",
  "LITELLM_MODEL=openai/gpt-4.1",
  "",
]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "dev-api-llm-settings-"));
  const envFile = join(dir, ".env.dev");
  await writeFile(envFile, lines.join("\n"));
  return envFile;
}
