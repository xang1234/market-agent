import { createHash, randomUUID } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";

import {
  parseLlmEnv,
  parseLlmEnvFileText,
  type LlmEnv,
} from "./channel-config.ts";

export const MASKED_LLM_SECRET = "********";

export type EditableLlmChannelSettings = {
  name: string;
  protocol: string;
  baseUrl: string | null;
  apiKey: string | null;
  apiKeys: ReadonlyArray<string>;
  models: ReadonlyArray<string>;
  enabled: boolean;
};

export type EditableLlmSettings = {
  channels: ReadonlyArray<EditableLlmChannelSettings>;
  primaryModel: string | null;
  fallbackModels: ReadonlyArray<string>;
  agentModel: string | null;
  issues: ReadonlyArray<string>;
};

export type WritableLlmChannelSettings = {
  name: string;
  protocol?: string | null;
  baseUrl?: string | null;
  apiKey?: string | null;
  apiKeys?: ReadonlyArray<string> | null;
  models?: ReadonlyArray<string> | null;
  enabled?: boolean | null;
};

export type WritableLlmSettings = {
  expectedVersion?: string;
  channels: ReadonlyArray<WritableLlmChannelSettings>;
  primaryModel?: string | null;
  fallbackModels?: ReadonlyArray<string> | null;
  agentModel?: string | null;
};

export type LlmSettingsFileRead = {
  path: string;
  version: string;
  settings: EditableLlmSettings;
};

export class LlmSettingsVersionConflictError extends Error {
  readonly currentVersion: string;

  constructor(currentVersion: string) {
    super("LLM settings file version conflict");
    this.name = "LlmSettingsVersionConflictError";
    this.currentVersion = currentVersion;
  }
}

export async function readLlmSettingsEnvFile(path: string): Promise<LlmSettingsFileRead> {
  const text = await readFileIfExists(path);
  return {
    path,
    version: versionForText(text),
    settings: editableLlmSettingsFromEnv(parseLlmEnvFileText(text)),
  };
}

export function editableLlmSettingsFromEnv(env: LlmEnv): EditableLlmSettings {
  const settings = parseLlmEnv(env);
  const modelRef = (ref: { channel: string; model: string } | null) =>
    ref ? `${ref.channel}/${ref.model}` : null;
  return Object.freeze({
    channels: Object.freeze(settings.channels.map((channel) => Object.freeze({
      name: channel.name,
      protocol: channel.protocol,
      baseUrl: channel.baseUrl,
      apiKey: maskSecret(channel.apiKeys[0] ?? null),
      apiKeys: Object.freeze(channel.apiKeys.map((key) => maskSecret(key)!)),
      models: channel.models,
      enabled: channel.enabled,
    }))),
    primaryModel: modelRef(settings.primaryModel),
    fallbackModels: Object.freeze(settings.fallbackModels.map(modelRef).filter(isString)),
    agentModel: modelRef(settings.agentModel),
    issues: settings.issues,
  });
}

export async function writeLlmSettingsEnvFile(
  path: string,
  nextSettings: WritableLlmSettings,
): Promise<LlmSettingsFileRead> {
  const currentText = await readFileIfExists(path);
  const currentVersion = versionForText(currentText);
  if (nextSettings.expectedVersion !== undefined && nextSettings.expectedVersion !== currentVersion) {
    throw new LlmSettingsVersionConflictError(currentVersion);
  }

  const nextText = mergeLlmSettingsIntoEnvText(currentText, nextSettings);
  const tempPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempPath, nextText);
  await rename(tempPath, path);
  return {
    path,
    version: versionForText(nextText),
    settings: editableLlmSettingsFromEnv(parseLlmEnvFileText(nextText)),
  };
}

export function mergeLlmSettingsIntoEnvText(
  currentText: string,
  nextSettings: WritableLlmSettings,
): string {
  const currentEnv = parseLlmEnvFileText(currentText);
  const preservedLines = currentText
    .split(/\r?\n/u)
    .filter((line) => !isManagedLlmEnvLine(line));
  while (preservedLines.length > 0 && preservedLines[preservedLines.length - 1].trim() === "") {
    preservedLines.pop();
  }

  const nextLines = renderLlmSettingsLines(nextSettings, currentEnv);
  return [
    ...preservedLines,
    ...(preservedLines.length > 0 && nextLines.length > 0 ? [""] : []),
    ...nextLines,
    "",
  ].join("\n");
}

