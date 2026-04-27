// Persistable `screen` subject (spec §6.7.1, §3.20).
//
// A `screen` is a canonical SubjectKind in its own right (one of seven —
// issuer/instrument/listing/theme/macro_topic/portfolio/screen). It is
// NOT a market entity: it is a *named, persisted screener query* that
// downstream subjects (dynamic watchlists, themes, agents) reference
// when they want to "include the universe from screen X."
//
// The defining contract is "reopen runs the query; does NOT replay
// stale rows." The type system enforces it three ways:
//   1. ScreenSubject has no `rows` / `as_of` / `total_count` fields —
//      a stale snapshot would have nowhere to live.
//   2. `definition: ScreenerQuery` is a frozen, validated query envelope
//      (cw0.7.1), not a string DSL — replay is byte-for-byte
//      deterministic, no parser needed.
//   3. `replayScreen()` returns `ScreenerQuery`, not `ScreenerResponse`.
//      Any caller that wants rows must hand the query back to the
//      screener service for fresh execution.

import {
  assertScreenerQueryContract,
  normalizedScreenerQuery,
  type ScreenerQuery,
} from "./query.ts";
import {
  assertIso8601Utc,
  assertNonEmptyString,
  assertUuid,
} from "./validators.ts";

export type UUID = string;

export type ScreenSubjectRef = {
  kind: "screen";
  id: UUID;
};

export type ScreenSubject = {
  screen_id: UUID;
  name: string;
  definition: ScreenerQuery;
  created_at: string;
  updated_at: string;
};

// User-facing names cap so a malformed payload can't smuggle a
// kilobyte-long string into a persistence boundary. 200 chars
// comfortably exceeds any sensible saved-screen label.
export const SCREEN_NAME_MAX_LENGTH = 200;

export type PersistScreenInput = {
  screen_id: UUID;
  name: string;
  definition: ScreenerQuery;
  created_at: string;
  // updated_at defaults to created_at on first persist; subsequent
  // saves must pass an explicit value >= created_at.
  updated_at?: string;
};

export function persistScreen(input: PersistScreenInput): ScreenSubject {
  if (input === null || typeof input !== "object") {
    throw new Error("persistScreen: must be an object");
  }
  assertUuid(input.screen_id, "persistScreen.screen_id");
  assertScreenName(input.name, "persistScreen.name");
  const definition = normalizedScreenerQuery(input.definition);
  assertIso8601Utc(input.created_at, "persistScreen.created_at");
  const updated_at = input.updated_at ?? input.created_at;
  assertIso8601Utc(updated_at, "persistScreen.updated_at");
  if (Date.parse(updated_at) < Date.parse(input.created_at)) {
    throw new Error(
      `persistScreen.updated_at: must be >= created_at (created_at=${input.created_at}, updated_at=${updated_at})`,
    );
  }

  return Object.freeze({
    screen_id: input.screen_id,
    name: input.name,
    definition,
    created_at: input.created_at,
    updated_at,
  });
}

// Returns the bound query for fresh execution. The TYPE — `ScreenerQuery`,
// not `ScreenerResponse` — is the contract: callers must re-execute
// against the screener service to get rows. There is no path that
// returns prehydrated rows from this function, by design.
export function replayScreen(screen: ScreenSubject): ScreenerQuery {
  if (screen === null || typeof screen !== "object") {
    throw new Error("replayScreen: must be a ScreenSubject");
  }
  // Re-canonicalize defensively in case a caller hand-built a
  // ScreenSubject without going through persistScreen. The frozen
  // output is safe to hand back to the screener service for execution.
  return normalizedScreenerQuery(screen.definition);
}

export function screenSubjectRef(screen: ScreenSubject): ScreenSubjectRef {
  assertUuid(screen.screen_id, "screenSubjectRef.screen.screen_id");
  return Object.freeze({ kind: "screen", id: screen.screen_id });
}

export function assertScreenSubjectContract(
  value: unknown,
): asserts value is ScreenSubject {
  if (value === null || typeof value !== "object") {
    throw new Error("screenSubject: must be an object");
  }
  const raw = value as Record<string, unknown>;
  assertUuid(raw.screen_id, "screenSubject.screen_id");
  assertScreenName(raw.name, "screenSubject.name");
  assertScreenerQueryContract(raw.definition);
  assertIso8601Utc(raw.created_at, "screenSubject.created_at");
  assertIso8601Utc(raw.updated_at, "screenSubject.updated_at");
  if (Date.parse(raw.updated_at) < Date.parse(raw.created_at)) {
    throw new Error(
      `screenSubject.updated_at: must be >= created_at (created_at=${raw.created_at}, updated_at=${raw.updated_at})`,
    );
  }
}

function assertScreenName(value: unknown, label: string): asserts value is string {
  assertNonEmptyString(value, label);
  if ((value as string).length > SCREEN_NAME_MAX_LENGTH) {
    throw new Error(
      `${label}: must be <= ${SCREEN_NAME_MAX_LENGTH} characters; received ${(value as string).length}`,
    );
  }
}
