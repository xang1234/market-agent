import type { IncomingMessage, ServerResponse } from "node:http";

import type { DevFlags } from "../../shared/src/devFlags.ts";
import {
  createLlmRouterFromEnv,
  LlmSettingsVersionConflictError,
  MASKED_LLM_SECRET,
  readLlmSettingsEnvFile,
  writeLlmSettingsEnvFile,
  type LlmChatClient,
} from "../../llm/src/index.ts";

export type DevApiLlmSettingsOptions = {
  createClient?: () => Promise<LlmChatClient> | LlmChatClient;
  fetch?: typeof fetch;
};

export function isLlmSettingsPath(pathname: string): boolean {
  return pathname === "/v1/dev/llm-settings" ||
    pathname === "/v1/dev/llm-settings/test-channel" ||
    pathname === "/v1/dev/llm-settings/discover-models";
}

export async function handleLlmSettingsRequest(input: {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  env: Record<string, string | undefined>;
  flags: DevFlags;
  options?: DevApiLlmSettingsOptions;
}): Promise<void> {
  try {
    await handleLlmSettingsRequestUnsafe(input);
  } catch (error) {
    if (input.res.headersSent) {
      input.res.end();
      return;
    }
    if (error instanceof LlmSettingsVersionConflictError) {
      respondJson(input.res, 409, {
        error: error.message,
        current_version: error.currentVersion,
      });
      return;
    }
    if (error instanceof LlmSettingsHttpError) {
      respondJson(input.res, error.status, { error: error.message });
      return;
    }
    respondJson(input.res, 500, { error: error instanceof Error ? error.message : "internal server error" });
  }
}

async function handleLlmSettingsRequestUnsafe(input: {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  env: Record<string, string | undefined>;
  flags: DevFlags;
  options?: DevApiLlmSettingsOptions;
}): Promise<void> {
  const { req, res, url, env, flags, options = {} } = input;
  if (!guardLlmSettingsAccess(req, res, env, flags)) return;

  if (url.pathname === "/v1/dev/llm-settings") {
    const envFile = readLlmSettingsEnvFilePath(env);
    if (req.method === "GET") {
      respondJson(res, 200, await readLlmSettingsEnvFile(envFile));
      return;
    }
    if (req.method === "PUT") {
      respondJson(res, 200, await writeLlmSettingsEnvFile(envFile, readLlmSettingsUpdateBody(await readRequestJson(req))));
      return;
    }
  }

  if (url.pathname === "/v1/dev/llm-settings/test-channel" && req.method === "POST") {
    const router = await createLlmRouterFromEnv(env, {
      createClient: options.createClient,
    });
    if (!router) {
      respondJson(res, 400, { error: "no enabled LLM deployment is configured" });
      return;
    }
    const result = await router.complete({
      messages: [
        { role: "system", content: "Reply with exactly: Reply OK" },
        { role: "user", content: "Connection test" },
      ],
      temperature: 0,
      maxTokens: 16,
    });
    respondJson(res, 200, {
      ok: result.text.trim() === "Reply OK",
      reply: result.text,
      deployment: result.deployment,
    });
    return;
  }

  if (url.pathname === "/v1/dev/llm-settings/discover-models" && req.method === "POST") {
    respondJson(res, 200, await discoverOpenAiCompatibleModels(await readRequestJson(req), options.fetch ?? fetch));
    return;
  }

  respondJson(res, 404, { error: "not found" });
}

class LlmSettingsHttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "LlmSettingsHttpError";
    this.status = status;
  }
}

function guardLlmSettingsAccess(
  req: IncomingMessage,
  res: ServerResponse,
  env: Record<string, string | undefined>,
  flags: DevFlags,
): boolean {
  if (!flags.llmSettingsEnabled) {
    respondJson(res, 404, { error: "not found" });
    return false;
  }
  if (!isLocalDevRequest(req)) {
    respondJson(res, 403, { error: "LLM settings are only available to local dev requests" });
    return false;
  }
  if (nonEmptyString(env.LLM_SETTINGS_ENV_FILE) === null) {
    respondJson(res, 503, { error: "LLM_SETTINGS_ENV_FILE is not configured" });
    return false;
  }
  return true;
}

