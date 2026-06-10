# Analyst Grid Reader Documents — Code-Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three code-review issues in `services/analyst-grids/src/reader-documents.ts` — user-scoped source visibility, rank-aware SQL candidate cap, and JS recency tiebreak robustness — and thread the required `userId` context through column catalog, cell runner, and run engine.

**Architecture:** The `userId` is already present in `startGridRun`'s `input` object; it needs to flow down through `runWorker`'s ctx → `computeAndPersistCell`'s `ComputeCellInput` → the producer's `GridColumnContext`. On the SQL side, the reader-documents query is restructured into an inner subquery (dedupe via `distinct on`) + outer query (priority ORDER BY + LIMIT) so the cap only drops genuinely lower-priority candidates. The JS sort is updated to coalesce `created_at` fallback to match SQL semantics.

**Tech Stack:** TypeScript (Node.js 22, node:test), PostgreSQL 16, Docker (via `db/test/docker-pg.ts`), `npm test` from `services/analyst-grids`.

---

## File Map

| File | Change |
|---|---|
| `services/analyst-grids/src/reader-documents.ts` | All three issues: userId param + user-scope predicate; inner/outer SQL restructure; JS coalesce sort + comment |
| `services/analyst-grids/src/column-catalog.ts` | Add `userId: string` to `GridColumnContext` |
| `services/analyst-grids/src/cell-runner.ts` | Add `userId: string` to `ComputeCellInput`; pass it into producer ctx |
| `services/analyst-grids/src/run-engine.ts` | Pass `userId` in `runWorker` ctx; pass to `computeAndPersistCell` |
| `services/analyst-grids/test/reader-documents.test.ts` | Update existing calls for new signature; add user-scope integration test; add `created_at` fallback unit test |
| `services/analyst-grids/test/params-threading.test.ts` | Add `userId` to the `ComputeCellInput` in the test |
| `services/analyst-grids/test/column-catalog-unit.test.ts` | Add `userId` to the `CTX` constant |
| `services/analyst-grids/test/cell-runner-error.test.ts` | Add `userId` to the `INPUT` constant |

---

## Task 1: Add `userId` to `GridColumnContext` in column-catalog.ts

**Files:**
- Modify: `services/analyst-grids/src/column-catalog.ts:31-37`

- [ ] **Step 1: Add the field**

Open `services/analyst-grids/src/column-catalog.ts`. The `GridColumnContext` type (lines 31–37) currently reads:

```ts
export type GridColumnContext = {
  subject: SubjectRef;
  period: PeriodContext;
  snapshotId: string;
  asOf: string;
  params: JsonValue | null; // the column's ColumnSpec.params, verbatim
};
```

Change it to:

```ts
export type GridColumnContext = {
  subject: SubjectRef;
  period: PeriodContext;
  snapshotId: string;
  asOf: string;
  userId: string;
  params: JsonValue | null; // the column's ColumnSpec.params, verbatim
};
```

- [ ] **Step 2: Run existing tests (expect compile-time failures in consumers, not test failures yet)**

```bash
cd /Users/admin/Documents/Work/market-agent/services/analyst-grids && npm test 2>&1 | head -60
```

Expected: TypeScript errors referencing missing `userId` in `computeAndPersistCell` (cell-runner.ts) and in test CTX objects. This confirms the type is now required.

---

## Task 2: Add `userId` to `ComputeCellInput` and pass it into the producer ctx in cell-runner.ts

**Files:**
- Modify: `services/analyst-grids/src/cell-runner.ts:14-21` (type) and `:44-47` (producer call)

- [ ] **Step 1: Add `userId` to `ComputeCellInput`**

`ComputeCellInput` (lines 14–21) currently:

```ts
export type ComputeCellInput = {
  column: ColumnCatalogEntry;
  params: JsonValue | null;
  gridRowId: string;
  subject: SubjectRef;
  period: PeriodContext;
  asOf: string;
};
```

Change to:

```ts
export type ComputeCellInput = {
  column: ColumnCatalogEntry;
  params: JsonValue | null;
  gridRowId: string;
  subject: SubjectRef;
  period: PeriodContext;
  asOf: string;
  userId: string;
};
```

- [ ] **Step 2: Pass `userId` into the producer context**

In `computeAndPersistCell`, the producer call (line ~44–47) currently:

```ts
    result = await input.column.producer(
      { db: deps.db, reader: deps.reader },
      { subject: input.subject, period: input.period, snapshotId, asOf: input.asOf, params: input.params },
    );
```

Change to:

```ts
    result = await input.column.producer(
      { db: deps.db, reader: deps.reader },
      { subject: input.subject, period: input.period, snapshotId, asOf: input.asOf, userId: input.userId, params: input.params },
    );
```

---

## Task 3: Pass `userId` through `runWorker` and `computeAndPersistCell` in run-engine.ts

**Files:**
- Modify: `services/analyst-grids/src/run-engine.ts:125` (worker invocation), `:132-134` (runWorker ctx type), `:151-153` (computeAndPersistCell call)

- [ ] **Step 1: Add `userId` to the `runWorker` ctx inline type**

`runWorker`'s ctx parameter (line ~134) currently:

```ts
  ctx: { runId: string; rows: Array<{ gridRowId: string; subject: SubjectRef }>; columns: RunColumn[]; asOf: string },
```

Change to:

```ts
  ctx: { runId: string; rows: Array<{ gridRowId: string; subject: SubjectRef }>; columns: RunColumn[]; asOf: string; userId: string },
```

- [ ] **Step 2: Pass `userId` when invoking `runWorker`**

Line ~125, where `runWorker` is called:

```ts
  void runWorker(deps, { runId, rows, columns, asOf: input.asOf }).catch((err) => {
```

Change to:

```ts
  void runWorker(deps, { runId, rows, columns, asOf: input.asOf, userId: input.userId }).catch((err) => {
```

- [ ] **Step 3: Pass `userId` to `computeAndPersistCell` in the row loop**

Line ~151–153, in the `runWithConcurrency` callback:

```ts
        const status = await computeAndPersistCell(
          { db: deps.db, pool: deps.pool, reader: deps.reader },
          { column: column.entry, params: column.params, gridRowId, subject, period, asOf: ctx.asOf },
        );
```

Change to:

```ts
        const status = await computeAndPersistCell(
          { db: deps.db, pool: deps.pool, reader: deps.reader },
          { column: column.entry, params: column.params, gridRowId, subject, period, asOf: ctx.asOf, userId: ctx.userId },
        );
```

---

## Task 4: Fix reader-documents.ts — all three issues

**Files:**
- Modify: `services/analyst-grids/src/reader-documents.ts` (entire file)

### Issue 1: user-scoped source visibility + new `userId` param
### Issue 2: rank-aware SQL cap via inner/outer subquery restructure
### Issue 3: JS coalesce tiebreak + comment

- [ ] **Step 1: Rewrite the file**

Replace the entire contents of `services/analyst-grids/src/reader-documents.ts` with:

```ts
import type { QueryExecutor } from "./types.ts";

export type ReaderDocumentRow = {
  document_id: string;
  source_id: string;
  raw_blob_id: string;
  doc_kind: string;
  published_at: string | null;
  created_at: string;
};

export const READER_DOCUMENT_WINDOW_DAYS = 180;
export const READER_DOCUMENTS_PER_CELL = 5;

// Recent, non-ephemeral documents visible to `userId` mentioning the issuer,
// preferring primary document kinds. Ranking: kind preference (filing >
// transcript > press_release > article > everything else), then recency. The
// ephemeral filter excludes metadata-only ingests (GDELT) whose raw text we
// may not store or display. Sources with a user_id must match `userId`
// (private uploads); sources with user_id IS NULL are public.
//
// Structure: inner subquery deduplicates by document_id (required by
// distinct on) then outer query applies priority ORDER BY + LIMIT 200 so the
// cap only drops genuinely lower-priority candidates. JS sort is the final
// tiebreak layer operating on the already-ranked 200-row window.
export async function selectReaderDocuments(
  db: QueryExecutor,
  issuerId: string,
  userId: string,
  limit: number = READER_DOCUMENTS_PER_CELL,
): Promise<ReaderDocumentRow[]> {
  const { rows } = await db.query<ReaderDocumentRow>(
    `select document_id, source_id, raw_blob_id, doc_kind, published_at, created_at
       from (
         select distinct on (d.document_id)
                d.document_id::text as document_id,
                d.source_id::text as source_id,
                d.raw_blob_id,
                d.kind::text as doc_kind,
                d.published_at::text as published_at,
                d.created_at::text as created_at
           from mentions m
           join documents d on d.document_id = m.document_id
           join sources s on s.source_id = d.source_id
          where m.subject_kind = 'issuer'
            and m.subject_id = $1
            and d.deleted_at is null
            and s.license_class <> 'ephemeral'
            and d.raw_blob_id not like 'ephemeral:%'
            and coalesce(d.published_at, d.created_at) >= now() - ($2 || ' days')::interval
            and (s.user_id is null or s.user_id = $3::uuid)
          order by d.document_id
       ) deduped
      order by case doc_kind
                 when 'filing' then 0
                 when 'transcript' then 1
                 when 'press_release' then 2
                 when 'article' then 3
                 else 4
               end,
               coalesce(published_at, created_at) desc
      limit 200`,
    [issuerId, String(READER_DOCUMENT_WINDOW_DAYS), userId],
  );
  const kindRank = (kind: string): number =>
    ({ filing: 0, transcript: 1, press_release: 2, article: 3 } as Record<string, number>)[kind] ?? 4;
  // ISO-8601 text ordering matches chronological ordering for timestamptz::text
  // cast within a single session (timezone-consistent output from Postgres).
  return rows
    .sort(
      (a, b) =>
        kindRank(a.doc_kind) - kindRank(b.doc_kind) ||
        (b.published_at ?? b.created_at).localeCompare(a.published_at ?? a.created_at),
    )
    .slice(0, limit);
}
```

