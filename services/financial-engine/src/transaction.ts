// The engine's one way to run SQL atomically. Callers pass a pinned client;
// the action's writes commit together or not at all.

import type { SqlExecutor } from "./ports.ts";

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
