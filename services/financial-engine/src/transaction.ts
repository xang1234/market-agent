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
