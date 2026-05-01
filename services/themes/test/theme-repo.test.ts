import { readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResult } from "pg";

import type { JsonValue, QueryExecutor } from "../../observability/src/types.ts";
import type { SubjectRef } from "../../resolver/src/subject-ref.ts";
import {
  DEFAULT_MEMBERSHIP_PAGE_SIZE,
  MAX_MEMBERSHIP_PAGE_SIZE,
  THEME_MEMBERSHIP_MODES,
  ThemeMembershipNotFoundError,
  ThemeValidationError,
  addThemeMembership,
  createTheme,
  getTheme,
  listMembersByTheme,
  listThemes,
  listThemesBySubject,
  removeThemeMembership,
  type ThemeInput,
  type ThemeMembershipInput,
} from "../src/theme-repo.ts";

const THEME_ID = "11111111-1111-4111-8111-111111111111";
const ISSUER_ID = "22222222-2222-4222-8222-222222222222";
const CLAIM_ID = "33333333-3333-4333-8333-333333333333";
const FIXED_NOW = "2026-04-29T12:00:00.000Z";

type Captured = { text: string; values?: unknown[] };

function fakeDb(
  responder: (text: string, values?: unknown[]) => unknown[],
): { db: QueryExecutor; queries: Captured[] } {
  const queries: Captured[] = [];
  const db: QueryExecutor = {
    async query<R extends Record<string, unknown> = Record<string, unknown>>(
      text: string,
      values?: unknown[],
    ): Promise<QueryResult<R>> {
      queries.push({ text, values });
      const rows = responder(text, values) as R[];
      return {
        rows,
        rowCount: rows.length,
        command: "",
        oid: 0,
        fields: [],
      };
    },
  };
  return { db, queries };
}

function themeRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    theme_id: THEME_ID,
    name: "AI Chips Alpha",
    description: null,
    membership_mode: "manual",
    membership_spec: null,
    active_from: null,
    active_to: null,
    created_at: FIXED_NOW,
    updated_at: FIXED_NOW,
    ...overrides,
  };
}

function membershipRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    theme_membership_id: "44444444-4444-4444-8444-444444444444",
    theme_id: THEME_ID,
    subject_kind: "issuer",
    subject_id: ISSUER_ID,
    score: null,
    rationale_claim_ids: [],
    effective_at: FIXED_NOW,
    expires_at: null,
    ...overrides,
  };
}

test("createTheme inserts and returns a frozen row with the membership_mode preserved", () => {
  const input: ThemeInput = { name: "AI Chips Alpha", membership_mode: "rule_based" };
  const { db, queries } = fakeDb(() => [themeRow({ membership_mode: "rule_based" })]);
  return createTheme(db, input).then((row) => {
    assert.equal(row.theme_id, THEME_ID);
    assert.equal(row.membership_mode, "rule_based");
    assert.equal(Object.isFrozen(row), true);
    assert.equal(queries[0].text.includes("insert into themes"), true);
    // Caller-provided values flow into the parameterized query.
    assert.equal(queries[0].values?.[0], "AI Chips Alpha");
    assert.equal(queries[0].values?.[2], "rule_based");
  });
});

test("createTheme rejects an unknown membership_mode before touching the database", async () => {
  // Defense-in-depth: the schema's CHECK constraint would catch this at the
  // DB, but rejecting at the validator gives a typed error and avoids a
  // round-trip on a malformed call.
  const { db, queries } = fakeDb(() => []);
  await assert.rejects(
    createTheme(db, { name: "x", membership_mode: "xenon" as never }),
    (err: Error) => err instanceof ThemeValidationError && /membership_mode/.test(err.message),
  );
  assert.equal(queries.length, 0, "validator must short-circuit before any query");
});

test("createTheme rejects an empty name with ThemeValidationError", async () => {
  const { db } = fakeDb(() => []);
  await assert.rejects(
    createTheme(db, { name: "", membership_mode: "manual" }),
    (err: Error) => err instanceof ThemeValidationError && /name/.test(err.message),
  );
});