function renderLlmSettingsLines(settings: WritableLlmSettings, currentEnv: LlmEnv): string[] {
  const lines: string[] = [];
  const channels = settings.channels
    .map(normalizeWritableChannel)
    .filter((channel): channel is NormalizedWritableChannel => channel !== null);
  lines.push(envLine("LLM_CHANNELS", channels.map((channel) => channel.name).join(",")));
  for (const channel of channels) {
    const envName = channelEnvName(channel.name);
    const currentKeys = [
      ...splitCsv(currentEnv[`LLM_${envName}_API_KEY`]),
      ...splitCsv(currentEnv[`LLM_${envName}_API_KEYS`]),
    ];
    const apiKeys = resolveApiKeys(channel, currentKeys);
    lines.push(envLine(`LLM_${envName}_PROTOCOL`, channel.protocol));
    if (channel.baseUrl !== null) {
      lines.push(envLine(`LLM_${envName}_BASE_URL`, channel.baseUrl));
    }
    if (apiKeys.length === 1) {
      lines.push(envLine(`LLM_${envName}_API_KEY`, apiKeys[0]));
    } else if (apiKeys.length > 1) {
      lines.push(envLine(`LLM_${envName}_API_KEYS`, apiKeys.join(",")));
    }
    if (channel.models.length > 0) {
      lines.push(envLine(`LLM_${envName}_MODELS`, channel.models.join(",")));
    }
    if (!channel.enabled) {
      lines.push(envLine(`LLM_${envName}_ENABLED`, "false"));
    }
  }
  if (nonEmpty(settings.primaryModel) !== null) {
    lines.push(envLine("LITELLM_MODEL", nonEmpty(settings.primaryModel)!));
  }
  const fallbackModels = (settings.fallbackModels ?? []).map(nonEmpty).filter(isString);
  if (fallbackModels.length > 0) {
    lines.push(envLine("LITELLM_FALLBACK_MODELS", fallbackModels.join(",")));
  }
  if (nonEmpty(settings.agentModel) !== null) {
    lines.push(envLine("AGENT_LITELLM_MODEL", nonEmpty(settings.agentModel)!));
  }
  return lines;
}

type NormalizedWritableChannel = {
  name: string;
  protocol: string;
  baseUrl: string | null;
  apiKey: string | null;
  apiKeys: ReadonlyArray<string>;
  models: ReadonlyArray<string>;
  enabled: boolean;
};

function normalizeWritableChannel(channel: WritableLlmChannelSettings): NormalizedWritableChannel | null {
  const name = nonEmpty(channel.name)?.toLowerCase() ?? null;
  if (name === null) return null;
  return {
    name,
    protocol: nonEmpty(channel.protocol) ?? "openai-compatible",
    baseUrl: nonEmpty(channel.baseUrl),
    apiKey: nonEmpty(channel.apiKey),
    apiKeys: Object.freeze((channel.apiKeys ?? []).map(nonEmpty).filter(isString)),
    models: Object.freeze((channel.models ?? []).map(nonEmpty).filter(isString)),
    enabled: channel.enabled ?? true,
  };
}

function resolveApiKeys(
  channel: NormalizedWritableChannel,
  currentKeys: ReadonlyArray<string>,
): string[] {
  const rawKeys = channel.apiKeys.length > 0
    ? channel.apiKeys
    : channel.apiKey !== null
    ? [channel.apiKey]
    : [];
  return rawKeys.flatMap((key, index) => {
    if (key !== MASKED_LLM_SECRET) return [key];
    const preserved = currentKeys[index] ?? currentKeys[0];
    return preserved ? [preserved] : [];
  });
}

function isManagedLlmEnvLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed === "" || trimmed.startsWith("#")) return false;
  const equalsIndex = trimmed.indexOf("=");
  if (equalsIndex === -1) return false;
  const key = trimmed.slice(0, equalsIndex).trim();
  if (key === "") return false;
  if (key === "LLM_CHANNELS" || key === "LITELLM_MODEL" || key === "LITELLM_FALLBACK_MODELS") return true;
  if (key === "AGENT_LITELLM_MODEL") return true;
  return /^LLM_[A-Z0-9_]+_(PROTOCOL|BASE_URL|API_KEY|API_KEYS|MODELS|ENABLED)$/u.test(key);
}

async function readFileIfExists(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error !== null && typeof error === "object" && (error as { code?: unknown }).code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

function versionForText(text: string): string {
  return `sha256:${createHash("sha256").update(text).digest("hex")}`;
}

function envLine(key: string, value: string): string {
  return `${key}=${quoteEnvValue(value)}`;
}

function quoteEnvValue(value: string): string {
  if (/^[A-Za-z0-9_./:@,+-]*$/u.test(value)) return value;
  return JSON.stringify(value);
}

function maskSecret(value: string | null): string | null {
  return value === null || value.trim() === "" ? null : MASKED_LLM_SECRET;
}

function channelEnvName(name: string): string {
  return name.replace(/[^a-z0-9]+/giu, "_").replace(/^_+|_+$/gu, "").toUpperCase();
}

function splitCsv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function nonEmpty(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isString(value: string | null): value is string {
  return value !== null;
}
