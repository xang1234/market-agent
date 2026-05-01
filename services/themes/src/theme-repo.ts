import type { JsonValue, QueryExecutor } from "../../observability/src/types.ts";
import type { SubjectKind, SubjectRef } from "../../resolver/src/subject-ref.ts";
import { assertSubjectRef } from "../../resolver/src/subject-ref.ts";

export const THEME_MEMBERSHIP_MODES = ["manual", "rule_based", "inferred"] as const;
export type ThemeMembershipMode = (typeof THEME_MEMBERSHIP_MODES)[number];

// Default cap on how many membership rows a single read returns. The chat
// pre-resolve step calls listMembersByTheme on the request hot path; a
// popular theme could otherwise ship thousands of rows per request. Callers
// that need more must page explicitly via the returned cursor.
export const DEFAULT_MEMBERSHIP_PAGE_SIZE = 100;
export const MAX_MEMBERSHIP_PAGE_SIZE = 1000;

export class ThemeNotFoundError extends Error {
  constructor(message = "theme not found") {
    super(message);
    this.name = "ThemeNotFoundError";
  }
}

export class ThemeMembershipNotFoundError extends Error {
  constructor(message = "theme membership not found") {
    super(message);
    this.name = "ThemeMembershipNotFoundError";
  }
}

export class ThemeValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ThemeValidationError";
  }
}

export type ThemeInput = {
  name: string;
  description?: string;
  membership_mode: ThemeMembershipMode;
  membership_spec?: JsonValue | null;
  active_from?: string | null;
  active_to?: string | null;
};

export type ThemeRow = {
  theme_id: string;
  name: string;
  description: string | null;
  membership_mode: ThemeMembershipMode;
  membership_spec: JsonValue | null;
  active_from: string | null;
  active_to: string | null;
  created_at: string;
  updated_at: string;
};

