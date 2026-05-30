export type LlmEnv = Readonly<Record<string, string | undefined>>;

export type LlmChannelConfig = {
  name: string;
  envName: string;
  protocol: string;
  baseUrl: string | null;
  apiKeys: ReadonlyArray<string>;
  models: ReadonlyArray<string>;
  enabled: boolean;
};

export type LlmModelRef = {
  channel: string;
  model: string;
};

export type LlmSettings = {
  channels: ReadonlyArray<LlmChannelConfig>;
  primaryModel: LlmModelRef | null;
  fallbackModels: ReadonlyArray<LlmModelRef>;
  agentModel: LlmModelRef | null;
  issues: ReadonlyArray<string>;
};

export type LlmDeployment = {
  channel: string;
  model: string;
  protocol: string;
  baseUrl: string | null;
  apiKeys: ReadonlyArray<string>;
};

export function parseLlmEnv(env: LlmEnv): LlmSettings {
  const issues: string[] = [];
  const channels = parseChannels(env, issues);
  const primaryModel = parseOptionalModelRef("LITELLM_MODEL", env.LITELLM_MODEL, channels, issues);
  const fallbackModels = splitCsv(env.LITELLM_FALLBACK_MODELS)
    .flatMap((value) => {
      const ref = parseOptionalModelRef("LITELLM_FALLBACK_MODELS", value, channels, issues);
      return ref === null ? [] : [ref];
    });
  const agentModel = parseOptionalModelRef("AGENT_LITELLM_MODEL", env.AGENT_LITELLM_MODEL, channels, issues);

  return Object.freeze({
    channels: Object.freeze(channels),
    primaryModel,
    fallbackModels: Object.freeze(dedupeModelRefs(fallbackModels)),
    agentModel,
    issues: Object.freeze(issues),
  });
}

export function parseLlmEnvFileText(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of text.split(/\r?\n/u)) {
    const parsed = parseEnvLine(line);
    if (parsed === null) continue;
    env[parsed.key] = parsed.value;
  }
  return env;
}

export function buildLlmDeploymentOrder(settings: LlmSettings): ReadonlyArray<LlmDeployment> {
  const channelsByName = new Map(settings.channels.map((channel) => [channel.name, channel]));
  return Object.freeze(
    dedupeModelRefs([
      ...(settings.primaryModel ? [settings.primaryModel] : []),
      ...settings.fallbackModels,
    ]).flatMap((ref) => {
      const channel = channelsByName.get(ref.channel);
      if (!channel || !channel.enabled) return [];
      return [
        Object.freeze({
          channel: channel.name,
          model: ref.model,
          protocol: channel.protocol,
          baseUrl: channel.baseUrl,
          apiKeys: channel.apiKeys,
        }),
      ];
    }),
  );
}

function parseEnvLine(line: string): { key: string; value: string } | null {
  const trimmed = line.trim();
  if (trimmed === "" || trimmed.startsWith("#")) return null;
  const equalsIndex = trimmed.indexOf("=");
  if (equalsIndex === -1) return null;
  const key = trimmed.slice(0, equalsIndex).trim();
  if (!/^[A-Z_][A-Z0-9_]*$/u.test(key)) return null;
  return {
    key,
    value: unquoteEnvValue(trimmed.slice(equalsIndex + 1).trim()),
  };
}

function unquoteEnvValue(value: string): string {
  if (value.length < 2) return value;
  const quote = value[0];
  if ((quote !== "\"" && quote !== "'") || value[value.length - 1] !== quote) return value;
  return value.slice(1, -1);
}

function parseChannels(env: LlmEnv, issues: string[]): LlmChannelConfig[] {
  const channels: LlmChannelConfig[] = [];
  const seen = new Set<string>();
  for (const rawName of splitCsv(env.LLM_CHANNELS)) {
    const name = normalizeChannelName(rawName);
    if (name === "") continue;
    if (seen.has(name)) {
      issues.push(`LLM_CHANNELS: duplicate channel '${name}' ignored`);
      continue;
    }
    seen.add(name);
    channels.push(channelFromEnv(env, name));
  }
  return channels;
}

function channelFromEnv(env: LlmEnv, name: string): LlmChannelConfig {
  const envName = channelEnvName(name);
  return Object.freeze({
    name,
    envName,
    protocol: readTrimmed(env[`LLM_${envName}_PROTOCOL`]) ?? "openai-compatible",
    baseUrl: readTrimmed(env[`LLM_${envName}_BASE_URL`]),
    apiKeys: Object.freeze([
      ...splitCsv(env[`LLM_${envName}_API_KEY`]),
      ...splitCsv(env[`LLM_${envName}_API_KEYS`]),
    ]),
    models: Object.freeze(splitCsv(env[`LLM_${envName}_MODELS`])),
    enabled: parseEnabled(env[`LLM_${envName}_ENABLED`]),
  });
}

function parseOptionalModelRef(
  field: string,
  value: string | undefined,
  channels: ReadonlyArray<LlmChannelConfig>,
  issues: string[],
): LlmModelRef | null {
  const trimmed = readTrimmed(value);
  if (trimmed === null) return null;
  const slashIndex = trimmed.indexOf("/");
  if (slashIndex !== -1) {
    const channelName = normalizeChannelName(trimmed.slice(0, slashIndex));
    const model = trimmed.slice(slashIndex + 1).trim();
    if (channelName === "" || model === "") {
      issues.push(`${field}: invalid model reference '${trimmed}'`);
      return null;
    }
    return validateExplicitModelRef(field, { channel: channelName, model }, channels, issues);
  }
  return inferModelRef(field, trimmed, channels, issues);
}

function validateExplicitModelRef(
  field: string,
  ref: LlmModelRef,
  channels: ReadonlyArray<LlmChannelConfig>,
  issues: string[],
): LlmModelRef | null {
  const channel = channels.find((candidate) => candidate.name === ref.channel);
  if (!channel) {
    issues.push(`${field}: channel '${ref.channel}' is not configured`);
    return null;
  }
  if (!channel.enabled) {
    issues.push(`${field}: channel '${ref.channel}' is disabled`);
    return null;
  }
  if (channel.models.length > 0 && !channel.models.includes(ref.model)) {
    issues.push(`${field}: model '${ref.model}' is not listed for channel '${ref.channel}'`);
    return null;
  }
  return Object.freeze(ref);
}

function inferModelRef(
  field: string,
  model: string,
  channels: ReadonlyArray<LlmChannelConfig>,
  issues: string[],
): LlmModelRef | null {
  const matches = channels.filter((channel) => channel.enabled && channel.models.includes(model));
  if (matches.length === 1) {
    return Object.freeze({ channel: matches[0].name, model });
  }
  if (matches.length > 1) {
    issues.push(`${field}: model '${model}' matches multiple enabled channels`);
    return null;
  }
  issues.push(`${field}: model '${model}' does not match any enabled channel`);
  return null;
}

function dedupeModelRefs(refs: ReadonlyArray<LlmModelRef>): LlmModelRef[] {
  const seen = new Set<string>();
  const output: LlmModelRef[] = [];
  for (const ref of refs) {
    const key = `${ref.channel}/${ref.model}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(ref);
  }
  return output;
}

function normalizeChannelName(value: string): string {
  return value.trim().toLowerCase();
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

function readTrimmed(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseEnabled(value: string | undefined): boolean {
  const trimmed = value?.trim().toLowerCase();
  if (trimmed === undefined || trimmed === "") return true;
  return !["0", "false", "no", "off"].includes(trimmed);
}
