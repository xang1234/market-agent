import { readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResult } from "pg";

import type { QueryExecutor } from "../../observability/src/types.ts";
import {
  DEFAULT_INFERRED_APPLY_MAX_CANDIDATES,
  IMPACT_DIRECTIONS,
  InferredMembershipError,
  applyInferredThemeMembership,
  computeInferredThemeCandidates,
  parseInferredMembershipSpec,
} from "../src/inferred-membership.ts";
import type { ThemeRow } from "../src/theme-repo.ts";

const THEME_ID = "11111111-1111-4111-8111-111111111111";
const CLUSTER_ID_A = "22222222-2222-4222-8222-222222222222";
const CLUSTER_ID_B = "33333333-3333-4333-8333-333333333333";
const ISSUER_A = "44444444-4444-4444-8444-444444444444";
const ISSUER_B = "55555555-5555-4555-8555-555555555555";
const CLAIM_A = "66666666-6666-4666-8666-666666666666";
const CLAIM_B = "77777777-7777-4777-8777-777777777777";

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

function inferredTheme(spec: unknown): ThemeRow {
  return Object.freeze({
    theme_id: THEME_ID,
    name: "Test theme",
    description: null,
    membership_mode: "inferred" as const,
    membership_spec: spec as never,
    active_from: null,
    active_to: null,
    created_at: "2026-04-29T12:00:00.000Z",
    updated_at: "2026-04-29T12:00:00.000Z",
  });
}

// ---- parseInferredMembershipSpec ---------------------------------------

test("parseInferredMembershipSpec accepts the minimal valid spec (cluster_ids only)", () => {
  const spec = parseInferredMembershipSpec({ cluster_ids: [CLUSTER_ID_A] });
  assert.deepEqual([...spec.cluster_ids], [CLUSTER_ID_A]);
  assert.equal(spec.min_confidence, undefined);
  assert.equal(spec.impact_directions, undefined);
});

test("parseInferredMembershipSpec accepts a fully populated spec", () => {
  const spec = parseInferredMembershipSpec({
    cluster_ids: [CLUSTER_ID_A, CLUSTER_ID_B],
    min_confidence: 0.5,
    impact_directions: ["positive", "mixed"],
  });
  assert.deepEqual([...spec.cluster_ids], [CLUSTER_ID_A, CLUSTER_ID_B]);
  assert.equal(spec.min_confidence, 0.5);
  assert.deepEqual([...(spec.impact_directions ?? [])], ["positive", "mixed"]);
});

test("parseInferredMembershipSpec rejects non-object inputs with a labeled error", () => {
  for (const bad of [null, undefined, "string", 42, [], true]) {
    assert.throws(
      () => parseInferredMembershipSpec(bad as unknown),
      (err: Error) => err instanceof InferredMembershipError && /must be a JSON object/.test(err.message),
      `expected throw for ${JSON.stringify(bad)}`,
    );
  }
});

test("parseInferredMembershipSpec rejects missing or empty cluster_ids", () => {
  for (const bad of [{}, { cluster_ids: [] }, { cluster_ids: "not_an_array" }]) {
    assert.throws(
      () => parseInferredMembershipSpec(bad),
      (err: Error) =>
        err instanceof InferredMembershipError && /cluster_ids: must be a non-empty array/.test(err.message),
      `expected throw for ${JSON.stringify(bad)}`,
    );
  }
});

test("parseInferredMembershipSpec rejects non-UUID cluster_ids by index", () => {
  assert.throws(
    () => parseInferredMembershipSpec({ cluster_ids: [CLUSTER_ID_A, "not-a-uuid"] }),
    (err: Error) =>
      err instanceof InferredMembershipError && /cluster_ids\[1\]: must be a UUID string/.test(err.message),
  );
});

test("parseInferredMembershipSpec rejects min_confidence outside [0, 1]", () => {
  for (const bad of [-0.1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "0.5"]) {
    assert.throws(
      () => parseInferredMembershipSpec({ cluster_ids: [CLUSTER_ID_A], min_confidence: bad as never }),
      (err: Error) =>
        err instanceof InferredMembershipError &&
        /min_confidence: must be a number in \[0, 1\]/.test(err.message),
      `expected throw for ${String(bad)}`,
    );
  }
});

