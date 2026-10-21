// The engine's one way to run SQL atomically. Callers pass a pinned client;
// the action's writes commit together or not at all.

import { snapshotTransactionClient, type SnapshotTransactionClient } from "../../snapshot/src/snapshot-sealer.ts";
import type { FinancialPool, SqlExecutor } from "./ports.ts";

/**
 * Lends one pool client to `action`. pg reports a lost connection as an
 * "error" event on the client as well as by failing the query, and an unheard
 * event throws out of the process, so the client is heard while it is held;
 * `lost()` returns the first error heard.
 */
export async function withPinnedClient<T>(
  pool: FinancialPool,
  action: (client: SnapshotTransactionClient, lost: () => Error | null) => Promise<T>,
): Promise<T> {
  const connection = await pool.connect();
  let heard: Error | null = null;
  const onError = (error: Error) => {
    heard ??= error;
  };
  connection.on?.("error", onError);
  try {
    return await action(snapshotTransactionClient(connection), () => heard);
  } finally {
    connection.off?.("error", onError);
    connection.release(heard ?? undefined);
  }
}

export async function withTransaction<T>(
  client: SqlExecutor,
  action: () => Promise<T>,
  options: { isolation?: "repeatable read" } = {},
): Promise<T> {
  await client.query(options.isolation ? `begin isolation level ${options.isolation}` : "begin");
  try {
    const result = await action();
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

// Postgres errors a retry gets past while the connection stays usable: a
// serialization or deadlock rollback, a lock timeout, a full disk, exhausted
// memory, or a storage I/O fault. Each rolls the statement back, so a retry,
// or recovery until the fault clears, is safe.
const TRANSIENT_SQLSTATES: ReadonlySet<string> = new Set(["40001", "40P01", "55P03", "53100", "53200", "58030"]);

export function isTransientDatabaseError(error: unknown): boolean {
  return typeof error === "object" && error !== null && TRANSIENT_SQLSTATES.has(String((error as { code?: unknown }).code));
}