type ThemeDbRow = {
  theme_id: string;
  name: string;
  description: string | null;
  membership_mode: ThemeMembershipMode;
  membership_spec: JsonValue | null;
  active_from: Date | string | null;
  active_to: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

export async function createTheme(db: QueryExecutor, input: ThemeInput): Promise<ThemeRow> {
  validateThemeInput(input);
  const { rows } = await db.query<ThemeDbRow>(
    `insert into themes (name, description, membership_mode, membership_spec, active_from, active_to)
     values ($1, $2, $3, $4::jsonb, $5::timestamptz, $6::timestamptz)
     returning theme_id::text as theme_id,
               name,
               description,
               membership_mode,
               membership_spec,
               active_from,
               active_to,
               created_at,
               updated_at`,
    [
      input.name,
      input.description ?? null,
      input.membership_mode,
      input.membership_spec === undefined ? null : JSON.stringify(input.membership_spec),
      input.active_from ?? null,
      input.active_to ?? null,
    ],
  );
  return themeRowFromDb(rows[0]);
}

export async function getTheme(db: QueryExecutor, themeId: string): Promise<ThemeRow | null> {
  assertNonEmptyString(themeId, "theme_id");
  const { rows } = await db.query<ThemeDbRow>(
    `select theme_id::text as theme_id,
            name,
            description,
            membership_mode,
            membership_spec,
            active_from,
            active_to,
            created_at,
            updated_at
       from themes
      where theme_id = $1::uuid`,
    [themeId],
  );
  return rows[0] ? themeRowFromDb(rows[0]) : null;
}

export async function listThemes(db: QueryExecutor): Promise<ReadonlyArray<ThemeRow>> {
  const { rows } = await db.query<ThemeDbRow>(
    `select theme_id::text as theme_id,
            name,
            description,
            membership_mode,
            membership_spec,
            active_from,
            active_to,
            created_at,
            updated_at
       from themes
      order by name asc`,
  );
  return Object.freeze(rows.map(themeRowFromDb));
}

export type ThemeMembershipInput = {
  theme_id: string;
  subject_ref: SubjectRef;
  score?: number | null;
  rationale_claim_ids?: ReadonlyArray<string>;
  effective_at?: string | null;
  expires_at?: string | null;
};

export type ThemeMembershipRow = {
  theme_membership_id: string;
  theme_id: string;
  subject_ref: SubjectRef;
  score: number | null;
  rationale_claim_ids: ReadonlyArray<string>;
  effective_at: string;
  expires_at: string | null;
};

type ThemeMembershipDbRow = {
  theme_membership_id: string;
  theme_id: string;
  subject_kind: SubjectKind;
  subject_id: string;
  score: string | number | null;
  rationale_claim_ids: ReadonlyArray<string>;
  effective_at: Date | string;
  expires_at: Date | string | null;
};

const MEMBERSHIP_SELECT_COLUMNS = `theme_membership_id::text as theme_membership_id,
       theme_id::text as theme_id,
       subject_kind,
       subject_id::text as subject_id,
       score,
       rationale_claim_ids,
       effective_at,
       expires_at`;

// Builds the half-open active-window predicate against a single bind index.
// (Not a string template + .replace — that approach silently misfires if a
// future predicate ever needs more than one placeholder.)
function membershipActiveWindowPredicate(asOfBindIndex: number): string {
  const bind = `$${asOfBindIndex}::timestamptz`;
  return `effective_at <= ${bind} and (expires_at is null or expires_at > ${bind})`;
}

// Adds a (theme, subject) row. Idempotent at (theme_id, subject_kind, subject_id)
// via the schema's unique constraint: the insert uses ON CONFLICT DO NOTHING
// RETURNING, so two concurrent writers collapse to one row instead of
// duplicating. The hot path (create) is one round trip; the conflict path
// adds a select to fetch the row that already owns the slot.
//
// The conflict-fallback select deliberately ignores the active window —
// re-adding a (theme, subject) whose previous membership has expired returns
// status: 'already_present' against the expired row rather than minting a
// fresh one. Inferred-membership re-evaluation (fra-vme) that wants
// resurrect-on-expire semantics must explicitly remove the expired row
// first.
export async function addThemeMembership(
  db: QueryExecutor,
  input: ThemeMembershipInput,
): Promise<{ status: "created" | "already_present"; membership: ThemeMembershipRow }> {
  validateThemeMembershipInput(input);

  const insert = await db.query<ThemeMembershipDbRow>(
    `insert into theme_memberships
       (theme_id, subject_kind, subject_id, score, rationale_claim_ids, effective_at, expires_at)
     values ($1::uuid, $2::subject_kind, $3::uuid, $4, $5::jsonb, coalesce($6::timestamptz, now()), $7::timestamptz)
     on conflict (theme_id, subject_kind, subject_id) do nothing
     returning ${MEMBERSHIP_SELECT_COLUMNS}`,
    [
      input.theme_id,
      input.subject_ref.kind,
      input.subject_ref.id,
      input.score ?? null,
      JSON.stringify(input.rationale_claim_ids ?? []),
      input.effective_at ?? null,
      input.expires_at ?? null,
    ],
  );
  if (insert.rows.length === 1) {
    return Object.freeze({
      status: "created" as const,
      membership: themeMembershipRowFromDb(insert.rows[0]),
    });
  }

  const existing = await db.query<ThemeMembershipDbRow>(
    `select ${MEMBERSHIP_SELECT_COLUMNS}
       from theme_memberships
      where theme_id = $1::uuid and subject_kind = $2::subject_kind and subject_id = $3::uuid`,
    [input.theme_id, input.subject_ref.kind, input.subject_ref.id],
  );
  if (existing.rows.length === 0) {
    throw new Error("addThemeMembership conflicted but existing row not found");
  }
  return Object.freeze({
    status: "already_present" as const,
    membership: themeMembershipRowFromDb(existing.rows[0]),
  });
}

export async function removeThemeMembership(
  db: QueryExecutor,
  themeId: string,
  subjectRef: SubjectRef,
): Promise<void> {
  assertNonEmptyString(themeId, "theme_id");
  assertSubjectRef(subjectRef, "subject_ref");
  const result = await db.query(
    `delete from theme_memberships
      where theme_id = $1::uuid and subject_kind = $2::subject_kind and subject_id = $3::uuid`,
    [themeId, subjectRef.kind, subjectRef.id],
  );
  if ((result.rowCount ?? 0) === 0) {
    throw new ThemeMembershipNotFoundError();
  }
}

export type ListMembershipOptions = {
  asOf?: string;
  limit?: number;
};

export type MembershipPage = {
  rows: ReadonlyArray<ThemeMembershipRow>;
  // True when the result was capped at `limit`; the caller should re-query
  // with a tighter range or a higher limit to see more.
  truncated: boolean;
};

// Lists active members of a theme as of `asOf`. Capped at `limit` rows
// (default DEFAULT_MEMBERSHIP_PAGE_SIZE, max MAX_MEMBERSHIP_PAGE_SIZE) so a
// popular theme can't dump thousands of rows into a chat pre-resolve call.
// A membership is active when effective_at <= asOf and (expires_at is null
// or expires_at > asOf), so historical/scheduled rows don't leak.
export async function listMembersByTheme(
  db: QueryExecutor,
  themeId: string,
  options: ListMembershipOptions = {},
): Promise<MembershipPage> {
  assertNonEmptyString(themeId, "theme_id");
  if (options.asOf !== undefined) assertValidTimestamp(options.asOf, "asOf");
  const limit = resolvePageSize(options.limit);
  const asOf = options.asOf ?? new Date().toISOString();
  const { rows } = await db.query<ThemeMembershipDbRow>(
    `select ${MEMBERSHIP_SELECT_COLUMNS}
       from theme_memberships
      where theme_id = $1::uuid
        and ${membershipActiveWindowPredicate(2)}
      order by score desc nulls last, effective_at asc
      limit $3`,
    [themeId, asOf, limit + 1],
  );
  return makeMembershipPage(rows, limit);
}

// Reverse lookup: which themes claim this subject? Useful for hydrating a
// chat or watchlist entry with its theme tags. Same pagination semantics as
// listMembersByTheme.
export async function listThemesBySubject(
  db: QueryExecutor,
  subjectRef: SubjectRef,
  options: ListMembershipOptions = {},
): Promise<MembershipPage> {
  assertSubjectRef(subjectRef, "subject_ref");
  if (options.asOf !== undefined) assertValidTimestamp(options.asOf, "asOf");
  const limit = resolvePageSize(options.limit);
  const asOf = options.asOf ?? new Date().toISOString();
  const { rows } = await db.query<ThemeMembershipDbRow>(
    `select ${MEMBERSHIP_SELECT_COLUMNS}
       from theme_memberships
      where subject_kind = $1::subject_kind
        and subject_id = $2::uuid
        and ${membershipActiveWindowPredicate(3)}
      order by score desc nulls last, effective_at asc
      limit $4`,
    [subjectRef.kind, subjectRef.id, asOf, limit + 1],
  );
  return makeMembershipPage(rows, limit);
}

function resolvePageSize(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_MEMBERSHIP_PAGE_SIZE;
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new ThemeValidationError("limit: must be a positive integer when provided");
  }
  return Math.min(limit, MAX_MEMBERSHIP_PAGE_SIZE);
}