test("parseInferredMembershipSpec accepts min_confidence=0 and min_confidence=1 (closed interval)", () => {
  for (const ok of [0, 1, 0.5]) {
    const spec = parseInferredMembershipSpec({ cluster_ids: [CLUSTER_ID_A], min_confidence: ok });
    assert.equal(spec.min_confidence, ok);
  }
});

test("parseInferredMembershipSpec rejects duplicate cluster_ids — the stored spec is canonical", () => {
  // Postgres tolerates dupes in `= any($1::uuid[])`, but a duplicate in the
  // stored spec is a sign of malformed input (e.g. UI bug double-adding a
  // cluster) and should not be silently accepted.
  assert.throws(
    () => parseInferredMembershipSpec({ cluster_ids: [CLUSTER_ID_A, CLUSTER_ID_A] }),
    (err: Error) =>
      err instanceof InferredMembershipError && /cluster_ids: must contain unique UUIDs/.test(err.message),
  );
});

test("parseInferredMembershipSpec rejects duplicate impact_directions", () => {
  assert.throws(
    () =>
      parseInferredMembershipSpec({
        cluster_ids: [CLUSTER_ID_A],
        impact_directions: ["positive", "positive"],
      }),
    (err: Error) =>
      err instanceof InferredMembershipError &&
      /impact_directions: must contain unique values/.test(err.message),
  );
});

test("parseInferredMembershipSpec rejects unknown impact_directions by index", () => {
  assert.throws(
    () =>
      parseInferredMembershipSpec({
        cluster_ids: [CLUSTER_ID_A],
        impact_directions: ["positive", "sideways" as never],
      }),
    (err: Error) =>
      err instanceof InferredMembershipError &&
      /impact_directions\[1\]: must be one of positive, negative, mixed, unknown/.test(err.message),
  );
});

test("parseInferredMembershipSpec uses the provided label in error messages", () => {
  assert.throws(
    () => parseInferredMembershipSpec({}, "theme.spec"),
    (err: Error) => err instanceof InferredMembershipError && /^theme\.spec\.cluster_ids:/.test(err.message),
  );
});

test("IMPACT_DIRECTIONS matches spec/finance_research_db_schema.sql impact_direction enum (drift test)", () => {
  // Reading the SQL is the only way to catch a schema-vs-TS drift. If the
  // enum gains a new value (e.g. 'volatile') and we forget to extend
  // IMPACT_DIRECTIONS, runtime spec-parsing would silently reject valid
  // inputs from the DB.
  const sqlPath = join(import.meta.dirname, "..", "..", "..", "spec", "finance_research_db_schema.sql");
  const sql = readFileSync(sqlPath, "utf8");
  const match = sql.match(/create type impact_direction as enum \(([^)]+)\)/);
  if (!match) throw new Error("could not locate impact_direction enum in schema SQL");
  const sqlValues = [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual([...IMPACT_DIRECTIONS], sqlValues);
});

// ---- computeInferredThemeCandidates ------------------------------------

test("computeInferredThemeCandidates throws if theme.membership_mode is not 'inferred'", async () => {
  const { db } = fakeDb(() => []);
  const ruleBased: ThemeRow = { ...inferredTheme({ cluster_ids: [CLUSTER_ID_A] }), membership_mode: "rule_based" };
  await assert.rejects(
    () => computeInferredThemeCandidates(db, ruleBased),
    (err: Error) =>
      err instanceof InferredMembershipError &&
      /membership_mode must be 'inferred'/.test(err.message),
  );
});

test("computeInferredThemeCandidates throws if membership_spec fails to parse", async () => {
  const { db } = fakeDb(() => []);
  await assert.rejects(
    () => computeInferredThemeCandidates(db, inferredTheme({ cluster_ids: [] })),
    (err: Error) =>
      err instanceof InferredMembershipError && /cluster_ids: must be a non-empty array/.test(err.message),
  );
});

