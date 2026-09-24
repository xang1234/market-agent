import { DEFAULT_LIMITS } from "./policy.ts";
import { DiscoveryError, type Limits, type ModelConfigSnapshot, type RunConfigurationSnapshot } from "./types.ts";

const roles = new Set<ModelConfigSnapshot["role"]>(["planner", "scout", "analyst", "skeptic", "summary"]);
const resources = ["search", "document", "identity", "financial", "model"] as const;

/** Validates the server-composed, secret-free audit configuration before persistence. */
export function snapshotRunConfiguration(value: unknown): RunConfigurationSnapshot {
  if (!isRecord(value) || !hasExactKeys(value, ["model_config", "limits"])) throw new DiscoveryError("validation", "run configuration is invalid");
  if (!Array.isArray(value.model_config)) throw new DiscoveryError("validation", "model_config is invalid");
  return { model_config: value.model_config.map(modelConfigFromValue), limits: limitsFromValue(value.limits) };
}

export function defaultRunConfiguration(): RunConfigurationSnapshot {
  return { model_config: [], limits: structuredClone(DEFAULT_LIMITS) };
}

function modelConfigFromValue(value: unknown): ModelConfigSnapshot {
  if (!isRecord(value) || !hasExactKeys(value, ["role", "provider", "model", "max_output_tokens", "as_of"])) throw new DiscoveryError("validation", "model_config is invalid");
  if (!roles.has(value.role as ModelConfigSnapshot["role"]) || !shortText(value.provider) || !shortText(value.model) || !Number.isInteger(value.max_output_tokens) || value.max_output_tokens < 1 || value.max_output_tokens > 10_000 || !isoTimestamp(value.as_of)) {
    throw new DiscoveryError("validation", "model_config is invalid");
  }
  return { role: value.role as ModelConfigSnapshot["role"], provider: value.provider, model: value.model, max_output_tokens: value.max_output_tokens, as_of: value.as_of };
}

function limitsFromValue(value: unknown): Limits {
  if (!isRecord(value) || !hasExactKeys(value, ["candidates", "research", "shortlist", "attempts", "input_chars", "output_tokens", "request_timeout_ms", "run_timeout_ms"]) || !isRecord(value.attempts) || !hasExactKeys(value.attempts, resources)) throw new DiscoveryError("validation", "limits are invalid");
  const fields = ["candidates", "research", "shortlist", "input_chars", "output_tokens", "request_timeout_ms", "run_timeout_ms"] as const;
  if (fields.some((field) => !Number.isInteger(value[field]) || value[field] < 1) || resources.some((resource) => !Number.isInteger(value.attempts[resource]) || value.attempts[resource] < 1)) throw new DiscoveryError("validation", "limits are invalid");
  return structuredClone(value) as Limits;
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean { return Object.keys(value).length === keys.length && keys.every((key) => key in value); }
function shortText(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0 && value.length <= 200; }
function isoTimestamp(value: unknown): value is string { return typeof value === "string" && Number.isFinite(Date.parse(value)); }