---

## Task 5: Update test files that construct `GridColumnContext` / `ComputeCellInput`

**Files:**
- Modify: `services/analyst-grids/test/column-catalog-unit.test.ts:42-48`
- Modify: `services/analyst-grids/test/cell-runner-error.test.ts:31-37`
- Modify: `services/analyst-grids/test/params-threading.test.ts:24-34`

### column-catalog-unit.test.ts

- [ ] **Step 1: Add `userId` to CTX**

The `CTX` constant (lines 42–48) currently:

```ts
const CTX = {
  subject: { kind: "issuer" as const, id: ISSUER_ID },
  period: null,
  snapshotId: SNAPSHOT_ID,
  asOf: "2026-06-09T00:00:00.000Z",
  params: null,
};
```

Change to:

```ts
const CTX = {
  subject: { kind: "issuer" as const, id: ISSUER_ID },
  period: null,
  snapshotId: SNAPSHOT_ID,
  asOf: "2026-06-09T00:00:00.000Z",
  userId: "ffffffff-ffff-4fff-afff-ffffffffffff",
  params: null,
};
```

### cell-runner-error.test.ts

- [ ] **Step 2: Add `userId` to INPUT**

The `INPUT` constant (lines 31–37) currently:

```ts
const INPUT = {
  gridRowId: "55555555-5555-4555-a555-555555555555",
  params: null,
  subject: { kind: "issuer" as const, id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa" },
  period: null,
  asOf: "2026-06-09T00:00:00.000Z",
};
```

Change to:

```ts
const INPUT = {
  gridRowId: "55555555-5555-4555-a555-555555555555",
  params: null,
  subject: { kind: "issuer" as const, id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa" },
  period: null,
  asOf: "2026-06-09T00:00:00.000Z",
  userId: "ffffffff-ffff-4fff-afff-ffffffffffff",
};
```

### params-threading.test.ts

- [ ] **Step 3: Add `userId` to the `computeAndPersistCell` call**

The `computeAndPersistCell` call (lines 22–34) currently passes:

```ts
    {
      column: { column_key: "x", label: "X", kind: "reader", producer },
      params: { prompt: "Any China exposure?" },
      gridRowId: "11111111-1111-4111-8111-111111111111",
      subject: { kind: "issuer", id: "22222222-2222-4222-8222-222222222222" },
      period: null,
      asOf: "2026-06-10T00:00:00Z",
    },
```

Change to:

```ts
    {
      column: { column_key: "x", label: "X", kind: "reader", producer },
      params: { prompt: "Any China exposure?" },
      gridRowId: "11111111-1111-4111-8111-111111111111",
      subject: { kind: "issuer", id: "22222222-2222-4222-8222-222222222222" },
      period: null,
      asOf: "2026-06-10T00:00:00Z",
      userId: "ffffffff-ffff-4fff-afff-ffffffffffff",
    },
```

---

## Task 6: Update existing reader-documents integration tests for new signature

