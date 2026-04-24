import type { QueryResult } from "pg";
import type { SubjectKind, SubjectRef } from "./subject-ref.ts";

// Matches the resolver's minimal queryable surface. `pg.Client` or `pg.Pool`
// both satisfy it; tests stub it without importing the full pg type surface.
export type QueryExecutor = {
  query<R extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<R>>;
};

export class WatchlistNotFoundError extends Error {
  constructor(message = "default manual watchlist not provisioned for user") {
    super(message);
    this.name = "WatchlistNotFoundError";
  }
}

export class MemberNotFoundError extends Error {
  constructor(message = "watchlist member not found") {
    super(message);
    this.name = "MemberNotFoundError";
  }
}

// Locates the implicit default manual watchlist. The 0003 migration enforces
// at most one manual watchlist per user, so this row is unique when present.
export async function findDefaultManualWatchlistId(
  db: QueryExecutor,
  userId: string,
): Promise<string> {
  const result = await db.query<{ watchlist_id: string }>(
    `select watchlist_id
       from watchlists
      where user_id = $1 and mode = 'manual'
      limit 1`,
    [userId],
  );
  const row = result.rows[0];
  if (!row) throw new WatchlistNotFoundError();
  return row.watchlist_id;
}

export type WatchlistMember = {
  subject_ref: SubjectRef;
  created_at: string;
};

export async function listMembers(
  db: QueryExecutor,
  watchlistId: string,
): Promise<WatchlistMember[]> {
  const result = await db.query<{
    subject_kind: SubjectKind;
    subject_id: string;
    created_at: Date | string;
  }>(
    `select subject_kind, subject_id, created_at
       from watchlist_members
      where watchlist_id = $1
      order by created_at asc, watchlist_member_id asc`,
    [watchlistId],
  );

  return result.rows.map((row) => ({
    subject_ref: { kind: row.subject_kind, id: row.subject_id },
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  }));
}

export type AddMemberResult =
  | { status: "created"; member: WatchlistMember }
  | { status: "already_present"; member: WatchlistMember };

// Idempotent at (watchlist_id, subject_kind, subject_id) by the schema's
// unique constraint. `insert ... on conflict do nothing returning` would omit
// the row on conflict, so we detect conflict via zero rows returned and re-read.
export async function addMember(
  db: QueryExecutor,
  watchlistId: string,
  subjectRef: SubjectRef,
): Promise<AddMemberResult> {
  const insert = await db.query<{ created_at: Date | string }>(
    `insert into watchlist_members (watchlist_id, subject_kind, subject_id)
     values ($1, $2, $3)
     on conflict (watchlist_id, subject_kind, subject_id) do nothing
     returning created_at`,
    [watchlistId, subjectRef.kind, subjectRef.id],
  );

  if (insert.rows.length === 1) {
    return {
      status: "created",
      member: {
        subject_ref: subjectRef,
        created_at:
          insert.rows[0].created_at instanceof Date
            ? insert.rows[0].created_at.toISOString()
            : String(insert.rows[0].created_at),
      },
    };
  }

  const existing = await db.query<{ created_at: Date | string }>(
    `select created_at
       from watchlist_members
      where watchlist_id = $1 and subject_kind = $2 and subject_id = $3`,
    [watchlistId, subjectRef.kind, subjectRef.id],
  );
  const row = existing.rows[0];
  if (!row) throw new Error("add conflicted but existing row not found");

  return {
    status: "already_present",
    member: {
      subject_ref: subjectRef,
      created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    },
  };
}

export async function removeMember(
  db: QueryExecutor,
  watchlistId: string,
  subjectRef: SubjectRef,
): Promise<void> {
  const result = await db.query(
    `delete from watchlist_members
      where watchlist_id = $1 and subject_kind = $2 and subject_id = $3`,
    [watchlistId, subjectRef.kind, subjectRef.id],
  );
  if ((result.rowCount ?? 0) === 0) throw new MemberNotFoundError();
}
