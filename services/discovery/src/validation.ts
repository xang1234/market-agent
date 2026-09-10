import { parseThesisConditions, type ThesisMetricCheck } from "../../agents/src/thesis-types.ts";
import type { LlmChatMessage } from "../../llm/src/router.ts";
import { DiscoveryError, type Brief, type Criterion, type Mechanism } from "./types.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseBrief(value: unknown): Brief {
  const brief = record(value, "brief", [
    "schema_version", "question", "market", "horizon_months", "lookback_months", "mechanisms", "criteria",
    "seed_queries", "exclusions", "preferences", "queries",
  ]);
  const mechanisms = array(brief.mechanisms, "brief.mechanisms", 2, 4).map(parseMechanism);
  const mechanismIds = new Set<string>();
  for (const mechanism of mechanisms) {
    if (mechanismIds.has(mechanism.mechanism_id)) invalid("brief.mechanisms mechanism_id must be unique");
    mechanismIds.add(mechanism.mechanism_id);
  }
  const criteria = array(brief.criteria, "brief.criteria", 1, 8).map(parseCriterion);
  const criterionIds = new Set<string>();
  for (const criterion of criteria) {
    if (criterionIds.has(criterion.criterion_id)) invalid("brief.criteria criterion_id must be unique");
    criterionIds.add(criterion.criterion_id);
  }
  const queries = array(brief.queries, "brief.queries", 1, 20).map((value, index) => {
    const query = record(value, `brief.queries[${index}]`, ["mechanism_id", "query"]);
    const mechanism_id = uuid(query.mechanism_id, `brief.queries[${index}].mechanism_id`);
    if (!mechanismIds.has(mechanism_id)) invalid(`brief.queries[${index}].mechanism_id is not declared`);
    const text = textValue(query.query, `brief.queries[${index}].query`, 1, 600);
    if (text.split(/\s+/u).length > 75) invalid(`brief.queries[${index}].query must contain at most 75 words`);
    return { mechanism_id, query: text };
  });
  for (const mechanismId of mechanismIds) {
    if (!queries.some((query) => query.mechanism_id === mechanismId)) invalid("every mechanism must have a query");
  }
  if (brief.schema_version !== 1) invalid("brief.schema_version must be 1");
  if (brief.market !== "us_listed") invalid("brief.market must be us_listed");
  return {
    schema_version: 1,
    question: textValue(brief.question, "brief.question", 20, 4_000),
    market: "us_listed",
    horizon_months: integer(brief.horizon_months, "brief.horizon_months", 1, 60),
    lookback_months: integer(brief.lookback_months, "brief.lookback_months", 1, 24),
    mechanisms,
    criteria,
    seed_queries: stringArray(brief.seed_queries, "brief.seed_queries", 0, 5, 1, 200),
    exclusions: stringArray(brief.exclusions, "brief.exclusions", 0, 10, 1, 300),
    preferences: stringArray(brief.preferences, "brief.preferences", 0, 10, 1, 300),
    queries,
  };
}

export function validateModelRequest(messages: LlmChatMessage[], maxTokens: number): void {
  if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 10_000) {
    invalid("maxTokens must be an integer between 1 and 10000");
  }
  if (!Array.isArray(messages) || messages.length === 0) invalid("messages must be a non-empty array");
  for (const [index, message] of messages.entries()) {
    const value = record(message, `messages[${index}]`, ["role", "content"]);
    if (value.role !== "system" && value.role !== "user" && value.role !== "assistant") invalid(`messages[${index}].role is invalid`);
    textValue(value.content, `messages[${index}].content`, 1, 64_000);
  }
  if (JSON.stringify(messages).length > 64_000) invalid("messages exceed 64000 input characters");
}

function parseMechanism(value: unknown, index: number): Mechanism {
  const mechanism = record(value, `brief.mechanisms[${index}]`, ["mechanism_id", "label", "chain"]);
  return {
    mechanism_id: uuid(mechanism.mechanism_id, `brief.mechanisms[${index}].mechanism_id`),
    label: textValue(mechanism.label, `brief.mechanisms[${index}].label`, 1, 160),
    chain: stringArray(mechanism.chain, `brief.mechanisms[${index}].chain`, 2, 5, 1, 300),
  };
}

function parseCriterion(value: unknown, index: number): Criterion {
  const criterion = record(value, `brief.criteria[${index}]`, ["criterion_id", "importance", "statement", "falsifier", "metric"]);
  if (criterion.importance !== "must" && criterion.importance !== "prefer") invalid(`brief.criteria[${index}].importance is invalid`);
  const parsed: Criterion = {
    criterion_id: uuid(criterion.criterion_id, `brief.criteria[${index}].criterion_id`),
    importance: criterion.importance,
    statement: textValue(criterion.statement, `brief.criteria[${index}].statement`, 8, 1_000),
    falsifier: textValue(criterion.falsifier, `brief.criteria[${index}].falsifier`, 8, 1_000),
  };
  if (criterion.metric !== undefined) {
    record(criterion.metric, `brief.criteria[${index}].metric`, ["metric_key", "unit", "period_kind", "operator", "threshold", "max_age_days"]);
    try {
      parsed.metric = parseThesisConditions([{
        condition_id: parsed.criterion_id,
        statement: parsed.statement,
        falsifier: parsed.falsifier,
        horizon: "campaign",
        metric: criterion.metric,
      }])[0]?.metric as ThesisMetricCheck;
    } catch (error) {
      invalid(error instanceof Error ? error.message : "metric is invalid");
    }
  }
  return parsed;
}

function record(value: unknown, label: string, allowed: string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) invalid(`${label} must be an object`);
  const object = value as Record<string, unknown>;
  for (const key of Object.keys(object)) if (!allowed.includes(key)) invalid(`${label}.${key} is not allowed`);
  for (const key of allowed) if (!(key in object) && key !== "metric") invalid(`${label}.${key} is required`);
  return object;
}

function array(value: unknown, label: string, min: number, max: number): unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) invalid(`${label} must contain between ${min} and ${max} items`);
  return value;
}

function stringArray(value: unknown, label: string, min: number, max: number, itemMin: number, itemMax: number): string[] {
  return array(value, label, min, max).map((item, index) => textValue(item, `${label}[${index}]`, itemMin, itemMax));
}

function uuid(value: unknown, label: string): string {
  if (typeof value !== "string" || !UUID_RE.test(value)) invalid(`${label} must be a UUID`);
  return value;
}

function textValue(value: unknown, label: string, min: number, max: number): string {
  if (typeof value !== "string" || value !== value.trim() || value.length < min || value.length > max) {
    invalid(`${label} must be trimmed and between ${min} and ${max} characters`);
  }
  return value;
}

function integer(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) invalid(`${label} must be an integer between ${min} and ${max}`);
  return value;
}

function invalid(message: string): never {
  throw new DiscoveryError("validation", message);
}