**Files:**
- Modify: `services/analyst-grids/test/reader-documents.test.ts`

All three existing integration test calls to `selectReaderDocuments` pass only `(db, issuerId, limit)`. The new signature is `(db, issuerId, userId, limit)`. We also need to add `created_at` to `ReaderDocumentRow` but the integration seed tests don't read it, so no assertion changes needed — just the call signatures.

We'll use `OUR_USER_ID` as the requester in these tests (sources have `user_id = null` so they are public and will pass the new predicate regardless).

- [ ] **Step 1: Add constants and update calls**

At the top of the test file, the UUIDs section (lines 11–15) currently has:

```ts
const SOURCE_A_ID = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa"; // filing / public
const SOURCE_B_ID = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb"; // article / ephemeral
const ISSUER_X_ID = "cccccccc-cccc-4ccc-cccc-cccccccccccc";
const ISSUER_Y_ID = "dddddddd-dddd-4ddd-dddd-dddddddddddd";
const ISSUER_EMPTY_ID = "eeeeeeee-eeee-4eee-eeee-eeeeeeeeeeee";
```

Change to:

```ts
const SOURCE_A_ID = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa"; // filing / public
const SOURCE_B_ID = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb"; // article / ephemeral
const ISSUER_X_ID = "cccccccc-cccc-4ccc-cccc-cccccccccccc";
const ISSUER_Y_ID = "dddddddd-dddd-4ddd-dddd-dddddddddddd";
const ISSUER_EMPTY_ID = "eeeeeeee-eeee-4eee-eeee-eeeeeeeeeeee";
const OUR_USER_ID = "ffffffff-ffff-4fff-afff-ffffffffffff";
const OTHER_USER_ID = "00000000-0000-4000-a000-000000000001";
```

- [ ] **Step 2: Update call in first test**

Line ~122 in the first integration test:

```ts
  const rows = await selectReaderDocuments(db, ISSUER_X_ID, 5);
```

Change to:

```ts
  const rows = await selectReaderDocuments(db, ISSUER_X_ID, OUR_USER_ID, 5);
```

- [ ] **Step 3: Update call in second test (empty result)**

Line ~143:

```ts
  const rows = await selectReaderDocuments(db, ISSUER_EMPTY_ID, 5);
```

Change to:

```ts
  const rows = await selectReaderDocuments(db, ISSUER_EMPTY_ID, OUR_USER_ID, 5);
```

- [ ] **Step 4: Update call in third test (issuer isolation)**

Line ~172:

```ts
  const rows = await selectReaderDocuments(db, ISSUER_X_ID, 5);
```

Change to:

```ts
  const rows = await selectReaderDocuments(db, ISSUER_X_ID, OUR_USER_ID, 5);
```

- [ ] **Step 5: Update unit test calls (fake DB tests)**

Lines ~207, ~224, ~239, ~251, ~263. Each unit test calls `selectReaderDocuments(fakeDb(rows), "any-issuer", N)`.

Change all five occurrences from the pattern:

```ts
  const result = await selectReaderDocuments(fakeDb(rows), "any-issuer", N);
```

to:

```ts
  const result = await selectReaderDocuments(fakeDb(rows), "any-issuer", OUR_USER_ID, N);
```

Specifically the five calls are:
- Line ~207: `selectReaderDocuments(fakeDb(rows), "any-issuer", 10)` → `selectReaderDocuments(fakeDb(rows), "any-issuer", OUR_USER_ID, 10)`
- Line ~224: `selectReaderDocuments(fakeDb(rows), "any-issuer", 10)` → `selectReaderDocuments(fakeDb(rows), "any-issuer", OUR_USER_ID, 10)`
- Line ~239: `selectReaderDocuments(fakeDb(rows), "any-issuer", 2)` → `selectReaderDocuments(fakeDb(rows), "any-issuer", OUR_USER_ID, 2)`
- Line ~251: `selectReaderDocuments(fakeDb(rows), "any-issuer", 10)` → `selectReaderDocuments(fakeDb(rows), "any-issuer", OUR_USER_ID, 10)`
- Line ~263: `selectReaderDocuments(fakeDb(rows), "any-issuer", 10)` → `selectReaderDocuments(fakeDb(rows), "any-issuer", OUR_USER_ID, 10)`

---

## Task 7: Add new integration test — user-scoped source visibility