function readLlmSettingsEnvFilePath(env: Record<string, string | undefined>): string {
  const path = nonEmptyString(env.LLM_SETTINGS_ENV_FILE);
  if (path === null) {
    throw new LlmSettingsHttpError(503, "LLM_SETTINGS_ENV_FILE is not configured");
  }
  return path;
}

function readLlmSettingsUpdateBody(body: unknown): Parameters<typeof writeLlmSettingsEnvFile>[1] {
  const record = readObject(body, "request body");
  const settings = readObject(record.settings, "settings");
  const channels = Array.isArray(settings.channels) ? settings.channels.map((channel) => readObject(channel, "channel")) : [];
  return {
    expectedVersion: nonEmptyString(record.version) ?? undefined,
    channels: channels.map((channel) => ({
      name: requireNonEmpty(channel.name, "channel.name"),
      protocol: nonEmptyString(channel.protocol),
      baseUrl: nonEmptyString(channel.baseUrl ?? channel.base_url),
      apiKey: nonEmptyString(channel.apiKey ?? channel.api_key),
      apiKeys: stringArray(channel.apiKeys ?? channel.api_keys),
      models: stringArray(channel.models),
      enabled: typeof channel.enabled === "boolean" ? channel.enabled : true,
    })),
    primaryModel: nonEmptyString(settings.primaryModel ?? settings.primary_model),
    fallbackModels: stringArray(settings.fallbackModels ?? settings.fallback_models),
    agentModel: nonEmptyString(settings.agentModel ?? settings.agent_model),
  };
}

async function discoverOpenAiCompatibleModels(
  body: unknown,
  fetchImpl: typeof fetch,
): Promise<{ models: string[] }> {
  const record = readObject(body, "request body");
  const baseUrl = nonEmptyString(record.baseUrl ?? record.base_url);
  if (baseUrl === null) {
    throw new LlmSettingsHttpError(400, "baseUrl is required");
  }
  const apiKey = nonEmptyString(record.apiKey ?? record.api_key);
  const response = await fetchImpl(`${baseUrl.replace(/\/+$/u, "")}/models`, {
    headers: apiKey && apiKey !== MASKED_LLM_SECRET
      ? { authorization: `Bearer ${apiKey}` }
      : undefined,
  });
  if (!response.ok) {
    throw new LlmSettingsHttpError(response.status, `model discovery failed with HTTP ${response.status}`);
  }
  const payload = await response.json() as unknown;
  const data = readOptionalObjectArray(readOptionalObject(payload)?.data);
  return {
    models: data.flatMap((model) => {
      const id = nonEmptyString(model.id);
      return id === null ? [] : [id];
    }),
  };
}

async function readRequestJson(req: AsyncIterable<Uint8Array | string>): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (text.trim() === "") return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new LlmSettingsHttpError(400, "request body must be valid JSON");
  }
}

function respondJson(res: ServerResponse, status: number, body: object) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

function isLocalDevRequest(req: IncomingMessage): boolean {
  const forwardedFor = req.headers["x-forwarded-for"];
  const forwardedAddress = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
  const firstForwarded = nonEmptyString(forwardedAddress?.split(",")[0]);
  if (firstForwarded !== null && !isLocalAddress(firstForwarded)) return false;
  return isLocalAddress(req.socket.remoteAddress ?? "");
}

function isLocalAddress(address: string): boolean {
  return address === "127.0.0.1" ||
    address === "::1" ||
    address === "::ffff:127.0.0.1" ||
    address === "localhost";
}

function readObject(value: unknown, label: string): Record<string, unknown> {
  const record = readOptionalObject(value);
  if (record === null) throw new LlmSettingsHttpError(400, `${label} must be an object`);
  return record;
}

function readOptionalObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function readOptionalObjectArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.flatMap((item) => {
    const record = readOptionalObject(item);
    return record === null ? [] : [record];
  }) : [];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function requireNonEmpty(value: unknown, label: string): string {
  const text = nonEmptyString(value);
  if (text === null) throw new LlmSettingsHttpError(400, `${label} is required`);
  return text;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}
