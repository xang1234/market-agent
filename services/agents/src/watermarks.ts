import type { JsonValue } from "../../observability/src/types.ts";
import { AgentNotFoundError, type QueryExecutor } from "./agent-repo.ts";

const AGENT_WATERMARK_TRANSACTION_CLIENT: unique symbol = Symbol("agents.watermarkTransactionClient");

type AgentWatermarkTransactionClientBrand = {
  readonly [AGENT_WATERMARK_TRANSACTION_CLIENT]: true;
};

export type AgentWatermarkPoolClient = QueryExecutor & {
  release(error?: Error): void;
};

export type AgentWatermarkTransactionClient =
  AgentWatermarkPoolClient & AgentWatermarkTransactionClientBrand;

export type AgentWatermarkClientPool = {
  connect(): Promise<AgentWatermarkPoolClient>;
};

export class WatermarkValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WatermarkValidationError";
  }
}

export type AdvanceWatermarksInput = {
  agent_id: string;
  next_watermarks: JsonValue;
  applySideEffects(tx: QueryExecutor): Promise<void>;
};

export function advanceWatermarksTransactionClient<T extends QueryExecutor>(
  client: T,
): T & AgentWatermarkTransactionClient {
  if ((client as Partial<AgentWatermarkTransactionClientBrand>)[AGENT_WATERMARK_TRANSACTION_CLIENT] === true) {
    return client as T & AgentWatermarkTransactionClient;
  }
  if (isPoolLike(client)) {
    throw new Error(
      "advanceWatermarksWithSideEffects requires a pinned transaction client; use advanceWatermarksWithSideEffectsWithPool for pools",
    );
  }
  if (!isAcquiredClient(client)) {
    throw new Error("advanceWatermarksWithSideEffects requires an acquired transaction client with release()");
  }
  Object.defineProperty(client, AGENT_WATERMARK_TRANSACTION_CLIENT, {
    value: true,
    enumerable: false,
    configurable: false,
  });
  return client as T & AgentWatermarkTransactionClient;
}

export async function advanceWatermarksWithSideEffects(
  db: AgentWatermarkTransactionClient,
  input: AdvanceWatermarksInput,
): Promise<void> {
  assertAgentWatermarkTransactionClient(db);
  assertUuidString(input.agent_id, "agent_id");
  assertJsonObject(input.next_watermarks, "next_watermarks");

  await db.query("begin");
  try {
    await input.applySideEffects(db);
    const update = await db.query(
      `update agents
          set watermarks = $2::jsonb,
              updated_at = now()
        where agent_id = $1::uuid`,
      [input.agent_id, JSON.stringify(input.next_watermarks)],
    );
    if ((update.rowCount ?? 0) !== 1) {
      throw new AgentNotFoundError("agent not found while advancing watermarks");
    }
    await db.query("commit");
  } catch (error) {
    try {
      await db.query("rollback");
    } catch (rollbackError) {
      if (error !== null && typeof error === "object") {
        (error as { rollback_error?: unknown }).rollback_error = rollbackError;
      }
    }
    throw error;
  }
}

export async function advanceWatermarksWithSideEffectsWithPool(
  pool: AgentWatermarkClientPool,
  input: AdvanceWatermarksInput,
): Promise<void> {
  const client = await pool.connect();
  let releaseError: Error | undefined;
  try {
    return await advanceWatermarksWithSideEffects(
      advanceWatermarksTransactionClient(client),
      input,
    );
  } catch (error) {
    if (error instanceof Error && (error as { rollback_error?: unknown }).rollback_error !== undefined) {
      releaseError = error;
    }
    throw error;
  } finally {
    client.release(releaseError);
  }
}

function assertAgentWatermarkTransactionClient(
  db: QueryExecutor,
): asserts db is AgentWatermarkTransactionClient {
  if ((db as Partial<AgentWatermarkTransactionClientBrand>)[AGENT_WATERMARK_TRANSACTION_CLIENT] !== true) {
    throw new Error("advanceWatermarksWithSideEffects requires a pinned transaction client");
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertUuidString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new WatermarkValidationError(`${label}: must be a non-empty string`);
  }
  if (!UUID_RE.test(value)) {
    throw new WatermarkValidationError(`${label}: must be a UUID`);
  }
}

function assertJsonObject(value: unknown, label: string): asserts value is Record<string, JsonValue> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new WatermarkValidationError(`${label}: must be a JSON object`);
  }
}

function isPoolLike(db: QueryExecutor): boolean {
  return typeof (db as { connect?: unknown }).connect === "function" && !isAcquiredClient(db);
}

function isAcquiredClient(db: QueryExecutor): db is AgentWatermarkPoolClient {
  return typeof (db as { release?: unknown }).release === "function";
}