**Files:**
- Modify: `services/analyst-grids/test/reader-documents.test.ts` (append new test block)

This test seeds two sources with different `user_id` values:
1. A source owned by `OTHER_USER_ID` → its document must NOT be returned for `OUR_USER_ID`
2. A source owned by `OUR_USER_ID` → its document MUST be returned

Both sources have `kind = 'filing'` and `license_class = 'public'` to ensure no other filter rejects them.

- [ ] **Step 1: Add user-scope integration test**

Append after the last integration test (line ~174, before the "Pure unit tests" comment):

```ts
test("selectReaderDocuments — source owned by other user is excluded; source owned by our user is included", async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker not available");
    return;
  }

  const { databaseUrl } = await bootstrapDatabase(t, "reader-docs-user-scope");
  const db = await connectedClient(t, databaseUrl);

  // Seed the two users
  await db.query(`insert into users (user_id, email) values ($1, $2)`, [OUR_USER_ID, "our@test.dev"]);
  await db.query(`insert into users (user_id, email) values ($1, $2)`, [OTHER_USER_ID, "other@test.dev"]);

  const SOURCE_OUR_ID = "11111111-1111-4111-a111-100000000001";
  const SOURCE_OTHER_ID = "11111111-1111-4111-a111-100000000002";

  // Source owned by OTHER_USER_ID
  await db.query(
    `insert into sources (source_id, provider, kind, trust_tier, license_class, retrieved_at, content_hash, user_id)
     values ($1, 'test', 'filing', 'primary', 'public', now(), 'hother', $2)`,
    [SOURCE_OTHER_ID, OTHER_USER_ID],
  );

  // Source owned by OUR_USER_ID
  await db.query(
    `insert into sources (source_id, provider, kind, trust_tier, license_class, retrieved_at, content_hash, user_id)
     values ($1, 'test', 'filing', 'primary', 'public', now(), 'hour', $2)`,
    [SOURCE_OUR_ID, OUR_USER_ID],
  );

  const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();

  // Doc from OTHER's source — mentions issuer X
  const dOtherDocId = await seedDocument(db, {
    sourceId: SOURCE_OTHER_ID,
    kind: "filing",
    publishedAt: tenDaysAgo,
    rawBlobId: "sha256:" + "e".repeat(64),
    contentHash: "hash-dother",
  });
  await seedMention(db, dOtherDocId, ISSUER_X_ID);

  // Doc from OUR source — mentions issuer X
  const dOurDocId = await seedDocument(db, {
    sourceId: SOURCE_OUR_ID,
    kind: "filing",
    publishedAt: tenDaysAgo,
    rawBlobId: "sha256:" + "f".repeat(64),
    contentHash: "hash-dour",
  });
  await seedMention(db, dOurDocId, ISSUER_X_ID);

  const rows = await selectReaderDocuments(db, ISSUER_X_ID, OUR_USER_ID, 10);

  const ids = rows.map((r) => r.document_id);
  assert.ok(!ids.includes(dOtherDocId), "doc from other user's source must not appear");
  assert.ok(ids.includes(dOurDocId), "doc from our user's source must appear");
});
```

---

## Task 8: Add unit test — `created_at` fallback in JS sort

**Files:**
- Modify: `services/analyst-grids/test/reader-documents.test.ts` (append after last unit test)

`ReaderDocumentRow` now includes `created_at`. The `makeRow` helper and the `fakeDb` function use `ReaderDocumentRow`. We need to add `created_at` to `makeRow`'s defaults and prove the fallback path works.

- [ ] **Step 1: Update `makeRow` helper to include `created_at`**

The `makeRow` helper (lines ~179–188) currently:

```ts
function makeRow(
  overrides: Partial<ReaderDocumentRow> & { document_id: string },
): ReaderDocumentRow {
  return {
    source_id: "src",
    raw_blob_id: "sha256:" + "0".repeat(64),
    doc_kind: "article",
    published_at: null,
    ...overrides,
  };
}
```

Change to:

```ts
function makeRow(
  overrides: Partial<ReaderDocumentRow> & { document_id: string },
): ReaderDocumentRow {
  return {
    source_id: "src",
    raw_blob_id: "sha256:" + "0".repeat(64),
    doc_kind: "article",
    published_at: null,
    created_at: "2020-01-01T00:00:00Z",
    ...overrides,
  };
}
```

