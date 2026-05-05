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
