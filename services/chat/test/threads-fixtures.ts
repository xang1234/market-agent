import type { ChatThreadsDb } from "../src/threads-repo.ts";

export const USER_ID = "11111111-1111-4111-a111-111111111111";
export const THREAD_ID = "22222222-2222-4222-a222-222222222222";
export const SNAPSHOT_ID = "33333333-3333-4333-a333-333333333333";
export const SUBJECT_ID = "44444444-4444-4444-a444-444444444444";

export type RecordedQuery = { text: string; values?: unknown[] };

export function fakeDb(handler: (query: RecordedQuery) => unknown[]): {
  db: ChatThreadsDb;
  queries: RecordedQuery[];
} {
  const queries: RecordedQuery[] = [];
  const db: ChatThreadsDb = {
    async query(text: string, values?: unknown[]) {
      const query = { text, values };
      queries.push(query);
      const rows = handler(query);
      return { rows: rows as Record<string, unknown>[], rowCount: rows.length };
    },
  };
  return { db, queries };
}

export function buildRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    thread_id: THREAD_ID,
    user_id: USER_ID,
    primary_subject_kind: null,
    primary_subject_id: null,
    title: null,
    latest_snapshot_id: null,
    archived_at: null,
    created_at: "2026-04-01T00:00:00.000Z",
    updated_at: "2026-04-01T00:00:00.000Z",
    ...overrides,
  };
}