- [ ] **Step 2: Add unit test for `created_at` fallback**

Append this test at the end of the file (after the last `test(...)` block):

```ts
test("selectReaderDocuments unit — created_at used as recency fallback when published_at is null", async () => {
  // Both rows have published_at = null; created_at determines recency order.
  // The JS sort coalesces to created_at when published_at is null, so the row
  // with the newer created_at must rank first within the same kind.
  const rows = [
    makeRow({ document_id: "id-old-created", doc_kind: "filing", published_at: null, created_at: "2024-01-01T00:00:00Z" }),
    makeRow({ document_id: "id-new-created", doc_kind: "filing", published_at: null, created_at: "2025-06-01T00:00:00Z" }),
  ];

  const result = await selectReaderDocuments(fakeDb(rows), "any-issuer", OUR_USER_ID, 10);
  assert.equal(
    result[0].document_id,
    "id-new-created",
    "row with newer created_at should rank first when published_at is null for both",
  );
});
```

---

## Task 9: Run tests (first run) and verify green

- [ ] **Step 1: Run tests**

```bash
cd /Users/admin/Documents/Work/market-agent/services/analyst-grids && npm test 2>&1
```

Expected: all tests pass. If Docker is not available, Docker-gated tests are skipped (not failed).

- [ ] **Step 2: Fix any failures**

If any test fails due to a type mismatch or a missed call site, identify and fix it before proceeding. Common issues:
- A unit test for `null published_at` (the existing test "null published_at treated as empty string") still passes because `b.created_at` is always `"2020-01-01T00:00:00Z"` (from `makeRow` default) which is > `""`, and the existing assertion checks `id-dated` first which has `published_at: "2025-01-01"` — still correct.
- The `cell-runner.test.ts` (integration test, Docker) does not construct `ComputeCellInput` manually but calls `computeAndPersistCell` directly — check line 52–62. The call object there does not include `userId`. This needs `userId` added.

If `cell-runner.test.ts` fails, find the `computeAndPersistCell` call there and add `userId: randomUUID()` to the input object.

---

## Task 10: Run tests (second run) and verify green again

- [ ] **Step 1: Run tests a second time**

```bash
cd /Users/admin/Documents/Work/market-agent/services/analyst-grids && npm test 2>&1
```

Expected: same result, fully green (or same skips). This confirms no flakiness.

---

## Task 11: Commit

- [ ] **Step 1: Stage and commit**

```bash
git add services/analyst-grids/src services/analyst-grids/test
git commit -m "fix(analyst-grids): user-scoped document visibility + rank-aware candidate cap in reader selection"
```

---

## Self-Review

**Spec coverage check:**

| Requirement | Task |
|---|---|
| Issue 1: user-scoped source visibility — add `and (s.user_id is null or s.user_id = $3::uuid)` | Task 4 |
| Issue 1: new `userId` param on `selectReaderDocuments` | Task 4 |
| Issue 1: add `userId` to `GridColumnContext` | Task 1 |
| Issue 1: add `userId` to `ComputeCellInput`, pass to producer ctx | Task 2 |
| Issue 1: thread userId through `runWorker` ctx | Task 3 |
| Issue 2: inner/outer SQL restructure, priority ORDER BY before LIMIT 200 | Task 4 |
| Issue 3: JS coalesce on `created_at`, brief comment | Task 4 |
| Update existing tests for new signature (pass userId) | Tasks 5, 6 |
| Integration test: other user's private source excluded, our source included | Task 7 |
| Unit test: `created_at` fallback | Task 8 |
| Run tests twice, both green | Tasks 9, 10 |
| Commit with specified message | Task 11 |

**Placeholder scan:** No TBDs or "implement later" present. All code blocks are complete.

**Type consistency check:**
- `ReaderDocumentRow.created_at: string` — added in Task 4, defaulted in `makeRow` update in Task 8. ✓
- `GridColumnContext.userId: string` — added Task 1, populated in Task 2 (cell-runner producer call), used in producer (future task). ✓
- `ComputeCellInput.userId: string` — added Task 2, populated Task 3, passed as `input.userId`. ✓
- `runWorker` ctx type includes `userId: string` — Task 3. ✓
- All test CTX/INPUT constants updated in Tasks 5, 6. ✓
- `cell-runner.test.ts` integration test — flagged in Task 9 as a potential catch if the call there lacks `userId`. ✓
