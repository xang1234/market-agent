import type { QueryResult } from "pg";
import { assertSubjectRef, type SubjectRef } from "../../resolver/src/subject-ref.ts";
import type { JsonValue } from "../../observability/src/types.ts";
import { CadenceValidationError, compileAgentCadence } from "./cadence.ts";

export type QueryExecutor = {
  query<R extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<R>>;
};

export class AgentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentValidationError";
  }
}

export class AgentNotFoundError extends Error {
  constructor(message = "agent not found") {
    super(message);
    this.name = "AgentNotFoundError";
  }
}

export type StaticAgentUniverse = {
  mode: "static";
  subject_refs: ReadonlyArray<SubjectRef>;
};

export type ScreenAgentUniverse = {
  mode: "screen";
  screen_id: string;
};

export type ThemeAgentUniverse = {
  mode: "theme";
  theme_id: string;
};

export type PortfolioAgentUniverse = {
  mode: "portfolio";
  portfolio_id: string;
};

export type AgentMirrorUniverse = {
  mode: "agent";
  agent_id: string;
};

export type AgentUniverse =
  | StaticAgentUniverse
  | ScreenAgentUniverse
  | ThemeAgentUniverse
  | PortfolioAgentUniverse
  | AgentMirrorUniverse;

export type AgentInput = {
  user_id: string;
  name: string;
  thesis: string;
  universe: AgentUniverse;
  source_policy?: JsonValue | null;
  cadence: string;
  prompt_template?: string | null;
  alert_rules?: JsonValue;
  watermarks?: JsonValue;
  enabled?: boolean;
};

export type AgentUpdate = {
  name?: string;
  thesis?: string;
  universe?: AgentUniverse;
  source_policy?: JsonValue;
  cadence?: string;
  prompt_template?: string;
  alert_rules?: JsonValue;
  enabled?: boolean;
};