test("computeInferredThemeCandidates issues exactly one query with the parsed binds", async () => {
  const { db, queries } = fakeDb(() => []);
  await computeInferredThemeCandidates(
    db,
    inferredTheme({
      cluster_ids: [CLUSTER_ID_A, CLUSTER_ID_B],
      min_confidence: 0.7,
      impact_directions: ["positive"],
    }),
  );
  assert.equal(queries.length, 1);
  const [q] = queries;
  // Bind shape: [cluster_ids[], min_confidence|null, impact_directions[]|null]
  assert.deepEqual(q.values?.[0], [CLUSTER_ID_A, CLUSTER_ID_B]);
  assert.equal(q.values?.[1], 0.7);
  assert.deepEqual(q.values?.[2], ["positive"]);
  // Sanity: query touches the right tables and applies the support-only filter.
  assert.match(q.text, /claim_cluster_members/);
  assert.match(q.text, /claim_arguments/);
  assert.match(q.text, /entity_impacts/);
  assert.match(q.text, /relation = 'support'/);
});

test("computeInferredThemeCandidates passes nulls when min_confidence and impact_directions are omitted", async () => {
  const { db, queries } = fakeDb(() => []);
  await computeInferredThemeCandidates(db, inferredTheme({ cluster_ids: [CLUSTER_ID_A] }));
  const [q] = queries;
  assert.equal(q.values?.[1], null);
  assert.equal(q.values?.[2], null);
});

test("computeInferredThemeCandidates maps DB rows to InferredCandidate with subject_ref and rationale chain", async () => {
  const { db } = fakeDb(() => [
    {
      subject_kind: "issuer",
      subject_id: ISSUER_A,
      rationale_claim_ids: [CLAIM_A, CLAIM_B],
      distinct_claim_count: 2,
      arg_signals: 1,
      impact_signals: 2,
    },
    {
      subject_kind: "instrument",
      subject_id: ISSUER_B,
      rationale_claim_ids: [CLAIM_A],
      distinct_claim_count: 1,
      arg_signals: 1,
      impact_signals: 0,
    },
  ]);
  const candidates = await computeInferredThemeCandidates(
    db,
    inferredTheme({ cluster_ids: [CLUSTER_ID_A] }),
  );
  assert.equal(candidates.length, 2);
  const [first, second] = candidates;
  assert.deepEqual(first.subject_ref, { kind: "issuer", id: ISSUER_A });
  assert.deepEqual([...first.rationale_claim_ids], [CLAIM_A, CLAIM_B]);
  assert.equal(first.score, 2);
  assert.deepEqual(first.signals, { claim_arguments: 1, entity_impacts: 2 });
  assert.deepEqual(second.subject_ref, { kind: "instrument", id: ISSUER_B });
  assert.equal(second.score, 1);
});

test("computeInferredThemeCandidates query orders by distinct claim count desc, then subject_kind/id asc (drift guard)", () => {
  // Pin down the documented row order so a refactor that drops the `order
  // by` clause (thinking it's superfluous) is caught by tests rather than
  // by a confused reviewer eyeballing inferred members in the UI.
  // We assert on the SQL text directly because the order is generated by
  // pg, not by JS — and the stub responder cannot meaningfully replay
  // sort behavior.
  const queries: string[] = [];
  const db: QueryExecutor = {
    async query(text: string) {
      queries.push(text);
      return { rows: [], rowCount: 0, command: "", oid: 0, fields: [] } as never;
    },
  };
  return computeInferredThemeCandidates(db, inferredTheme({ cluster_ids: [CLUSTER_ID_A] })).then(() => {
    assert.match(queries[0], /order by count\(distinct claim_id\) desc, subject_kind asc, subject_id asc/);
  });
});

test("computeInferredThemeCandidates returns an empty frozen array when no candidates match", async () => {
  const { db } = fakeDb(() => []);
  const candidates = await computeInferredThemeCandidates(
    db,
    inferredTheme({ cluster_ids: [CLUSTER_ID_A] }),
  );
  assert.deepEqual([...candidates], []);
  assert.ok(Object.isFrozen(candidates), "candidates array must be frozen");
});