test("createTheme rejects an active_to that is not strictly after active_from", async () => {
  // The two timestamps form a half-open interval; equal endpoints would
  // produce a zero-width window that the membership lookup treats as never
  // active. Reject early with a clear message.
  const { db } = fakeDb(() => []);
  await assert.rejects(
    createTheme(db, {
      name: "x",
      membership_mode: "manual",
      active_from: FIXED_NOW,
      active_to: FIXED_NOW,
    }),
    (err: Error) => err instanceof ThemeValidationError && /active_to/.test(err.message),
  );
});

test("createTheme serialises membership_spec as JSON for the jsonb column", () => {
  const spec: JsonValue = { sectors: ["Semiconductors"], min_market_cap: 1_000_000_000 };
  const { db, queries } = fakeDb(() => [themeRow({ membership_mode: "rule_based", membership_spec: spec })]);
  return createTheme(db, {
    name: "AI Chips Alpha",
    membership_mode: "rule_based",
    membership_spec: spec,
  }).then((row) => {
    // The spec round-trips via the fake responder; assert the call
    // serialised it for the jsonb cast.
    assert.equal(queries[0].values?.[3], JSON.stringify(spec));
    assert.deepEqual(row.membership_spec, spec);
  });
});

test("getTheme returns null when the theme does not exist (no row found)", () => {
  const { db } = fakeDb(() => []);
  return getTheme(db, THEME_ID).then((row) => {
    assert.equal(row, null);
  });
});

test("getTheme rejects an empty theme_id with ThemeValidationError", async () => {
  const { db } = fakeDb(() => []);
  await assert.rejects(
    getTheme(db, ""),
    (err: Error) => err instanceof ThemeValidationError && /theme_id/.test(err.message),
  );
});

test("listThemes returns a frozen array ordered by name (delegated to the DB ORDER BY)", () => {
  const { db, queries } = fakeDb(() => [
    themeRow({ name: "AI Chips Alpha" }),
    themeRow({ theme_id: "55555555-5555-4555-8555-555555555555", name: "Iran-US Trade Tensions" }),
  ]);
  return listThemes(db).then((rows) => {
    assert.equal(rows.length, 2);
    assert.equal(Object.isFrozen(rows), true);
    assert.equal(queries[0].text.includes("order by name asc"), true);
  });
});

test("addThemeMembership issues a single ON CONFLICT insert when the (theme, subject) row is absent and returns status created", async () => {
  // Hot path: one round trip. The insert uses
  // `on conflict (theme_id, subject_kind, subject_id) do nothing returning ...`
  // backed by the schema's unique constraint. A returned row means we won the
  // race; no select fallback is issued.
  const { db, queries } = fakeDb(() => [membershipRow()]);
  const result = await addThemeMembership(db, {
    theme_id: THEME_ID,
    subject_ref: { kind: "issuer", id: ISSUER_ID },
  });
  assert.equal(result.status, "created");
  assert.equal(result.membership.theme_id, THEME_ID);
  assert.deepEqual(result.membership.subject_ref, { kind: "issuer", id: ISSUER_ID });
  assert.equal(queries.length, 1, "create path must be a single round trip");
  assert.equal(queries[0].text.includes("insert into theme_memberships"), true);
  assert.equal(
    queries[0].text.includes("on conflict (theme_id, subject_kind, subject_id) do nothing"),
    true,
    "insert must use the unique-constraint conflict target so concurrent adds collapse to one row",
  );
});

test("addThemeMembership returns already_present and re-reads the existing row when the insert hits the unique constraint", async () => {
  // Conflict path: the insert returns 0 rows because of `on conflict do
  // nothing`; the repo falls back to a select to fetch the row that already
  // owns the (theme, subject) slot. The select deliberately ignores the
  // active window — re-adding a (theme, subject) whose previous membership
  // expired returns the expired row rather than minting a new one.
  let call = 0;
  const { db, queries } = fakeDb(() => {
    call += 1;
    return call === 1 ? [] : [membershipRow()];
  });
  const result = await addThemeMembership(db, {
    theme_id: THEME_ID,
    subject_ref: { kind: "issuer", id: ISSUER_ID },
  });
  assert.equal(result.status, "already_present");
  assert.equal(queries.length, 2, "conflict path: failed insert + select fallback");
  assert.equal(queries[0].text.includes("insert into theme_memberships"), true);
  assert.equal(queries[1].text.includes("from theme_memberships"), true);
  assert.equal(queries[1].text.includes("where theme_id ="), true);
});

