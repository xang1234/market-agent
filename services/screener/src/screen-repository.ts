// Saved-screen repository (cw0.7.4 runtime).
//
// Persists ScreenSubjects (cw0.7.3) only — never row payloads. Reopen
// goes through the executor for fresh data; the repository's job is
// just to hold the canonical persisted query definition + ordering
// metadata.
//
// Mirrors the in-memory repository pattern used by services/market
// (listings) and services/fundamentals (issuer-profiles, holders, etc.).
// Production wiring would replace the in-memory map with a `screens`
// table; the interface stays the same.

import type { ScreenSubject } from "./screen-subject.ts";
import { persistScreen } from "./screen-subject.ts";
import { assertUuid } from "./validators.ts";

export type ScreenRepository = {
  save(screen: ScreenSubject): Promise<ScreenSaveResult>;
  find(screen_id: string): Promise<ScreenSubject | null>;
  listForUser(user_id: string): Promise<ReadonlyArray<ScreenSubject>>;
  delete(screen_id: string): Promise<void>;
};

// `save` is upsert: a save with the same screen_id replaces the prior
// record. Returning the resolved status lets the HTTP handler distinguish
// 201 Created from 200 OK (Replaced) without re-reading the repo.
export type ScreenSaveResult =
  | { status: "created"; screen: ScreenSubject }
  | { status: "replaced"; screen: ScreenSubject };

export class ScreenNotFoundError extends Error {
  readonly screen_id: string;
  constructor(screen_id: string) {
    super(`screen not found: ${screen_id}`);
    this.name = "ScreenNotFoundError";
    this.screen_id = screen_id;
  }
}

export function createInMemoryScreenRepository(
  initial: ReadonlyArray<ScreenSubject> = [],
): ScreenRepository {
  const byId = new Map<string, ScreenSubject>();
  for (const screen of initial) {
    if (byId.has(screen.screen_id)) {
      throw new Error(
        `createInMemoryScreenRepository: duplicate screen_id ${screen.screen_id}`,
      );
    }
    byId.set(screen.screen_id, screen);
  }

  return {
    async save(screen) {
      const existed = byId.has(screen.screen_id);
      byId.set(screen.screen_id, screen);
      return existed
        ? { status: "replaced", screen }
        : { status: "created", screen };
    },
    async find(screen_id) {
      assertUuid(screen_id, "find.screen_id");
      return byId.get(screen_id) ?? null;
    },
    async listForUser(user_id) {
      assertUuid(user_id, "listForUser.user_id");
      // Freshest first. ISO-8601 UTC compares correctly as plain strings.
      return Object.freeze(
        [...byId.values()]
          .filter((screen) => screen.user_id === user_id)
          .sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
      );
    },
    async delete(screen_id) {
      assertUuid(screen_id, "delete.screen_id");
      if (!byId.delete(screen_id)) {
        throw new ScreenNotFoundError(screen_id);
      }
    },
  };
}

export type ScreenQueryExecutor = {
  query<R extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: R[]; rowCount?: number | null }>;
};

type ScreenRow = {
  screen_id: string;
  user_id: string;
  name: string;
  definition: unknown;
  created_at: Date | string;
  updated_at: Date | string;
};

export function createPostgresScreenRepository(
  db: ScreenQueryExecutor,
): ScreenRepository {
  return {
    async save(screen) {
      const existing = await db.query<{ screen_id: string }>(
        `select screen_id::text as screen_id
           from screener_screens
          where screen_id = $1`,
        [screen.screen_id],
      );
      const status = existing.rows[0] ? "replaced" : "created";
      const result = await db.query<ScreenRow>(
        `insert into screener_screens (
           screen_id, user_id, name, definition, created_at, updated_at
         ) values ($1, $2, $3, $4::jsonb, $5, $6)
         on conflict (screen_id) do update
            set user_id = excluded.user_id,
                name = excluded.name,
                definition = excluded.definition,
                created_at = excluded.created_at,
                updated_at = excluded.updated_at
         returning screen_id::text as screen_id,
                   user_id::text as user_id,
                   name,
                   definition,
                   created_at,
                   updated_at`,
        [
          screen.screen_id,
          screen.user_id,
          screen.name,
          JSON.stringify(screen.definition),
          screen.created_at,
          screen.updated_at,
        ],
      );
      return { status, screen: screenFromRow(result.rows[0]) };
    },
    async find(screen_id) {
      assertUuid(screen_id, "find.screen_id");
      const result = await db.query<ScreenRow>(
        `select screen_id::text as screen_id,
                user_id::text as user_id,
                name,
                definition,
                created_at,
                updated_at
           from screener_screens
          where screen_id = $1`,
        [screen_id],
      );
      return result.rows[0] ? screenFromRow(result.rows[0]) : null;
    },
    async listForUser(user_id) {
      assertUuid(user_id, "listForUser.user_id");
      const result = await db.query<ScreenRow>(
        `select screen_id::text as screen_id,
                user_id::text as user_id,
                name,
                definition,
                created_at,
                updated_at
           from screener_screens
          where user_id = $1
          order by updated_at desc, screen_id`,
        [user_id],
      );
      return Object.freeze(result.rows.map(screenFromRow));
    },
    async delete(screen_id) {
      assertUuid(screen_id, "delete.screen_id");
      const result = await db.query(
        `delete from screener_screens where screen_id = $1`,
        [screen_id],
      );
      if ((result.rowCount ?? 0) === 0) {
        throw new ScreenNotFoundError(screen_id);
      }
    },
  };
}

function screenFromRow(row: ScreenRow | undefined): ScreenSubject {
  if (!row) {
    throw new Error("screenFromRow: expected returned row");
  }
  return persistScreen({
    screen_id: row.screen_id,
    user_id: row.user_id,
    name: row.name,
    definition: row.definition as ScreenSubject["definition"],
    created_at: isoString(row.created_at),
    updated_at: isoString(row.updated_at),
  });
}

function isoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