test("computeInferredThemeCandidates throws if rationale_claim_ids is not an array (wire-format guard)", async () => {
  const { db } = fakeDb(() => [
    {
      subject_kind: "issuer",
      subject_id: ISSUER_A,
      rationale_claim_ids: "not_an_array",
      distinct_claim_count: 1,
      arg_signals: 1,
      impact_signals: 0,
    },
  ]);
  await assert.rejects(
    () => computeInferredThemeCandidates(db, inferredTheme({ cluster_ids: [CLUSTER_ID_A] })),
    (err: Error) =>
      err instanceof InferredMembershipError &&
      /rationale_claim_ids must be an array/.test(err.message),
  );
});

test("computeInferredThemeCandidates throws if any rationale_claim_id is not a non-empty string", async () => {
  const { db } = fakeDb(() => [
    {
      subject_kind: "issuer",
      subject_id: ISSUER_A,
      rationale_claim_ids: [CLAIM_A, ""],
      distinct_claim_count: 1,
      arg_signals: 1,
      impact_signals: 0,
    },
  ]);
  await assert.rejects(
    () => computeInferredThemeCandidates(db, inferredTheme({ cluster_ids: [CLUSTER_ID_A] })),
    (err: Error) =>
      err instanceof InferredMembershipError &&
      /rationale_claim_ids must be non-empty strings/.test(err.message),
  );
});

// ---- applyInferredThemeMembership --------------------------------------

// Routes addThemeMembership through the same fakeDb. The first SQL is the
// inferred-candidate query; per candidate, the insert-with-ON-CONFLICT fires
// first and a fallback select fires only when the insert returns zero rows
// (the conflict path). insertResponses[i] = rows returned by the i-th insert
// (length 0 forces the fallback); existingResponses[i] = rows returned by
// the i-th fallback select.
function applyResponder(
  candidateRows: unknown[],
  existingResponses: Array<unknown[]>,
  insertResponses: Array<unknown[]>,
) {
  let candidateCalls = 0;
  let existingCalls = 0;
  let insertCalls = 0;
  return (text: string, _values?: unknown[]) => {
    if (text.includes("claim_cluster_members") && candidateCalls === 0) {
      candidateCalls += 1;
      return candidateRows;
    }
    if (text.includes("from theme_memberships")) {
      const i = existingCalls;
      existingCalls += 1;
      return existingResponses[i] ?? [];
    }
    if (text.includes("insert into theme_memberships")) {
      const i = insertCalls;
      insertCalls += 1;
      return insertResponses[i] ?? [];
    }
    return [];
  };
}

function membershipDbRow(overrides: Partial<Record<string, unknown>>): Record<string, unknown> {
  return {
    theme_membership_id: "88888888-8888-4888-8888-888888888888",
    theme_id: THEME_ID,
    subject_kind: "issuer",
    subject_id: ISSUER_A,
    score: 1,
    rationale_claim_ids: [CLAIM_A],
    effective_at: "2026-04-29T12:00:00.000Z",
    expires_at: null,
    ...overrides,
  };
}

test("applyInferredThemeMembership persists each candidate and returns added/alreadyPresent counts", async () => {
  const candidateRows = [
    {
      subject_kind: "issuer",
      subject_id: ISSUER_A,
      rationale_claim_ids: [CLAIM_A, CLAIM_B],
      distinct_claim_count: 2,
      arg_signals: 1,
      impact_signals: 1,
    },
    {
      subject_kind: "instrument",
      subject_id: ISSUER_B,
      rationale_claim_ids: [CLAIM_A],
      distinct_claim_count: 1,
      arg_signals: 1,
      impact_signals: 0,
    },
  ];
  // First subject: insert wins → returns the new row, no fallback select.
  // Second subject: insert hits the conflict → returns 0 rows, fallback
  // select returns the row that already owns the (theme, subject) slot.
  const insertResponses: unknown[][] = [
    [membershipDbRow({ subject_id: ISSUER_A, score: 2, rationale_claim_ids: [CLAIM_A, CLAIM_B] })],
    [],
  ];
  const existingResponses: unknown[][] = [
    [membershipDbRow({ subject_kind: "instrument", subject_id: ISSUER_B })],
  ];

  const { db, queries } = fakeDb(applyResponder(candidateRows, existingResponses, insertResponses));
  const result = await applyInferredThemeMembership(db, inferredTheme({ cluster_ids: [CLUSTER_ID_A] }));

  assert.equal(result.added, 1);
  assert.equal(result.alreadyPresent, 1);
  assert.equal(result.candidates.length, 2);

  // Insert call must carry the score (= distinct claim count) and rationale.
  const insert = queries.find((q) => q.text.includes("insert into theme_memberships"));
  assert.ok(insert, "expected an insert into theme_memberships");
  // addThemeMembership binds: [theme_id, kind, id, score, rationale_json, effective_at, expires_at]
  assert.equal(insert?.values?.[3], 2);
  assert.equal(insert?.values?.[4], JSON.stringify([CLAIM_A, CLAIM_B]));
});