test("addThemeMembership throws when the conflict-fallback select cannot find the row (loud over silent)", async () => {
  // The conflict path means another writer beat us to the slot; the
  // immediately-following select must return that row. If it doesn't, we're
  // in an unexpected state (cascade delete between insert and select, schema
  // drift removing the constraint, etc.) and the only safe response is a
  // loud throw.
  const { db } = fakeDb(() => []);
  await assert.rejects(
    addThemeMembership(db, {
      theme_id: THEME_ID,
      subject_ref: { kind: "issuer", id: ISSUER_ID },
    }),
    (err: Error) => /conflicted but existing row not found/i.test(err.message),
  );
});

test("listMembersByTheme throws if pg returns rationale_claim_ids with non-string elements (loud over silent)", async () => {
  // A wire-format break that yielded numbers would otherwise lie to
  // ReadonlyArray<string> consumers and surface deep in the explainability
  // chain. Throw at the boundary instead.
  const { db } = fakeDb(() => [membershipRow({ rationale_claim_ids: [123, 456] })]);
  await assert.rejects(
    listMembersByTheme(db, THEME_ID),
    (err: Error) => /rationale_claim_ids: expected array of non-empty strings/.test(err.message),
  );
});

test("addThemeMembership preserves rationale_claim_ids verbatim — provenance must survive the round trip", async () => {
  // Inferred memberships carry rationale pointing back to the source claims.
  // Losing or reordering ids would break the explainability contract for
  // invariant downstream of P3.5.
  const ids = [CLAIM_ID, `${CLAIM_ID.slice(0, -1)}4`];
  const { db, queries } = fakeDb(() => [membershipRow({ rationale_claim_ids: ids })]);
  const result = await addThemeMembership(db, {
    theme_id: THEME_ID,
    subject_ref: { kind: "issuer", id: ISSUER_ID },
    rationale_claim_ids: ids,
  });
  assert.deepEqual([...result.membership.rationale_claim_ids], ids);
  // Insert call serialised the array for the jsonb cast.
  assert.equal(queries[0].values?.[4], JSON.stringify(ids));
});

test("addThemeMembership accepts a numeric score and returns it as a number even when pg returns a string", async () => {
  // pg numeric columns deserialise as strings by default; the repo coerces
  // back to number so callers don't need to remember to parseFloat at every
  // call site.
  const { db } = fakeDb(() => [membershipRow({ score: "0.875" })]);
  const result = await addThemeMembership(db, {
    theme_id: THEME_ID,
    subject_ref: { kind: "issuer", id: ISSUER_ID },
    score: 0.875,
  });
  assert.equal(result.membership.score, 0.875);
  assert.equal(typeof result.membership.score, "number");
});

test("addThemeMembership rejects a malformed subject_ref before any query", async () => {
  // Error class is the resolver's plain Error (assertSubjectRef lives there);
  // theme-repo specific errors stay as ThemeValidationError. Either way the
  // rejection must short-circuit before any query is issued.
  const { db, queries } = fakeDb(() => []);
  for (const malformed of [
    null,
    {},
    { kind: "issuer" },
    { kind: "not_a_kind", id: ISSUER_ID },
    { kind: "issuer", id: "" },
  ]) {
    await assert.rejects(
      addThemeMembership(db, {
        theme_id: THEME_ID,
        subject_ref: malformed as unknown as SubjectRef,
      }),
      (err: Error) => /^subject_ref(\.kind|\.id)?:/.test(err.message),
    );
  }
  assert.equal(queries.length, 0);
});

test("addThemeMembership accepts every SubjectRef.kind, including theme and macro_topic for cross-theme links", async () => {
  // Themes themselves can be tagged into a parent theme (e.g. "AI Chips Alpha"
  // is a member of the "AI" macro_topic), so the validator must not block
  // theme/macro_topic kinds.
  for (const kind of ["theme", "macro_topic", "portfolio", "screen"] as const) {
    const { db } = fakeDb(() => [membershipRow({ subject_kind: kind })]);
    const result = await addThemeMembership(db, {
      theme_id: THEME_ID,
      subject_ref: { kind, id: ISSUER_ID },
    });
    assert.equal(result.membership.subject_ref.kind, kind);
  }
});

