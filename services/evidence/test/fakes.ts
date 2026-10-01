import type { QueryResult } from "pg";

// A hand-written fake decides which rows come back for a query; asserting
// them as the caller's row type R is the test double's contract, kept in
// this one place (the #116 fakeQuery convention).
export function fakeRows<R>(rows: readonly unknown[]): R[] {
  return rows as R[];
}

type FakeResult = { rows: unknown[]; rowCount?: number | null };

// Adapts a hand-written fake to QueryExecutor's generic `query<R>()`, which
// returns a full pg QueryResult.
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
