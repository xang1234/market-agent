// Test-double adapters for the generic `query<R>()` signature the repositories
// declare (the #116 fakeQuery convention). A hand-written fake decides which rows
// come back; asserting them as the caller's row type R is the double's contract,
// kept in this one place. Shared across services' tests, like db/test/docker-pg.ts.
import type { QueryResult } from "pg";

type FakeResult = { rows: readonly unknown[]; rowCount?: number | null };

export function fakeRows<R>(rows: readonly unknown[]): R[] {
  return rows as R[];
}

// For row-only executors: `query<R>(...) => Promise<{ rows: R[] }>`.
export function fakeQuery(
  handler: (text: string, values?: unknown[]) => FakeResult | Promise<FakeResult>,
) {
  return async <R,>(text: string, values?: unknown[]): Promise<{ rows: R[]; rowCount?: number }> => {
    const result = await handler(text, values);
    return { rows: fakeRows<R>(result.rows), ...(typeof result.rowCount === "number" ? { rowCount: result.rowCount } : {}) };
  };
}

// For executors returning a full pg QueryResult.
export function fakePgQuery(
  handler: (text: string, values?: unknown[]) => FakeResult | Promise<FakeResult>,
) {
  return async <R extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<R>> => {
    const result = await handler(text, values);
    return { command: "", oid: 0, fields: [], rowCount: result.rowCount ?? null, rows: fakeRows<R>(result.rows) };
  };
}
