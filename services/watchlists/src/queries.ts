import type { QueryResult } from "pg";
import { serializeNullableJsonValue, type JsonValue } from "../../observability/src/types.ts";
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

export class WatchlistValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WatchlistValidationError";
  }
}

export class DefaultWatchlistDeleteError extends Error {
  constructor(message = "cannot delete the implicit default watchlist") {
    super(message);
    this.name = "DefaultWatchlistDeleteError";
  }
}

export class MemberNotFoundError extends Error {
  constructor(message = "watchlist member not found") {
    super(message);
    this.name = "MemberNotFoundError";
  }
}

export const WATCHLIST_MODES = ["manual", "screen", "agent", "theme", "portfolio"] as const;
export type WatchlistMode = (typeof WATCHLIST_MODES)[number];

export type WatchlistInput = {
  name: string;
  mode: WatchlistMode;
  membership_spec?: JsonValue | null;
};

export type WatchlistRow = {
  watchlist_id: string;
  user_id: string;
  name: string;
  mode: WatchlistMode;
  is_default: boolean;
  membership_spec: JsonValue | null;
  created_at: string;
  updated_at: string;
};

type WatchlistDbRow = {
  watchlist_id: string;
  user_id: string;
  name: string;
  mode: WatchlistMode;
  is_default: boolean;
  membership_spec: JsonValue | null;
  created_at: Date | string;
  updated_at: Date | string;
};

const WATCHLIST_SELECT_COLUMNS = `watchlist_id::text as watchlist_id,
       user_id::text as user_id,
       name,
       mode,
       is_default,
       membership_spec,
       created_at,
       updated_at`;

// Locates the implicit default manual watchlist. fra-wlc allows multiple
// manual lists per user, so the default discriminator is is_default rather
// than mode='manual'.
export async function findDefaultManualWatchlistId(
  db: QueryExecutor,
  userId: string,
): Promise<string> {
  const result = await db.query<{ watchlist_id: string }>(
    `select watchlist_id
       from watchlists
      where user_id = $1 and mode = 'manual' and is_default
      limit 1`,
    [userId],
  );
  const row = result.rows[0];
  if (!row) throw new WatchlistNotFoundError();
  return row.watchlist_id;
}

export async function listWatchlists(
  db: QueryExecutor,
  userId: string,
): Promise<ReadonlyArray<WatchlistRow>> {
  const result = await db.query<WatchlistDbRow>(
    `select ${WATCHLIST_SELECT_COLUMNS}
       from watchlists
      where user_id = $1
      order by is_default desc, created_at asc, watchlist_id asc`,
    [userId],
  );
  return Object.freeze(result.rows.map(watchlistRowFromDb));
}

export async function createWatchlist(
  db: QueryExecutor,
  userId: string,
  input: WatchlistInput,
): Promise<WatchlistRow> {
  validateWatchlistInput(input);
  const result = await db.query<WatchlistDbRow>(
    `insert into watchlists (user_id, name, mode, membership_spec, is_default)
     values ($1, $2, $3::watchlist_mode, $4::jsonb, $5)
     returning ${WATCHLIST_SELECT_COLUMNS}`,
    [
      userId,
      input.name.trim(),
      input.mode,
      serializeNullableJsonValue(input.membership_spec),
      false,
    ],
  );
  return watchlistRowFromDb(result.rows[0]);
}

export async function renameWatchlist(
  db: QueryExecutor,
  userId: string,
  watchlistId: string,
  name: string,
): Promise<WatchlistRow> {
  const nextName = assertWatchlistName(name);
  const result = await db.query<WatchlistDbRow>(
    `update watchlists
        set name = $3,
            updated_at = now()
      where watchlist_id = $1 and user_id = $2
      returning ${WATCHLIST_SELECT_COLUMNS}`,
    [watchlistId, userId, nextName],
  );
  const row = result.rows[0];
  if (!row) throw new WatchlistNotFoundError("watchlist not found");
  return watchlistRowFromDb(row);
}

export async function deleteWatchlist(
  db: QueryExecutor,
  userId: string,
  watchlistId: string,
): Promise<void> {
  const existing = await db.query<WatchlistDbRow>(
    `select ${WATCHLIST_SELECT_COLUMNS}
       from watchlists
      where watchlist_id = $1 and user_id = $2`,
    [watchlistId, userId],
  );
  const row = existing.rows[0];
  if (!row) throw new WatchlistNotFoundError("watchlist not found");
  if (row.is_default) throw new DefaultWatchlistDeleteError();

  // watchlist_members.watchlist_id is ON DELETE CASCADE, so deleting a
  // list intentionally deletes only membership rows owned by that list.
  await db.query(
    `delete from watchlists
      where watchlist_id = $1 and user_id = $2`,
    [watchlistId, userId],
  );
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

function validateWatchlistInput(input: WatchlistInput): void {
  assertWatchlistName(input.name);
  if (!WATCHLIST_MODES.includes(input.mode)) {
    throw new WatchlistValidationError(`mode: must be one of ${WATCHLIST_MODES.join(", ")}`);
  }
  if (input.mode !== "manual") {
    const spec = input.membership_spec;
    const requiredKey = `${input.mode}_id`;
    if (typeof spec !== "object" || spec === null || Array.isArray(spec)) {
      throw new WatchlistValidationError(`membership_spec.${requiredKey}: must be a non-empty string`);
    }
    const value = spec[requiredKey];
    if (typeof value !== "string" || value.length === 0) {
      throw new WatchlistValidationError(`membership_spec.${requiredKey}: must be a non-empty string`);
    }
  }
}

function assertWatchlistName(value: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new WatchlistValidationError("name: must be a non-empty string");
  }
  return value.trim();
}

function watchlistRowFromDb(row: WatchlistDbRow | undefined): WatchlistRow {
  if (!row) throw new Error("watchlists insert/select did not return a row");
  return Object.freeze({
    watchlist_id: row.watchlist_id,
    user_id: row.user_id,
    name: row.name,
    mode: row.mode,
    is_default: row.is_default,
    membership_spec: row.membership_spec,
    created_at: isoString(row.created_at),
    updated_at: isoString(row.updated_at),
  });
}

function isoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}