test("removeThemeMembership throws ThemeMembershipNotFoundError when the row does not exist", async () => {
  const { db } = fakeDb(() => []);
  await assert.rejects(
    removeThemeMembership(db, THEME_ID, { kind: "issuer", id: ISSUER_ID }),
    (err: Error) => err instanceof ThemeMembershipNotFoundError,
  );
});

test("listMembersByTheme filters with the as-of timestamp so historical/scheduled rows do not leak", async () => {
  // The active-window check (effective_at <= asOf and (expires_at is null
  // or expires_at > asOf)) lives in the SQL, but the repo must pass asOf
  // through. Confirm both the bound and the comparison parameter shape.
  const { db, queries } = fakeDb(() => [membershipRow()]);
  await listMembersByTheme(db, THEME_ID, { asOf: FIXED_NOW });
  assert.equal(queries[0].values?.[1], FIXED_NOW);
  assert.equal(queries[0].text.includes("effective_at <="), true);
  assert.equal(queries[0].text.includes("expires_at is null"), true);
});

test("listMembersByTheme defaults asOf to now() when the caller omits it", async () => {
  const before = new Date().toISOString();
  const { db, queries } = fakeDb(() => []);
  await listMembersByTheme(db, THEME_ID);
  const after = new Date().toISOString();
  const captured = queries[0].values?.[1] as string;
  assert.ok(captured >= before && captured <= after, `expected default asOf ${captured} between ${before} and ${after}`);
});

test("listMembersByTheme caps the page at DEFAULT_MEMBERSHIP_PAGE_SIZE and reports truncation", async () => {
  // The chat pre-resolve hot path can't afford to ship thousands of rows
  // for a popular theme; the repo over-fetches by 1 to detect truncation
  // without a separate count query.
  const oversized = Array.from({ length: DEFAULT_MEMBERSHIP_PAGE_SIZE + 1 }, (_, i) =>
    membershipRow({ theme_membership_id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}` }),
  );
  const { db, queries } = fakeDb(() => oversized);
  const page = await listMembersByTheme(db, THEME_ID);
  assert.equal(page.rows.length, DEFAULT_MEMBERSHIP_PAGE_SIZE);
  assert.equal(page.truncated, true);
  // SQL receives DEFAULT_MEMBERSHIP_PAGE_SIZE + 1 as the LIMIT to enable
  // the truncation flag without a second count query.
  assert.equal(queries[0].values?.[2], DEFAULT_MEMBERSHIP_PAGE_SIZE + 1);
});

test("listMembersByTheme reports truncated=false at exactly DEFAULT_MEMBERSHIP_PAGE_SIZE rows (boundary)", async () => {
  // Boundary check on the `rows.length > limit` branch in makeMembershipPage.
  // An off-by-one (>= vs >) would mis-flag a full-but-not-overflowing page.
  const exact = Array.from({ length: DEFAULT_MEMBERSHIP_PAGE_SIZE }, (_, i) =>
    membershipRow({ theme_membership_id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}` }),
  );
  const { db } = fakeDb(() => exact);
  const page = await listMembersByTheme(db, THEME_ID);
  assert.equal(page.rows.length, DEFAULT_MEMBERSHIP_PAGE_SIZE);
  assert.equal(page.truncated, false, "page must not be flagged truncated when row count equals the limit");
});

test("listMembersByTheme caps an explicit limit at MAX_MEMBERSHIP_PAGE_SIZE", async () => {
  const { db, queries } = fakeDb(() => []);
  await listMembersByTheme(db, THEME_ID, { limit: MAX_MEMBERSHIP_PAGE_SIZE * 10 });
  assert.equal(queries[0].values?.[2], MAX_MEMBERSHIP_PAGE_SIZE + 1);
});

test("listMembersByTheme rejects a non-positive limit with ThemeValidationError", async () => {
  const { db } = fakeDb(() => []);
  for (const bad of [0, -1, 1.5, Number.NaN]) {
    await assert.rejects(
      listMembersByTheme(db, THEME_ID, { limit: bad }),
      (err: Error) => err instanceof ThemeValidationError && /limit/.test(err.message),
      `expected ThemeValidationError for limit=${bad}`,
    );
  }
});