export type AgentRow = {
  agent_id: string;
  user_id: string;
  name: string;
  thesis: string;
  universe: AgentUniverse;
  source_policy: JsonValue | null;
  cadence: string;
  prompt_template: string | null;
  alert_rules: JsonValue;
  watermarks: JsonValue;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

type AgentDbRow = {
  agent_id: string;
  user_id: string;
  name: string;
  thesis: string;
  universe: unknown;
  source_policy: JsonValue | null;
  cadence: string;
  prompt_template: string | null;
  alert_rules: JsonValue;
  watermarks: JsonValue;
  enabled: boolean;
  created_at: Date | string;
  updated_at: Date | string;
};

const SELECT_COLUMNS = `agent_id::text as agent_id,
       user_id::text as user_id,
       name,
       thesis,
       universe,
       source_policy,
       cadence,
       prompt_template,
       alert_rules,
       watermarks,
       enabled,
       created_at,
       updated_at`;

export async function createAgent(db: QueryExecutor, input: AgentInput): Promise<AgentRow> {
  assertAgentInput(input);
  const { rows } = await db.query<AgentDbRow>(
    `insert into agents
       (user_id, name, thesis, cadence, universe, source_policy, prompt_template,
        alert_rules, watermarks, enabled)
     values ($1::uuid, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8::jsonb, $9::jsonb, $10)
     returning ${SELECT_COLUMNS}`,
    [
      input.user_id,
      input.name,
      input.thesis,
      input.cadence,
      JSON.stringify(input.universe),
      serializeOptionalJson(input.source_policy),
      input.prompt_template ?? null,
      JSON.stringify(input.alert_rules ?? []),
      JSON.stringify(input.watermarks ?? {}),
      input.enabled ?? true,
    ],
  );
  return rowFromDb(rows[0]);
}

export async function getAgent(db: QueryExecutor, agentId: string): Promise<AgentRow | null> {
  assertUuidString(agentId, "agent_id");
  const { rows } = await db.query<AgentDbRow>(
    `select ${SELECT_COLUMNS}
       from agents
      where agent_id = $1::uuid`,
    [agentId],
  );
  return rows[0] ? rowFromDb(rows[0]) : null;
}

export async function listAgentsByUser(
  db: QueryExecutor,
  userId: string,
): Promise<ReadonlyArray<AgentRow>> {
  assertUuidString(userId, "user_id");
  const { rows } = await db.query<AgentDbRow>(
    `select ${SELECT_COLUMNS}
       from agents
      where user_id = $1::uuid
      order by created_at desc, agent_id asc`,
    [userId],
  );
  return Object.freeze(rows.map(rowFromDb));
}

export async function updateAgent(
  db: QueryExecutor,
  agentId: string,
  patch: AgentUpdate,
): Promise<AgentRow> {
  assertUuidString(agentId, "agent_id");
  validateAgentUpdate(patch);
  const { rows } = await db.query<AgentDbRow>(
    `update agents
        set name = coalesce($2, name),
            thesis = coalesce($3, thesis),
            cadence = coalesce($4, cadence),
            universe = coalesce($5::jsonb, universe),
            source_policy = coalesce($6::jsonb, source_policy),
            prompt_template = coalesce($7, prompt_template),
            alert_rules = coalesce($8::jsonb, alert_rules),
            enabled = coalesce($9, enabled),
            updated_at = now()
      where agent_id = $1::uuid
      returning ${SELECT_COLUMNS}`,
    [
      agentId,
      patch.name ?? null,
      patch.thesis ?? null,
      patch.cadence ?? null,
      patch.universe === undefined ? null : JSON.stringify(patch.universe),
      serializePatchJson(patch, "source_policy"),
      patch.prompt_template ?? null,
      patch.alert_rules === undefined ? null : JSON.stringify(patch.alert_rules),
      patch.enabled ?? null,
    ],
  );
  if (rows.length === 0) throw new AgentNotFoundError();
  return rowFromDb(rows[0]);
}

export async function disableAgent(db: QueryExecutor, agentId: string): Promise<AgentRow> {
  assertUuidString(agentId, "agent_id");
  const { rows } = await db.query<AgentDbRow>(
    `update agents
        set enabled = false,
            updated_at = now()
      where agent_id = $1::uuid
      returning ${SELECT_COLUMNS}`,
    [agentId],
  );
  if (rows.length === 0) throw new AgentNotFoundError();
  return rowFromDb(rows[0]);
}

export function assertAgentInput(input: AgentInput): void {
  assertUuidString(input.user_id, "user_id");
  assertNonEmptyString(input.name, "name");
  assertNonEmptyString(input.thesis, "thesis");
  assertNonEmptyString(input.cadence, "cadence");
  assertSupportedCadence(input.cadence);
  assertAgentUniverse(input.universe, "universe");
  if (input.prompt_template !== undefined && input.prompt_template !== null) {
    assertNonEmptyString(input.prompt_template, "prompt_template");
  }
}

function validateAgentUpdate(patch: AgentUpdate): void {
  const keys = Object.keys(patch).filter((key) => (patch as Record<string, unknown>)[key] !== undefined);
  if (keys.length === 0) {
    throw new AgentValidationError("patch must contain at least one mutable field");
  }
  if (patch.name !== undefined) assertNonEmptyString(patch.name, "name");
  if (patch.thesis !== undefined) assertNonEmptyString(patch.thesis, "thesis");
  if (patch.cadence !== undefined) assertNonEmptyString(patch.cadence, "cadence");
  if (patch.cadence !== undefined) assertSupportedCadence(patch.cadence);
  if (patch.universe !== undefined) assertAgentUniverse(patch.universe, "universe");
  if (patch.prompt_template !== undefined && patch.prompt_template !== null) {
    assertNonEmptyString(patch.prompt_template, "prompt_template");
  }
  if (patch.prompt_template === null) {
    throw new AgentValidationError("prompt_template: null clears are not supported by updateAgent");
  }
  if (patch.source_policy === null) {
    throw new AgentValidationError("source_policy: null clears are not supported by updateAgent");
  }
}

export function assertAgentUniverse(value: unknown, label: string): asserts value is AgentUniverse {
  if (value === null || typeof value !== "object") {
    throw new AgentValidationError(`${label}: must be an object`);
  }
  const raw = value as Record<string, unknown>;
  if (raw.mode === "static") {
    assertSubjectRefArray(raw.subject_refs, `${label}.subject_refs`);
    return;
  }
  if (raw.mode === "screen") {
    assertUuidString(raw.screen_id, `${label}.screen_id`);
    return;
  }
  if (raw.mode === "theme") {
    assertUuidString(raw.theme_id, `${label}.theme_id`);
    return;
  }
  if (raw.mode === "portfolio") {
    assertUuidString(raw.portfolio_id, `${label}.portfolio_id`);
    return;
  }
  if (raw.mode === "agent") {
    assertUuidString(raw.agent_id, `${label}.agent_id`);
    return;
  }
  throw new AgentValidationError(`${label}.mode: must be static, screen, theme, portfolio, or agent`);
}

function assertSubjectRefArray(value: unknown, label: string): asserts value is ReadonlyArray<SubjectRef> {
  if (!Array.isArray(value)) {
    throw new AgentValidationError(`${label}: must be an array of subject refs`);
  }
  value.forEach((ref, index) => {
    try {
      assertSubjectRef(ref, `${label}[${index}]`);
    } catch (error) {
      throw new AgentValidationError(error instanceof Error ? error.message : String(error));
    }
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertUuidString(value: unknown, label: string): asserts value is string {
  assertNonEmptyString(value, label);
  if (!UUID_RE.test(value)) {
    throw new AgentValidationError(`${label}: must be a UUID`);
  }
}

function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new AgentValidationError(`${label}: must be a non-empty string`);
  }
}

function assertSupportedCadence(cadence: string): void {
  try {
    compileAgentCadence(cadence);
  } catch (error) {
    if (error instanceof CadenceValidationError) {
      throw new AgentValidationError(error.message);
    }
    throw error;
  }
}

function serializeOptionalJson(value: JsonValue | null | undefined): string | null {
  return value === undefined || value === null ? null : JSON.stringify(value);
}

function serializePatchJson(patch: AgentUpdate, key: "source_policy"): string | null {
  const value = patch[key];
  if (value === undefined) return null;
  return JSON.stringify(value);
}

function rowFromDb(row: AgentDbRow | undefined): AgentRow {
  if (!row) throw new Error("agents insert/select did not return a row");
  const universe = freezeJson(row.universe) as AgentUniverse;
  assertAgentUniverse(universe, "agent.universe");
  return Object.freeze({
    agent_id: row.agent_id,
    user_id: row.user_id,
    name: row.name,
    thesis: row.thesis,
    universe,
    source_policy: freezeJson(row.source_policy) as JsonValue | null,
    cadence: row.cadence,
    prompt_template: row.prompt_template,
    alert_rules: freezeJson(row.alert_rules ?? []) as JsonValue,
    watermarks: freezeJson(row.watermarks ?? {}) as JsonValue,
    enabled: row.enabled,
    created_at: serializeDate(row.created_at),
    updated_at: serializeDate(row.updated_at),
  });
}

function freezeJson(value: unknown): unknown {
  if (value !== null && typeof value === "object") {
    if (Array.isArray(value)) {
      for (const item of value) freezeJson(item);
    } else {
      for (const item of Object.values(value)) freezeJson(item);
    }
    return Object.freeze(value);
  }
  return value;
}

function serializeDate(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}