function makeMembershipPage(
  rows: ReadonlyArray<ThemeMembershipDbRow>,
  limit: number,
): MembershipPage {
  // We over-fetched by 1 to detect truncation without a separate count.
  const truncated = rows.length > limit;
  const visible = truncated ? rows.slice(0, limit) : rows;
  return Object.freeze({
    rows: Object.freeze(visible.map(themeMembershipRowFromDb)),
    truncated,
  });
}

function validateThemeInput(input: ThemeInput): void {
  assertNonEmptyString(input.name, "name");
  if (input.description !== undefined && typeof input.description !== "string") {
    throw new ThemeValidationError("description: must be a string when provided");
  }
  if (!THEME_MEMBERSHIP_MODES.includes(input.membership_mode)) {
    throw new ThemeValidationError(
      `membership_mode: must be one of ${THEME_MEMBERSHIP_MODES.join(", ")}`,
    );
  }
  if (input.active_from != null) assertValidTimestamp(input.active_from, "active_from");
  if (input.active_to != null) assertValidTimestamp(input.active_to, "active_to");
  if (input.active_from != null && input.active_to != null) {
    if (Date.parse(input.active_to) <= Date.parse(input.active_from)) {
      throw new ThemeValidationError("active_to: must be strictly after active_from");
    }
  }
}