test("listThemesBySubject returns a frozen page for the cross-tagging UI lookup", () => {
  const { db, queries } = fakeDb(() => [membershipRow({ score: "0.42" })]);
  return listThemesBySubject(db, { kind: "issuer", id: ISSUER_ID }, { asOf: FIXED_NOW }).then((page) => {
    assert.equal(page.rows.length, 1);
    assert.equal(page.truncated, false);
    assert.equal(Object.isFrozen(page), true);
    assert.equal(Object.isFrozen(page.rows), true);
    assert.equal(page.rows[0].score, 0.42);
    assert.equal(queries[0].values?.[0], "issuer");
    assert.equal(queries[0].values?.[1], ISSUER_ID);
  });
});

test("theme_memberships drift-tests against the spec SQL: unique (theme_id, subject_kind, subject_id) is required for ON CONFLICT idempotency", () => {
  // The repo's addThemeMembership relies on this unique constraint as the
  // conflict target. If a future schema edit drops or renames the columns,
  // the ON CONFLICT clause silently stops being idempotent and the race that
  // fra-4ut closed is back. Read the spec and assert the triple verbatim.
  const workspaceRoot = join(import.meta.dirname, "..", "..", "..");
  const schemaSource = readFileSync(join(workspaceRoot, "spec", "finance_research_db_schema.sql"), "utf8");
  const tableMatch = schemaSource.match(/create table theme_memberships \(([\s\S]*?)\);/);
  assert.ok(tableMatch, "expected create table theme_memberships in spec/finance_research_db_schema.sql");
  assert.match(
    tableMatch[1],
    /unique \(theme_id, subject_kind, subject_id\)/,
    "theme_memberships must declare unique (theme_id, subject_kind, subject_id) as the ON CONFLICT target",
  );
});

test("theme_memberships drift-tests against the spec SQL: covering indexes match the listMembersByTheme/listThemesBySubject ORDER BY", () => {
  // The list paths sort by `score desc nulls last, effective_at asc` after
  // filtering on theme_id (or subject_kind+subject_id). A covering index on
  // those columns lets pg deliver pre-sorted rows; without it, a popular
  // theme triggers an in-memory sort on every read. Drop these indexes and
  // the chat pre-resolve hot path silently regresses — assert their shape.
  const workspaceRoot = join(import.meta.dirname, "..", "..", "..");
  const schemaSource = readFileSync(join(workspaceRoot, "spec", "finance_research_db_schema.sql"), "utf8");
  assert.match(
    schemaSource,
    /create index \w+\s+on theme_memberships\(theme_id, score desc nulls last, effective_at asc\)/,
    "missing covering index on (theme_id, score desc nulls last, effective_at asc)",
  );
  assert.match(
    schemaSource,
    /create index \w+\s+on theme_memberships\(subject_kind, subject_id, score desc nulls last, effective_at asc\)/,
    "missing covering index on (subject_kind, subject_id, score desc nulls last, effective_at asc)",
  );
});

test("THEME_MEMBERSHIP_MODES drift-tests against the spec SQL CHECK constraint on themes.membership_mode", () => {
  // The earlier version self-validated against the same literals it was
  // testing — useless. This reads the actual SQL and parses the CHECK
  // constraint values so a schema change produces a failing test before it
  // can ship past the TS union.
  const workspaceRoot = join(import.meta.dirname, "..", "..", "..");
  const schemaSource = readFileSync(join(workspaceRoot, "spec", "finance_research_db_schema.sql"), "utf8");
  const checkMatch = schemaSource.match(
    /create table themes[\s\S]*?membership_mode text not null check \(membership_mode in \(([^)]+)\)\)/,
  );
  assert.ok(checkMatch, "expected themes.membership_mode CHECK constraint in spec/finance_research_db_schema.sql");
  const specModes = [...checkMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
  const tsModes = [...THEME_MEMBERSHIP_MODES].sort();
  assert.deepEqual(
    tsModes,
    specModes,
    `TS THEME_MEMBERSHIP_MODES must mirror SQL CHECK — spec: [${specModes.join(", ")}], ts: [${tsModes.join(", ")}]`,
  );
});