test("applyInferredThemeMembership is a no-op when the compute step yields zero candidates", async () => {
  const { db, queries } = fakeDb(applyResponder([], [], []));
  const result = await applyInferredThemeMembership(db, inferredTheme({ cluster_ids: [CLUSTER_ID_A] }));
  assert.equal(result.added, 0);
  assert.equal(result.alreadyPresent, 0);
  assert.equal(result.candidates.length, 0);
  // Only the candidate query should fire — no select-or-insert against
  // theme_memberships when there's nothing to persist.
  assert.equal(queries.length, 1);
});

test("applyInferredThemeMembership throws when candidate count exceeds the per-apply cap", async () => {
  // Build N+1 candidate rows to bust the default cap. We don't need them
  // to be valid for the persistence path — the cap check happens before any
  // theme_memberships query is issued.
  const overflow = DEFAULT_INFERRED_APPLY_MAX_CANDIDATES + 1;
  const candidateRows = Array.from({ length: overflow }, (_, i) => ({
    subject_kind: "issuer",
    subject_id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    rationale_claim_ids: [CLAIM_A],
    distinct_claim_count: 1,
    arg_signals: 1,
    impact_signals: 0,
  }));
  const { db, queries } = fakeDb(applyResponder(candidateRows, [], []));
  await assert.rejects(
    () => applyInferredThemeMembership(db, inferredTheme({ cluster_ids: [CLUSTER_ID_A] })),
    (err: Error) =>
      err instanceof InferredMembershipError &&
      new RegExp(`matched ${overflow} candidates, exceeding the ${DEFAULT_INFERRED_APPLY_MAX_CANDIDATES} per-apply cap`).test(err.message),
  );
  // No theme_memberships traffic — the cap fires before persistence starts.
  assert.equal(queries.filter((q) => q.text.includes("theme_memberships")).length, 0);
});

test("applyInferredThemeMembership rejects a non-positive maxCandidates option", async () => {
  const { db } = fakeDb(applyResponder([], [], []));
  for (const bad of [0, -1, 1.5]) {
    await assert.rejects(
      () => applyInferredThemeMembership(db, inferredTheme({ cluster_ids: [CLUSTER_ID_A] }), { maxCandidates: bad }),
      (err: Error) =>
        err instanceof InferredMembershipError && /maxCandidates must be a positive integer/.test(err.message),
      `expected throw for maxCandidates=${bad}`,
    );
  }
});

test("applyInferredThemeMembership preserves rationale on inserts so explainability survives the round-trip", async () => {
  // Direct verification of the fra-vme contract: "Every inferred member has
  // rationale pointing to source claims." If addThemeMembership ever drops
  // the rationale_claim_ids bind, this catches it.
  const candidateRows = [
    {
      subject_kind: "issuer",
      subject_id: ISSUER_A,
      rationale_claim_ids: [CLAIM_A],
      distinct_claim_count: 1,
      arg_signals: 1,
      impact_signals: 0,
    },
  ];
  const insertResponses: unknown[][] = [[membershipDbRow({})]];
  // The insert wins (returns 1 row); no fallback select is issued.
  const { db, queries } = fakeDb(applyResponder(candidateRows, [], insertResponses));
  await applyInferredThemeMembership(db, inferredTheme({ cluster_ids: [CLUSTER_ID_A] }));
  const insert = queries.find((q) => q.text.includes("insert into theme_memberships"));
  assert.equal(insert?.values?.[4], JSON.stringify([CLAIM_A]));
});