function validateThemeMembershipInput(input: ThemeMembershipInput): void {
  assertNonEmptyString(input.theme_id, "theme_id");
  assertSubjectRef(input.subject_ref, "subject_ref");
  if (input.score != null && (!Number.isFinite(input.score) || Number.isNaN(input.score))) {
    throw new ThemeValidationError("score: must be a finite number when provided");
  }
  if (input.rationale_claim_ids !== undefined) {
    if (!Array.isArray(input.rationale_claim_ids)) {
      throw new ThemeValidationError("rationale_claim_ids: must be an array of UUID strings");
    }
    input.rationale_claim_ids.forEach((id, index) => {
      if (typeof id !== "string" || id.length === 0) {
        throw new ThemeValidationError(`rationale_claim_ids[${index}]: must be a non-empty string`);
      }
    });
  }
  if (input.effective_at != null) assertValidTimestamp(input.effective_at, "effective_at");
  if (input.expires_at != null) assertValidTimestamp(input.expires_at, "expires_at");
  if (input.expires_at != null && input.effective_at != null) {
    if (Date.parse(input.expires_at) <= Date.parse(input.effective_at)) {
      throw new ThemeValidationError("expires_at: must be strictly after effective_at");
    }
  }
}

// Reject malformed timestamp strings before they hit ::timestamptz casts
// in SQL — Date.parse returns NaN on garbage, which would otherwise make
// the active-window predicate match nothing and return an empty page
// instead of surfacing the bug. Use the same posture as the other
// validators here: typed ThemeValidationError at the boundary.
function assertValidTimestamp(value: string, label: string): void {
  if (typeof value !== "string" || value.length === 0 || Number.isNaN(Date.parse(value))) {
    throw new ThemeValidationError(`${label}: must be a valid ISO timestamp`);
  }
}

function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new ThemeValidationError(`${label}: must be a non-empty string`);
  }
}

function themeRowFromDb(row: ThemeDbRow | undefined): ThemeRow {
  if (!row) throw new Error("themes insert/select did not return a row");
  // Shallow freeze only — nested membership_spec is opaque JsonValue and
  // belongs to the caller. Matches services/evidence/src/source-repo.ts and
  // the rest of the per-service repo conventions.
  return Object.freeze({
    theme_id: row.theme_id,
    name: row.name,
    description: row.description,
    membership_mode: row.membership_mode,
    membership_spec: row.membership_spec,
    active_from: row.active_from === null ? null : isoString(row.active_from),
    active_to: row.active_to === null ? null : isoString(row.active_to),
    created_at: isoString(row.created_at),
    updated_at: isoString(row.updated_at),
  });
}

function themeMembershipRowFromDb(row: ThemeMembershipDbRow | undefined): ThemeMembershipRow {
  if (!row) throw new Error("theme_memberships insert/select did not return a row");
  // Deep-freeze the structured nested fields. Freshly constructing them
  // here doesn't stop a caller from mutating the result —
  // `result.subject_ref.kind = "evil"` works on a plain object literal
  // even when the outer object is frozen. The repo owns the shape of
  // both subject_ref and rationale_claim_ids, so freezing them here is
  // the right boundary; only opaque caller-controlled JSON
  // (themeRowFromDb's membership_spec) is left mutable.
  return Object.freeze({
    theme_membership_id: row.theme_membership_id,
    theme_id: row.theme_id,
    subject_ref: Object.freeze({ kind: row.subject_kind, id: row.subject_id }),
    score: row.score === null ? null : Number(row.score),
    rationale_claim_ids: rationaleClaimIds(row.rationale_claim_ids),
    effective_at: isoString(row.effective_at),
    expires_at: row.expires_at === null ? null : isoString(row.expires_at),
  });
}

function rationaleClaimIds(value: unknown): ReadonlyArray<string> {
  // pg returns jsonb columns parsed; an array of strings is the expected
  // shape. Throw on anything else (or on a wrong element type) so a
  // wire-format break can't silently drop provenance — rationale_claim_ids
  // is the explainability anchor for inferred memberships and a silent fall
  // through would be worse than a loud crash. Element-type check defends
  // against a future schema/transport change that would yield numbers or
  // nested objects.
  if (!Array.isArray(value)) {
    throw new Error(
      "theme_memberships.rationale_claim_ids: expected jsonb array, got " + typeof value,
    );
  }
  if (!value.every((v) => typeof v === "string" && v.length > 0)) {
    throw new Error(
      "theme_memberships.rationale_claim_ids: expected array of non-empty strings",
    );
  }
  // Defensive copy + freeze so callers can't mutate the parsed array
  // back onto the underlying repo result (and, transitively, onto any
  // memoization the caller layered on top).
  return Object.freeze([...value]) as ReadonlyArray<string>;
}

function isoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
