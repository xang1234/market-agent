# Analyst Grid — Run Engine + Web UI Implementation Plan (Plan 2 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Plan-1 foundation (grid CRUD + one sealed deterministic column) into a working analyst surface: an async in-process run engine that fans columns across a capped universe, a per-row period resolver, run-status polling endpoints, and a web grid that renders each cell's state and opens the existing evidence inspector on click.

**Architecture:** A detached in-process worker (`run-engine.ts`) resolves the universe (cap 25), inserts `grid_runs`/`grid_rows`/`grid_cells` as `pending`, returns a run id immediately, then concurrently resolves each row's `PeriodContext` and drives the existing `computeAndPersistCell` per (row, column), finalizing the run as `completed`/`partial`/`failed`. New query helpers track progress atomically. Two new HTTP routes start a run and return its detail; the web client polls until terminal and renders a `GridTable` whose cells call `useEvidenceInspector().openInspection`.

**Tech Stack:** TypeScript run via `node --experimental-strip-types` (no typecheck gate — types are stripped, not checked), raw SQL via `pg`, `node:test` + `node:assert/strict`, docker-pg harness (`db/test/docker-pg.ts`) for DB-backed tests, React 19 + `react-dom/server`/JSDOM for web render tests.

**Scope (this plan):** async run engine, `PeriodContext` resolver (fiscal period only; document refs deferred to Plan 3), screen-universe wiring, run-status endpoints + server wiring, web client + polling hook + `GridTable` + minimal `GridBuilder` + route/nav. **Out of scope (Plan 3):** remaining deterministic columns, reader/claim-extraction columns, document-to-issuer linkage, cell caching, saved templates, stalled-run sweep.

---

## File Structure

**Backend — `services/analyst-grids/src/`:**
- `queries.ts` *(modify)* — add run-progress helpers: `loadRunForUser`, `setRunStatus`, `markRowResolved`, `markRowFailed`, `bumpCellDone`, `getRunDetail`.
- `period-context.ts` *(create)* — `resolvePeriodContext(db, subject)`: latest-fact fiscal period for an issuer; `null` for non-issuers.
- `column-catalog.ts` *(modify)* — widen `PeriodContext` to the stable resolved shape (adds `period_start`, `period_end`, `document_refs`).
- `universe-wiring.ts` *(modify)* — implement `resolveScreen` (was throwing) via screener repo + executor with ownership check.
- `run-engine.ts` *(create)* — `startGridRun` (synchronous setup + detached worker) and `runWithConcurrency`.
- `http.ts` *(modify)* — add `POST /v1/analyst-grids/:gridId/runs` and `GET /v1/analyst-grids/runs/:runId`; widen `createAnalystGridsServer` deps to accept `pool` + `universe`.
- `dev.ts` *(modify)* — construct `SnapshotClientPool` + `UniverseResolverDeps` and pass to the server.

**Backend — tests `services/analyst-grids/test/`:**
- `run-progress-queries.test.ts` *(create, docker-pg)*
- `period-context.test.ts` *(create, docker-pg)*
- `universe-wiring-screen.test.ts` *(create, fakeDb)*
- `run-engine.test.ts` *(create, docker-pg)* — end-to-end run over the real `latest_market_cap` column.
- `run-engine-unit.test.ts` *(create, fakeDb)* — cap/dropped + concurrency.
- `http-runs.test.ts` *(create)* — POST/GET run endpoints.

**Frontend — `web/src/analyst-grids/`:**
- `gridsTypes.ts` *(create)* — wire types mirroring server payloads.
- `gridsClient.ts` *(create)* — list/create/get grids, fetch columns, create run, get run.
- `useGridRun.ts` *(create)* — polling hook; stops on terminal status.
- `GridTable.tsx` *(create)* — rows × columns renderer; cell click → evidence inspector.
- `GridBuilder.tsx` *(create)* — minimal universe-source + column composer.
- `GridsPage.tsx` *(create)* — page shell: builder + run + table.
- tests: `gridsClient.test.ts`, `useGridRun.test.ts`, `GridTable.test.tsx`, `GridBuilder.test.tsx` *(create)*.

**Frontend — `web/src/App.tsx` + nav** *(modify)* — register `/analyst-grids` route + nav entry.

---

### Task 1: Run-progress query helpers

**Files:**
- Modify: `services/analyst-grids/src/queries.ts`
- Test: `services/analyst-grids/test/run-progress-queries.test.ts`

These helpers let the worker advance run/row/cell state atomically and let the GET endpoint read a run's full detail. `grid_runs.user_id` already exists (migration `0030`), so run ownership is a direct `where user_id = $2` — no join needed.

- [ ] **Step 1: Write the failing test (docker-pg)**

Create `services/analyst-grids/test/run-progress-queries.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { bootstrapDatabase, connectedClient } from "../../../db/test/docker-pg.ts";
import {
  createGrid,
  createRun,
  insertRow,
  insertPendingCell,
  loadRunForUser,
  setRunStatus,
  markRowResolved,
  markRowFailed,
  bumpCellDone,
  getRunDetail,
} from "../src/queries.ts";

const USER = "11111111-1111-4111-a111-111111111111";

async function seedUser(db: { query: (t: string, v?: unknown[]) => Promise<unknown> }) {
  await db.query(
    `insert into users (user_id, email, display_name) values ($1, $2, $3)
     on conflict (user_id) do nothing`,
    [USER, "a@b.co", "A"],
  );
}

test("run progress helpers advance run/row/cell state and read detail", async (t) => {
  const url = await bootstrapDatabase(t, "grid-run-progress");
  const db = await connectedClient(t, url);
  await seedUser(db);

  const grid = await createGrid(db, USER, {
    name: "g",
    description: null,
    universe_spec: { source: "manual", subject_refs: [{ kind: "issuer", id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa" }] },
    column_specs: [{ column_key: "latest_market_cap" }],
  });
  const runId = await createRun(db, { gridId: grid.grid_id, userId: USER, asOf: "2026-06-09T00:00:00.000Z", cellTotal: 1, droppedRowCount: 0 });

  // Ownership: present for owner, absent for a stranger.
  assert.equal((await loadRunForUser(db, USER, runId))?.grid_run_id, runId);
  assert.equal(await loadRunForUser(db, "22222222-2222-4222-a222-222222222222", runId), null);

  const rowId = await insertRow(db, { gridRunId: runId, rowNumber: 0, subjectRef: { kind: "issuer", id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa" } });
  await insertPendingCell(db, { gridRowId: rowId, gridRunId: runId, columnKey: "latest_market_cap" });

  await setRunStatus(db, runId, "running");
  await markRowResolved(db, rowId, { period_kind: "point", fiscal_year: null, fiscal_period: null, period_start: null, period_end: null, document_refs: [] });
  await bumpCellDone(db, runId);
  await setRunStatus(db, runId, "completed", { completedAt: true });

  const detail = await getRunDetail(db, runId);
  assert.equal(detail.run.status, "completed");
  assert.equal(detail.run.cell_done, 1);
  assert.equal(detail.rows.length, 1);
  assert.equal(detail.rows[0].status, "resolved");
  assert.equal(detail.rows[0].period_context?.period_kind, "point");
  assert.equal(detail.cells.length, 1);
  assert.equal(detail.cells[0].column_key, "latest_market_cap");

  await markRowFailed(db, rowId);
  const after = await getRunDetail(db, runId);
  assert.equal(after.rows[0].status, "failed");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd services/analyst-grids && node --experimental-strip-types --test test/run-progress-queries.test.ts`
Expected: FAIL — `loadRunForUser` / `setRunStatus` / `getRunDetail` etc. are not exported.

> If the failure is `Cannot connect to the Docker daemon`, the docker-pg harness can't run locally; the suite will run in CI's `analyst-grids (integration tests)` job. In that case verify the module compiles with `node --experimental-strip-types --check services/analyst-grids/src/queries.ts` and proceed; flag that the docker test was not run locally.

- [ ] **Step 3: Implement the helpers**

Append to `services/analyst-grids/src/queries.ts`. These helpers define their own `RunStatus`/`RowStatus` types here (the canonical home for run/row state) and take the period as an opaque `Record<string, unknown>` so this task has no dependency on Task 2's `ResolvedPeriod`:

```ts
// ---- Run progress + detail (Plan 2) ----

export type RunStatus = "pending" | "running" | "partial" | "completed" | "failed";
export type RowStatus = "pending" | "resolved" | "failed";

export type GridRunRow = {
  grid_run_id: string;
  grid_id: string;
  user_id: string;
  status: RunStatus;
  as_of: string;
  cell_total: number;
  cell_done: number;
  dropped_row_count: number;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
};

const RUN_COLUMNS = `grid_run_id::text as grid_run_id,
       grid_id::text as grid_id,
       user_id::text as user_id,
       status, as_of, cell_total, cell_done, dropped_row_count,
       error_message, started_at, completed_at`;

function runFromDb(row: Record<string, unknown>): GridRunRow {
  return {
    grid_run_id: String(row.grid_run_id),
    grid_id: String(row.grid_id),
    user_id: String(row.user_id),
    status: row.status as RunStatus,
    as_of: iso(row.as_of as Date | string),
    cell_total: Number(row.cell_total),
    cell_done: Number(row.cell_done),
    dropped_row_count: Number(row.dropped_row_count),
    error_message: (row.error_message as string | null) ?? null,
    started_at: iso(row.started_at as Date | string),
    completed_at: row.completed_at == null ? null : iso(row.completed_at as Date | string),
  };
}

// Returns the run only when it belongs to userId — the ownership guard for the
// GET endpoint (grid_runs.user_id is denormalized so no join is needed).
export async function loadRunForUser(
  db: QueryExecutor,
  userId: string,
  runId: string,
): Promise<GridRunRow | null> {
  const result = await db.query(
    `select ${RUN_COLUMNS} from grid_runs where grid_run_id = $1 and user_id = $2`,
    [runId, userId],
  );
  return result.rows[0] ? runFromDb(result.rows[0]) : null;
}

export async function setRunStatus(
  db: QueryExecutor,
  runId: string,
  status: RunStatus,
  opts: { completedAt?: boolean; errorMessage?: string } = {},
): Promise<void> {
  await db.query(
    `update grid_runs
        set status = $2,
            completed_at = case when $3 then now() else completed_at end,
            error_message = coalesce($4, error_message)
      where grid_run_id = $1`,
    [runId, status, opts.completedAt === true, opts.errorMessage ?? null],
  );
}

export async function markRowResolved(
  db: QueryExecutor,
  gridRowId: string,
  period: Record<string, unknown> | null,
): Promise<void> {
  await db.query(
    `update grid_rows set status = 'resolved', period_context = $2::jsonb where grid_row_id = $1`,
    [gridRowId, period === null ? null : JSON.stringify(period)],
  );
}

export async function markRowFailed(db: QueryExecutor, gridRowId: string): Promise<void> {
  await db.query(`update grid_rows set status = 'failed' where grid_row_id = $1`, [gridRowId]);
}

// Atomic increment; the (cell_done <= cell_total) CHECK on grid_runs guards
// against over-counting.
export async function bumpCellDone(db: QueryExecutor, runId: string): Promise<void> {
  await db.query(`update grid_runs set cell_done = cell_done + 1 where grid_run_id = $1`, [runId]);
}

export type GridRowDetail = {
  grid_row_id: string;
  row_number: number;
  subject_ref: SubjectRef;
  period_context: Record<string, unknown> | null;
  status: RowStatus;
};

export type GridCellDetail = {
  grid_cell_id: string;
  grid_row_id: string;
  column_key: string;
  status: string;
  display: { value: string; tone: "best" | "worst" | null } | null;
  snapshot_id: string | null;
  primary_ref: { kind: "fact" | "claim"; id: string } | null;
  coverage_flag: string | null;
};

export type GridRunDetail = { run: GridRunRow; rows: GridRowDetail[]; cells: GridCellDetail[] };

export async function getRunDetail(db: QueryExecutor, runId: string): Promise<GridRunDetail> {
  const runRes = await db.query(`select ${RUN_COLUMNS} from grid_runs where grid_run_id = $1`, [runId]);
  if (!runRes.rows[0]) throw new GridNotFoundError("grid run not found");
  const rowsRes = await db.query(
    `select grid_row_id::text as grid_row_id, row_number, subject_ref, period_context, status
       from grid_rows where grid_run_id = $1 order by row_number asc`,
    [runId],
  );
  const cellsRes = await db.query(
    `select grid_cell_id::text as grid_cell_id, grid_row_id::text as grid_row_id, column_key,
            status, display, snapshot_id::text as snapshot_id, primary_ref, coverage_flag
       from grid_cells where grid_run_id = $1`,
    [runId],
  );
  return {
    run: runFromDb(runRes.rows[0]),
    rows: rowsRes.rows.map((r) => ({
      grid_row_id: String(r.grid_row_id),
      row_number: Number(r.row_number),
      subject_ref: r.subject_ref as SubjectRef,
      period_context: (r.period_context as Record<string, unknown> | null) ?? null,
      status: r.status as RowStatus,
    })),
    cells: cellsRes.rows.map((c) => ({
      grid_cell_id: String(c.grid_cell_id),
      grid_row_id: String(c.grid_row_id),
      column_key: String(c.column_key),
      status: String(c.status),
      display: (c.display as GridCellDetail["display"]) ?? null,
      snapshot_id: (c.snapshot_id as string | null) ?? null,
      primary_ref: (c.primary_ref as GridCellDetail["primary_ref"]) ?? null,
      coverage_flag: (c.coverage_flag as string | null) ?? null,
    })),
  };
}
```

Note: `iso`, `GridNotFoundError`, `SubjectRef`, and `QueryExecutor` are already imported/defined at the top of `queries.ts` (verify the `import` from `./types.ts` includes `GridNotFoundError`; it does as of Plan 1).

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd services/analyst-grids && node --experimental-strip-types --test test/run-progress-queries.test.ts`
Expected: PASS (or docker-unavailable per Step 2 caveat).

- [ ] **Step 5: Commit**

```bash
git add services/analyst-grids/src/queries.ts services/analyst-grids/test/run-progress-queries.test.ts
git commit -m "feat(analyst-grids): run-progress query helpers (load/status/row/cell/detail)"
```

---

### Task 2: PeriodContext resolver (fiscal period from latest fact)

**Files:**
- Modify: `services/analyst-grids/src/column-catalog.ts` (widen `PeriodContext`)
- Create: `services/analyst-grids/src/period-context.ts`
- Test: `services/analyst-grids/test/period-context.test.ts`

The resolver finds an issuer's most recently reported fiscal period from `facts` and returns it as a stable `ResolvedPeriod`. `document_refs` is `[]` — documents have no subject linkage yet (no `document_subjects` table; resolving the backing document is a Plan-3 problem). Non-issuer subjects resolve to `null`.

- [ ] **Step 1: Widen the `PeriodContext` type**

In `services/analyst-grids/src/column-catalog.ts`, replace the existing `PeriodContext` definition:

```ts
// A grid cell's period context. Plan 2 fills the fiscal period from the
// subject's latest fact; document_refs stays [] until Plan 3 wires
// document→issuer linkage. null means "no period resolved" (non-issuer rows).
export type ResolvedPeriod = {
  period_kind: string;
  fiscal_year: number | null;
  fiscal_period: string | null;
  period_start: string | null;
  period_end: string | null;
  document_refs: ReadonlyArray<{ kind: "document"; id: string; doc_kind: string }>;
};
export type PeriodContext = null | ResolvedPeriod;
```

(The existing `latestMarketCapProducer` reads `ctx.period` but ignores it, so widening is additive. There is no typecheck gate — types are stripped — so this is runtime-safe.)

- [ ] **Step 2: Write the failing test (docker-pg)**

Create `services/analyst-grids/test/period-context.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { bootstrapDatabase, connectedClient } from "../../../db/test/docker-pg.ts";
import { resolvePeriodContext } from "../src/period-context.ts";

const ISSUER = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const SOURCE = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";

// Inserts a metric + source + one fiscal_q fact for the issuer.
async function seedFact(
  db: { query: (t: string, v?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> },
  period: { period_kind: string; fiscal_year: number | null; fiscal_period: string | null; period_end: string | null; as_of: string },
) {
  await db.query(
    `insert into sources (source_id, provider, kind, trust_tier, license_class, retrieved_at, content_hash)
     values ($1, 'test', 'filing', 'tier_a', 'public', now(), 'h')
     on conflict (source_id) do nothing`,
    [SOURCE],
  );
  const metric = await db.query(
    `insert into metrics (metric_key, label, value_kind) values ('revenue', 'Revenue', 'currency')
     on conflict (metric_key) do update set label = excluded.label
     returning metric_id::text as metric_id`,
  );
  await db.query(
    `insert into facts (subject_kind, subject_id, metric_id, period_kind, period_end, fiscal_year, fiscal_period,
                        value_num, unit, as_of, observed_at, source_id, method, verification_status,
                        freshness_class, coverage_level, confidence, entitlement_channels)
     values ('issuer', $1, $2, $3, $4, $5, $6, 100, 'USD', $7, $7, $8, 'reported', 'verified', 'fresh', 'full', 1, array['app'])`,
    [ISSUER, metric.rows[0].metric_id, period.period_kind, period.period_end, period.fiscal_year, period.fiscal_period, period.as_of, SOURCE],
  );
}

test("resolvePeriodContext returns the latest reported fiscal period for an issuer", async (t) => {
  const url = await bootstrapDatabase(t, "grid-period");
  const db = await connectedClient(t, url);
  await seedFact(db, { period_kind: "fiscal_q", fiscal_year: 2025, fiscal_period: "Q1", period_end: "2025-03-31", as_of: "2025-04-15T00:00:00.000Z" });
  await seedFact(db, { period_kind: "fiscal_q", fiscal_year: 2025, fiscal_period: "Q2", period_end: "2025-06-30", as_of: "2025-07-15T00:00:00.000Z" });

  const period = await resolvePeriodContext(db, { kind: "issuer", id: ISSUER });
  assert.equal(period?.fiscal_year, 2025);
  assert.equal(period?.fiscal_period, "Q2");
  assert.equal(period?.period_kind, "fiscal_q");
  assert.equal(period?.period_end, "2025-06-30");
  assert.deepEqual(period?.document_refs, []);
});

test("resolvePeriodContext returns null for a non-issuer subject", async (t) => {
  const url = await bootstrapDatabase(t, "grid-period-nonissuer");
  const db = await connectedClient(t, url);
  const period = await resolvePeriodContext(db, { kind: "instrument", id: ISSUER });
  assert.equal(period, null);
});

test("resolvePeriodContext returns null when the issuer has no facts", async (t) => {
  const url = await bootstrapDatabase(t, "grid-period-empty");
  const db = await connectedClient(t, url);
  const period = await resolvePeriodContext(db, { kind: "issuer", id: "cccccccc-cccc-4ccc-cccc-cccccccccccc" });
  assert.equal(period, null);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd services/analyst-grids && node --experimental-strip-types --test test/period-context.test.ts`
Expected: FAIL — `resolvePeriodContext` not found (or docker-unavailable per the caveat in Task 1 Step 2).

- [ ] **Step 4: Implement the resolver**

Create `services/analyst-grids/src/period-context.ts`:

```ts
import type { SubjectRef } from "../../shared/src/subject-ref.ts";
import type { QueryExecutor } from "./types.ts";
import type { ResolvedPeriod } from "./column-catalog.ts";

// Resolves the subject's most recently reported fiscal period from facts.
// Only issuers carry fiscal periods; everything else resolves to null. The
// "latest" fact is the one with the newest as_of among live facts.
// document_refs is intentionally empty in Plan 2 — documents have no
// subject linkage yet (resolving the backing document is a Plan-3 concern).
export async function resolvePeriodContext(
  db: QueryExecutor,
  subject: SubjectRef,
): Promise<ResolvedPeriod | null> {
  if (subject.kind !== "issuer") return null;
  const { rows } = await db.query<{
    period_kind: string;
    fiscal_year: number | null;
    fiscal_period: string | null;
    period_start: string | null;
    period_end: string | null;
  }>(
    `select f.period_kind,
            f.fiscal_year,
            f.fiscal_period,
            f.period_start::text as period_start,
            f.period_end::text as period_end
       from facts f
      where f.subject_kind = 'issuer'
        and f.subject_id = $1
        and f.invalidated_at is null
        and f.superseded_by is null
      order by f.as_of desc, f.period_end desc nulls last
      limit 1`,
    [subject.id],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    period_kind: row.period_kind,
    fiscal_year: row.fiscal_year,
    fiscal_period: row.fiscal_period,
    period_start: row.period_start,
    period_end: row.period_end,
    document_refs: [],
  };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd services/analyst-grids && node --experimental-strip-types --test test/period-context.test.ts`
Expected: PASS (or docker-unavailable per the caveat).

- [ ] **Step 6: Commit**

```bash
git add services/analyst-grids/src/column-catalog.ts services/analyst-grids/src/period-context.ts services/analyst-grids/test/period-context.test.ts
git commit -m "feat(analyst-grids): per-row PeriodContext resolver (latest fiscal period)"
```

---

### Task 3: Wire screen-universe resolution

**Files:**
- Modify: `services/analyst-grids/src/universe-wiring.ts`
- Test: `services/analyst-grids/test/universe-wiring-screen.test.ts`

Plan 1 left `resolveScreen` throwing "not wired until Plan 2". A screen resolves in two hops: load the saved screen (and check ownership), then execute its replayed query against the live candidate registry. `ScreenerSubjectRef.kind` (`issuer|instrument|listing`) is a subset of `SubjectKind`, so rows map directly.

- [ ] **Step 1: Write the failing test (fakeDb + injected screener fns)**

The real screener repo/executor hit Postgres; to unit-test the *wiring logic* (ownership check + row mapping) without docker, refactor `resolveScreen` to take the screener primitives as injectable parameters with production defaults. Create `services/analyst-grids/test/universe-wiring-screen.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { resolveScreenWith } from "../src/universe-wiring.ts";
import { GridValidationError } from "../src/types.ts";

const USER = "11111111-1111-4111-a111-111111111111";
const SCREEN = "55555555-5555-4555-a555-555555555555";

const FAKE_SCREEN = { screen_id: SCREEN, user_id: USER, name: "s", definition: { market: [], sort: [], page: { limit: 10 } }, created_at: "x", updated_at: "x" };

test("resolveScreenWith maps executed screen rows to subject refs", async () => {
  const refs = await resolveScreenWith(
    { find: async () => FAKE_SCREEN, execute: async () => ({ rows: [{ subject_ref: { kind: "issuer", id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa" } }] }) },
    USER,
    SCREEN,
  );
  assert.equal(refs.length, 1);
  assert.equal(refs[0].kind, "issuer");
});

test("resolveScreenWith denies a screen the user does not own", async () => {
  await assert.rejects(
    () => resolveScreenWith({ find: async () => ({ ...FAKE_SCREEN, user_id: "other" }), execute: async () => ({ rows: [] }) }, USER, SCREEN),
    GridValidationError,
  );
});

test("resolveScreenWith denies a missing screen", async () => {
  await assert.rejects(
    () => resolveScreenWith({ find: async () => null, execute: async () => ({ rows: [] }) }, USER, SCREEN),
    GridValidationError,
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd services/analyst-grids && node --experimental-strip-types --test test/universe-wiring-screen.test.ts`
Expected: FAIL — `resolveScreenWith` not exported.

- [ ] **Step 3: Implement the wiring**

In `services/analyst-grids/src/universe-wiring.ts`, add the screener imports and the testable core, and replace the throwing `resolveScreen`:

```ts
import { createPostgresScreenRepository, replayScreen, type ScreenSubject } from "../../screener/src/screen-repository.ts";
import { createPostgresCandidateRepository } from "../../screener/src/db-candidates.ts";
import { executeScreenerQuery } from "../../screener/src/executor.ts";
```

(If `replayScreen` is exported from `screen-subject.ts` rather than `screen-repository.ts`, import it from `../../screener/src/screen-subject.ts` — verify the export site before writing.)

Add the injectable core and a production binder:

```ts
// The minimal screener surface resolveScreen needs, injected so the mapping +
// ownership logic is unit-testable without Postgres.
export type ScreenResolverPorts = {
  find: (screenId: string) => Promise<ScreenSubject | null>;
  execute: (screen: ScreenSubject) => Promise<{ rows: ReadonlyArray<{ subject_ref: { kind: string; id: string } }> }>;
};

export async function resolveScreenWith(
  ports: ScreenResolverPorts,
  userId: string,
  screenId: string,
): Promise<ReadonlyArray<SubjectRef>> {
  const screen = await ports.find(screenId);
  if (!screen || screen.user_id !== userId) {
    throw new GridValidationError("screen not found or not accessible");
  }
  const result = await ports.execute(screen);
  return result.rows.map((r) => ({ kind: r.subject_ref.kind, id: r.subject_ref.id }) as SubjectRef);
}
```

Then inside `createUniverseResolverDeps`, replace the throwing `resolveScreen` with a binding that constructs the real ports:

```ts
    resolveScreen: async (userId: string, screenId: string): Promise<ReadonlyArray<SubjectRef>> => {
      const screens = createPostgresScreenRepository(db as never);
      const candidates = createPostgresCandidateRepository(db as never);
      return resolveScreenWith(
        {
          find: (id) => screens.find(id),
          execute: (screen) => executeScreenerQuery({ candidates, clock: () => new Date() }, replayScreen(screen)),
        },
        userId,
        screenId,
      );
    },
```

(`db as never` mirrors the existing per-service `QueryExecutor` casts already in this file — the canonical-QueryExecutor consolidation that removes them is tracked as fra-allm.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd services/analyst-grids && node --experimental-strip-types --test test/universe-wiring-screen.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify the existing universe-wiring tests still pass**

Run: `cd services/analyst-grids && node --experimental-strip-types --test test/universe-wiring.test.ts`
Expected: PASS (the watchlist/portfolio resolvers are unchanged).

- [ ] **Step 6: Commit**

```bash
git add services/analyst-grids/src/universe-wiring.ts services/analyst-grids/test/universe-wiring-screen.test.ts
git commit -m "feat(analyst-grids): wire screen-universe resolution (replay + execute, owner-scoped)"
```

---

### Task 4: Async run engine + worker

**Files:**
- Create: `services/analyst-grids/src/run-engine.ts`
- Test: `services/analyst-grids/test/run-engine.test.ts` (docker-pg, end-to-end)
- Test: `services/analyst-grids/test/run-engine-unit.test.ts` (fakeDb, cap/concurrency)

`startGridRun` does the synchronous setup (resolve universe, cap at 25, insert run/rows/cells, set `cell_total`) and returns `{ runId, status: 'pending' }`, then kicks a **detached** worker. The worker resolves each row's period and drives the existing `computeAndPersistCell` per (row, column), bumping `cell_done`, and finalizes the run. A per-cell producer error never fails the run (that cell is marked `error` inside `computeAndPersistCell`); only a run-level throw sets `failed`.

- [ ] **Step 1: Write the failing unit test (fakeDb — cap + dropped + concurrency)**

Create `services/analyst-grids/test/run-engine-unit.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { runWithConcurrency, capUniverse, MAX_GRID_ROWS } from "../src/run-engine.ts";

test("capUniverse caps at MAX_GRID_ROWS and reports the dropped count", () => {
  const refs = Array.from({ length: 30 }, (_, i) => ({ kind: "issuer" as const, id: `id-${i}` }));
  const { capped, droppedRowCount } = capUniverse(refs);
  assert.equal(capped.length, MAX_GRID_ROWS);
  assert.equal(droppedRowCount, 30 - MAX_GRID_ROWS);
});

test("capUniverse leaves a small universe untouched", () => {
  const refs = [{ kind: "issuer" as const, id: "a" }];
  const { capped, droppedRowCount } = capUniverse(refs);
  assert.equal(capped.length, 1);
  assert.equal(droppedRowCount, 0);
});

test("runWithConcurrency runs all tasks and never exceeds the limit", async () => {
  let active = 0;
  let peak = 0;
  const results = await runWithConcurrency([1, 2, 3, 4, 5, 6], 2, async (n) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 5));
    active -= 1;
    return n * 2;
  });
  assert.deepEqual(results.sort((a, b) => a - b), [2, 4, 6, 8, 10, 12]);
  assert.ok(peak <= 2, `peak concurrency ${peak} exceeded 2`);
});
```

- [ ] **Step 2: Run the unit test to verify it fails**

Run: `cd services/analyst-grids && node --experimental-strip-types --test test/run-engine-unit.test.ts`
Expected: FAIL — `run-engine.ts` does not exist.

- [ ] **Step 3: Implement the run engine**

Create `services/analyst-grids/src/run-engine.ts`:

```ts
import type { SubjectRef } from "../../shared/src/subject-ref.ts";
import type { SnapshotClientPool } from "../../snapshot/src/snapshot-sealer.ts";
import { getGrid, createRun, insertRow, insertPendingCell, setRunStatus, markRowResolved, markRowFailed, bumpCellDone, getRunDetail } from "./queries.ts";
import { resolveUniverse, type UniverseResolverDeps } from "./universe.ts";
import { resolvePeriodContext } from "./period-context.ts";
import { getColumn } from "./column-catalog.ts";
import { computeAndPersistCell } from "./cell-runner.ts";
import { GridValidationError, type QueryExecutor } from "./types.ts";

export const MAX_GRID_ROWS = 25;
const ROW_CONCURRENCY = 4;

export type RunEngineDeps = {
  db: QueryExecutor;
  pool: SnapshotClientPool;
  universe: UniverseResolverDeps;
};

export function capUniverse(refs: ReadonlyArray<SubjectRef>): { capped: ReadonlyArray<SubjectRef>; droppedRowCount: number } {
  if (refs.length <= MAX_GRID_ROWS) return { capped: refs, droppedRowCount: 0 };
  return { capped: refs.slice(0, MAX_GRID_ROWS), droppedRowCount: refs.length - MAX_GRID_ROWS };
}

// Minimal bounded-concurrency map (no p-limit dependency): at most `limit`
// tasks in flight, preserving result order by index.
export async function runWithConcurrency<T, R>(
  items: ReadonlyArray<T>,
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

export type StartRunResult = { runId: string; status: "pending" };

// Synchronous setup + detached worker. Resolves and caps the universe, inserts
// the run/rows/cells, returns immediately, then runs the worker in the
// background. Universe-resolution failures throw here (surfaced as 400) and no
// run is created.
export async function startGridRun(
  deps: RunEngineDeps,
  input: { gridId: string; userId: string; asOf: string },
): Promise<StartRunResult> {
  const grid = await getGrid(deps.db, input.userId, input.gridId);
  const columns = grid.column_specs.map((spec) => {
    const column = getColumn(spec.column_key);
    if (!column) throw new GridValidationError(`unknown column_key: ${spec.column_key}`);
    return column;
  });

  const resolved = await resolveUniverse(deps.universe, input.userId, grid.universe_spec);
  const { capped, droppedRowCount } = capUniverse(resolved);
  const cellTotal = capped.length * columns.length;

  const runId = await createRun(deps.db, {
    gridId: grid.grid_id,
    userId: input.userId,
    asOf: input.asOf,
    cellTotal,
    droppedRowCount,
  });

  const rows = await Promise.all(
    capped.map(async (subject, rowNumber) => {
      const gridRowId = await insertRow(deps.db, { gridRunId: runId, rowNumber, subjectRef: subject });
      for (const column of columns) {
        await insertPendingCell(deps.db, { gridRowId, gridRunId: runId, columnKey: column.column_key });
      }
      return { gridRowId, subject };
    }),
  );

  if (droppedRowCount > 0) {
    console.log(`analyst-grids run ${runId}: universe of ${resolved.length} capped to ${MAX_GRID_ROWS} (dropped ${droppedRowCount})`);
  }

  // Detached: the caller already has its run id. Never let the worker reject
  // unhandled — finalizeRun catches everything and records run-level failure.
  void runWorker(deps, { runId, rows, columns, asOf: input.asOf });

  return { runId, status: "pending" };
}

async function runWorker(
  deps: RunEngineDeps,
  ctx: { runId: string; rows: Array<{ gridRowId: string; subject: SubjectRef }>; columns: ReturnType<typeof getColumn>[]; asOf: string },
): Promise<void> {
  try {
    await setRunStatus(deps.db, ctx.runId, "running");
    await runWithConcurrency(ctx.rows, ROW_CONCURRENCY, async ({ gridRowId, subject }) => {
      let period;
      try {
        period = await resolvePeriodContext(deps.db, subject);
        await markRowResolved(deps.db, gridRowId, period);
      } catch {
        await markRowFailed(deps.db, gridRowId);
        period = null;
      }
      for (const column of ctx.columns) {
        if (!column) continue;
        await computeAndPersistCell(
          { db: deps.db, pool: deps.pool },
          { column, gridRowId, subject, period, asOf: ctx.asOf },
        );
        await bumpCellDone(deps.db, ctx.runId);
      }
    });

    // partial when any cell errored, else completed.
    const detail = await getRunDetail(deps.db, ctx.runId);
    const anyError = detail.cells.some((c) => c.status === "error");
    await setRunStatus(deps.db, ctx.runId, anyError ? "partial" : "completed", { completedAt: true });
  } catch (error) {
    await setRunStatus(deps.db, ctx.runId, "failed", {
      completedAt: true,
      errorMessage: error instanceof Error ? error.message : "run failed",
    });
  }
}
```

- [ ] **Step 4: Run the unit test to verify it passes**

Run: `cd services/analyst-grids && node --experimental-strip-types --test test/run-engine-unit.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the end-to-end docker-pg test**

Create `services/analyst-grids/test/run-engine.test.ts`. It seeds a `market_cap` fact for an issuer, creates a grid with the `latest_market_cap` column, starts a run, polls `getRunDetail` until terminal, and asserts a sealed, inspectable cell.

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { bootstrapDatabase } from "../../../db/test/docker-pg.ts";
import { createGrid, getRunDetail } from "../src/queries.ts";
import { startGridRun } from "../src/run-engine.ts";
import { createUniverseResolverDeps } from "../src/universe-wiring.ts";

const USER = "11111111-1111-4111-a111-111111111111";
const ISSUER = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const SOURCE = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";

async function poll<T>(fn: () => Promise<T>, until: (v: T) => boolean, tries = 50): Promise<T> {
  for (let i = 0; i < tries; i++) {
    const v = await fn();
    if (until(v)) return v;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("poll timed out");
}

test("startGridRun runs a deterministic column end-to-end and seals an inspectable cell", async (t) => {
  const url = await bootstrapDatabase(t, "grid-run-e2e");
  const pool = new Pool({ connectionString: url });
  t.after(() => pool.end());
  const db = pool;

  await db.query(`insert into users (user_id, email, display_name) values ($1, 'a@b.co', 'A') on conflict do nothing`, [USER]);
  await db.query(
    `insert into sources (source_id, provider, kind, trust_tier, license_class, retrieved_at, content_hash)
     values ($1, 'test', 'market_data', 'tier_a', 'public', now(), 'h') on conflict (source_id) do nothing`,
    [SOURCE],
  );
  const metric = await db.query(`insert into metrics (metric_key, label, value_kind) values ('market_cap', 'Market Cap', 'currency')
     on conflict (metric_key) do update set label = excluded.label returning metric_id::text as metric_id`);
  await db.query(
    `insert into facts (subject_kind, subject_id, metric_id, period_kind, period_end, value_num, unit, as_of, observed_at,
                        source_id, method, verification_status, freshness_class, coverage_level, confidence, entitlement_channels)
     values ('issuer', $1, $2, 'point', '2026-06-01', 2500000000000, 'USD', now(), now(), $3, 'reported', 'verified', 'fresh', 'full', 1, array['app'])`,
    [ISSUER, metric.rows[0].metric_id, SOURCE],
  );

  const grid = await createGrid(db, USER, {
    name: "mc", description: null,
    universe_spec: { source: "manual", subject_refs: [{ kind: "issuer", id: ISSUER }] },
    column_specs: [{ column_key: "latest_market_cap" }],
  });

  const universe = createUniverseResolverDeps(db);
  const { runId } = await startGridRun({ db, pool, universe }, { gridId: grid.grid_id, userId: USER, asOf: new Date().toISOString() });

  const detail = await poll(() => getRunDetail(db, runId), (d) => d.run.status === "completed" || d.run.status === "partial" || d.run.status === "failed");
  assert.equal(detail.run.status, "completed");
  assert.equal(detail.run.cell_done, 1);
  assert.equal(detail.cells[0].status, "ok");
  assert.ok(detail.cells[0].snapshot_id, "cell should carry a sealed snapshot id");
  assert.equal(detail.cells[0].primary_ref?.kind, "fact");
});
```

- [ ] **Step 6: Run the end-to-end test to verify it passes**

Run: `cd services/analyst-grids && node --experimental-strip-types --test test/run-engine.test.ts`
Expected: PASS (or docker-unavailable per the caveat — in which case rely on CI's `analyst-grids (integration tests)` job).

- [ ] **Step 7: Commit**

```bash
git add services/analyst-grids/src/run-engine.ts services/analyst-grids/test/run-engine.test.ts services/analyst-grids/test/run-engine-unit.test.ts
git commit -m "feat(analyst-grids): async in-process run engine (cap, period, fan-out, finalize)"
```

---

### Task 5: Run HTTP endpoints + server wiring

**Files:**
- Modify: `services/analyst-grids/src/http.ts`
- Modify: `services/analyst-grids/src/dev.ts`
- Test: `services/analyst-grids/test/http-runs.test.ts`

Add `POST /v1/analyst-grids/:gridId/runs` (starts a run, `202`) and `GET /v1/analyst-grids/runs/:runId` (run detail, owner-scoped). The server now needs the `SnapshotClientPool` + `UniverseResolverDeps`, so widen `createAnalystGridsServer` to a single options object and update `dev.ts`.

- [ ] **Step 1: Write the failing HTTP test**

Create `services/analyst-grids/test/http-runs.test.ts`. It uses a fake `QueryExecutor` + fake universe + a no-op pool to exercise the routing/validation and the 404/ownership path without docker. (A full sealed run is covered by Task 4's docker test.)

```ts
import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { QueryResult } from "pg";
import { createAnalystGridsServer } from "../src/http.ts";
import type { QueryExecutor } from "../src/types.ts";

const USER = "11111111-1111-4111-a111-111111111111";
const RUN = "99999999-9999-4999-a999-999999999999";

function fakeDb(responder: (text: string, values?: unknown[]) => unknown[]): QueryExecutor {
  return {
    async query<R extends Record<string, unknown>>(text: string, values?: unknown[]) {
      const rows = responder(text, values) as R[];
      return { rows, rowCount: rows.length, command: "", oid: 0, fields: [] } satisfies QueryResult<R>;
    },
  };
}

async function withServer(db: QueryExecutor, fn: (base: string) => Promise<void>) {
  const server = createAnalystGridsServer({
    db,
    pool: { connect: async () => { throw new Error("pool unused in this test"); } },
    universe: {
      resolveScreen: async () => [], resolveWatchlist: async () => [], resolvePortfolio: async () => [],
      resolvePeers: async () => [],
    },
    auth: { mode: "dev_user_header" },
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
  }
}

test("GET run detail returns 404 when the run is not owned by the user", async () => {
  const db = fakeDb((text) => (text.includes("from grid_runs") ? [] : [])); // loadRunForUser finds nothing
  await withServer(db, async (base) => {
    const res = await fetch(`${base}/v1/analyst-grids/runs/${RUN}`, { headers: { "x-dev-user-id": USER } });
    assert.equal(res.status, 404);
  });
});

test("GET run detail returns the run + rows + cells for the owner", async () => {
  const db = fakeDb((text) => {
    if (text.includes("from grid_runs where grid_run_id = $1 and user_id")) {
      return [{ grid_run_id: RUN, grid_id: "g", user_id: USER, status: "completed", as_of: "2026-06-09T00:00:00.000Z", cell_total: 0, cell_done: 0, dropped_row_count: 0, error_message: null, started_at: "2026-06-09T00:00:00.000Z", completed_at: "2026-06-09T00:01:00.000Z" }];
    }
    if (text.includes("from grid_runs where grid_run_id = $1")) {
      return [{ grid_run_id: RUN, grid_id: "g", user_id: USER, status: "completed", as_of: "2026-06-09T00:00:00.000Z", cell_total: 0, cell_done: 0, dropped_row_count: 0, error_message: null, started_at: "2026-06-09T00:00:00.000Z", completed_at: "2026-06-09T00:01:00.000Z" }];
    }
    return [];
  });
  await withServer(db, async (base) => {
    const res = await fetch(`${base}/v1/analyst-grids/runs/${RUN}`, { headers: { "x-dev-user-id": USER } });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.run.status, "completed");
    assert.deepEqual(body.rows, []);
    assert.deepEqual(body.cells, []);
  });
});

test("POST run requires authentication", async () => {
  const db = fakeDb(() => []);
  await withServer(db, async (base) => {
    const res = await fetch(`${base}/v1/analyst-grids/${RUN}/runs`, { method: "POST" });
    assert.equal(res.status, 401);
  });
});
```

(Confirm the dev auth header name with `services/shared/src/request-auth.ts` — it is `x-dev-user-id` for `mode: "dev_user_header"`. Use whatever that file defines.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd services/analyst-grids && node --experimental-strip-types --test test/http-runs.test.ts`
Expected: FAIL — `createAnalystGridsServer` still takes `(db, options)`, not the new options object, and the run routes don't exist.

- [ ] **Step 3: Widen the server signature and add the run routes**

In `services/analyst-grids/src/http.ts`, change the imports and the factory. Replace the `import` of queries to include the run helpers, and add run-engine + universe types:

```ts
import { createGrid, getGrid, listGrids, loadRunForUser, getRunDetail } from "./queries.ts";
import { startGridRun, type RunEngineDeps } from "./run-engine.ts";
import type { UniverseResolverDeps } from "./universe.ts";
import type { SnapshotClientPool } from "../../snapshot/src/snapshot-sealer.ts";
```

Replace the factory signature:

```ts
export type AnalystGridsServerDeps = {
  db: QueryExecutor;
  pool: SnapshotClientPool;
  universe: UniverseResolverDeps;
  auth?: RequestAuthConfig;
};

export function createAnalystGridsServer(deps: AnalystGridsServerDeps): Server {
  const { db, pool, universe, auth } = deps;
  return createServer(async (req, res) => {
    try {
      const method = req.method ?? "GET";
      const url = new URL(req.url ?? "/", "http://localhost");
      const path = url.pathname;

      const userId = readAuthenticatedUserId(req, auth);
      if (!userId) {
        respond(res, 401, { error: authenticatedUserRequiredMessage(auth) });
        return;
      }

      // ... keep the existing columns / list / create / get-grid routes unchanged,
      // but replace `options.auth` references with `auth` ...

      // POST /v1/analyst-grids/:gridId/runs
      const runStartMatch = path.match(/^\/v1\/analyst-grids\/([^/]+)\/runs$/);
      if (method === "POST" && runStartMatch && UUID_RE.test(runStartMatch[1])) {
        const engineDeps: RunEngineDeps = { db, pool, universe };
        const result = await startGridRun(engineDeps, { gridId: runStartMatch[1], userId, asOf: new Date().toISOString() });
        respond(res, 202, result);
        return;
      }

      // GET /v1/analyst-grids/runs/:runId
      const runGetMatch = path.match(/^\/v1\/analyst-grids\/runs\/([^/]+)$/);
      if (method === "GET" && runGetMatch && UUID_RE.test(runGetMatch[1])) {
        const owned = await loadRunForUser(db, userId, runGetMatch[1]);
        if (!owned) {
          respond(res, 404, { error: "grid run not found" });
          return;
        }
        respond(res, 200, await getRunDetail(db, runGetMatch[1]));
        return;
      }

      respond(res, 404, { error: "not found" });
    } catch (error) {
      // ... unchanged catch block ...
    }
  });
}
```

Important: the existing grid routes use `options.auth`; rename to `auth`. The `GET /v1/analyst-grids/runs/:runId` route MUST be matched **before** the `GET /v1/analyst-grids/:gridId` route, otherwise `runs` would be parsed as a grid id — but since the grid route requires `UUID_RE.test(gridMatch[1])` and `"runs"` fails that test, order is already safe. Keep the run-get route above the single-grid route for clarity regardless.

- [ ] **Step 4: Update `dev.ts` to construct the new deps**

Replace `services/analyst-grids/src/dev.ts` body:

```ts
import { Pool } from "pg";
import { createAnalystGridsServer } from "./http.ts";
import { createUniverseResolverDeps } from "./universe-wiring.ts";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const port = Number(process.env.PORT ?? 8093);
const host = process.env.HOST ?? "127.0.0.1";
const pool = new Pool({ connectionString: databaseUrl });
const server = createAnalystGridsServer({
  db: pool,
  pool,
  universe: createUniverseResolverDeps(pool),
});
server.listen(port, host, () => {
  console.log(`analyst-grids listening on http://${host}:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => {
      pool.end().finally(() => process.exit(0));
    });
  });
}
```

- [ ] **Step 5: Update the existing http test to the new signature**

The Plan-1 `services/analyst-grids/test/http.test.ts` calls `createAnalystGridsServer(db, { auth })`. Update each construction to the new object form:

```ts
const server = createAnalystGridsServer({
  db,
  pool: { connect: async () => { throw new Error("pool unused"); } },
  universe: { resolveScreen: async () => [], resolveWatchlist: async () => [], resolvePortfolio: async () => [], resolvePeers: async () => [] },
  auth: { mode: "dev_user_header" },
});
```

Run: `cd services/analyst-grids && node --experimental-strip-types --test test/http.test.ts`
Expected: PASS (after the construction update).

- [ ] **Step 6: Run the new run-endpoint test to verify it passes**

Run: `cd services/analyst-grids && node --experimental-strip-types --test test/http-runs.test.ts`
Expected: PASS.

- [ ] **Step 7: Run the full analyst-grids Docker-free suite**

Run: `cd services/analyst-grids && node --experimental-strip-types --test test/http.test.ts test/http-runs.test.ts test/run-engine-unit.test.ts test/universe-wiring.test.ts test/universe-wiring-screen.test.ts`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add services/analyst-grids/src/http.ts services/analyst-grids/src/dev.ts services/analyst-grids/test/http.test.ts services/analyst-grids/test/http-runs.test.ts
git commit -m "feat(analyst-grids): run start + run detail HTTP endpoints; widen server deps"
```

---

### Task 6: Web grids client + types

**Files:**
- Create: `web/src/analyst-grids/gridsTypes.ts`
- Create: `web/src/analyst-grids/gridsClient.ts`
- Test: `web/src/analyst-grids/gridsClient.test.ts`

The client mirrors the server payloads and uses the canonical `authenticatedJson` / `HttpJsonError` from `web/src/http/authFetch.ts`.

- [ ] **Step 1: Write the failing client test**

Create `web/src/analyst-grids/gridsClient.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { fetchColumns, createRun, fetchRun } from "./gridsClient.ts";

const USER = "11111111-1111-4111-a111-111111111111";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

test("fetchColumns returns the catalog", async () => {
  const fetchImpl = async () => jsonResponse({ columns: [{ column_key: "latest_market_cap", label: "Market Cap (latest)", kind: "deterministic" }] });
  const columns = await fetchColumns({ userId: USER, fetchImpl });
  assert.equal(columns[0].column_key, "latest_market_cap");
});

test("createRun posts to the grid's runs route and returns the run id", async () => {
  let calledUrl = "";
  const fetchImpl = async (input: RequestInfo | URL) => {
    calledUrl = String(input);
    return jsonResponse({ run_id: "99999999-9999-4999-a999-999999999999", status: "pending" }, 202);
  };
  const result = await createRun({ userId: USER, gridId: "g1", fetchImpl });
  assert.match(calledUrl, /\/v1\/analyst-grids\/g1\/runs$/);
  assert.equal(result.status, "pending");
});

test("fetchRun returns run detail", async () => {
  const fetchImpl = async () => jsonResponse({ run: { grid_run_id: "r1", status: "completed", cell_total: 1, cell_done: 1, dropped_row_count: 0 }, rows: [], cells: [] });
  const detail = await fetchRun({ userId: USER, runId: "r1", fetchImpl });
  assert.equal(detail.run.status, "completed");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && node --experimental-strip-types --test src/analyst-grids/gridsClient.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the types and client**

Create `web/src/analyst-grids/gridsTypes.ts`:

```ts
export type CellTone = "best" | "worst" | null;
export type CellDisplay = { value: string; tone: CellTone };
export type CellRef = { kind: "fact" | "claim"; id: string };

export type GridColumn = { column_key: string; label: string; kind: "deterministic" | "reader" };

export type GridRunStatus = "pending" | "running" | "partial" | "completed" | "failed";

export type GridRunSummary = {
  grid_run_id: string;
  status: GridRunStatus;
  cell_total: number;
  cell_done: number;
  dropped_row_count: number;
};

export type GridRowDetail = {
  grid_row_id: string;
  row_number: number;
  subject_ref: { kind: string; id: string };
  status: "pending" | "resolved" | "failed";
};

export type GridCellDetail = {
  grid_row_id: string;
  column_key: string;
  status: "pending" | "ok" | "missing_data" | "no_coverage" | "error";
  display: CellDisplay | null;
  snapshot_id: string | null;
  primary_ref: CellRef | null;
  coverage_flag: string | null;
};

export type GridRunDetail = { run: GridRunSummary; rows: GridRowDetail[]; cells: GridCellDetail[] };
```

Create `web/src/analyst-grids/gridsClient.ts`:

```ts
import { authenticatedJson, type FetchImpl } from "../http/authFetch.ts";
import type { GridColumn, GridRunDetail } from "./gridsTypes.ts";

export async function fetchColumns(args: { userId: string; fetchImpl?: FetchImpl }): Promise<GridColumn[]> {
  const body = await authenticatedJson<{ columns: GridColumn[] }>("/v1/analyst-grids/columns", {
    userId: args.userId,
    fetchImpl: args.fetchImpl,
  });
  return body.columns;
}

export async function createRun(args: { userId: string; gridId: string; fetchImpl?: FetchImpl }): Promise<{ run_id: string; status: "pending" }> {
  return authenticatedJson(`/v1/analyst-grids/${args.gridId}/runs`, {
    method: "POST",
    userId: args.userId,
    headers: { "content-type": "application/json" },
    body: "{}",
    fetchImpl: args.fetchImpl,
  });
}

export async function fetchRun(args: { userId: string; runId: string; fetchImpl?: FetchImpl }): Promise<GridRunDetail> {
  return authenticatedJson<GridRunDetail>(`/v1/analyst-grids/runs/${args.runId}`, {
    userId: args.userId,
    fetchImpl: args.fetchImpl,
  });
}

export type CreateGridBody = {
  name: string;
  universe_spec: unknown;
  column_specs: Array<{ column_key: string }>;
};

export async function createGrid(args: { userId: string; body: CreateGridBody; fetchImpl?: FetchImpl }): Promise<{ grid_id: string }> {
  return authenticatedJson<{ grid_id: string }>("/v1/analyst-grids", {
    method: "POST",
    userId: args.userId,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(args.body),
    fetchImpl: args.fetchImpl,
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && node --experimental-strip-types --test src/analyst-grids/gridsClient.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/analyst-grids/gridsTypes.ts web/src/analyst-grids/gridsClient.ts web/src/analyst-grids/gridsClient.test.ts
git commit -m "feat(web): analyst-grids client + wire types"
```

---

### Task 7: `useGridRun` polling hook

**Files:**
- Create: `web/src/analyst-grids/useGridRun.ts`
- Test: `web/src/analyst-grids/useGridRun.test.ts`

The hook polls `fetchRun` on an interval until the run reaches a terminal status (`completed`/`partial`/`failed`), exposing `{ status, detail, error }`. Polling stops on terminal status and on unmount.

- [ ] **Step 1: Write the failing hook test (JSDOM)**

Create `web/src/analyst-grids/useGridRun.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { useGridRun } from "./useGridRun.ts";
import type { GridRunDetail } from "./gridsTypes.ts";

function installDomGlobals(domWindow: Window): () => void {
  const g = globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean; document?: Document; window?: Window };
  const prev = { act: g.IS_REACT_ACT_ENVIRONMENT, doc: g.document, win: g.window };
  g.IS_REACT_ACT_ENVIRONMENT = true;
  g.document = domWindow.document;
  g.window = domWindow;
  return () => { g.IS_REACT_ACT_ENVIRONMENT = prev.act; g.document = prev.doc; g.window = prev.win; };
}

test("useGridRun polls until terminal status then stops", async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
  const restore = installDomGlobals(dom.window as unknown as Window);
  let calls = 0;
  const responses: GridRunDetail[] = [
    { run: { grid_run_id: "r1", status: "running", cell_total: 1, cell_done: 0, dropped_row_count: 0 }, rows: [], cells: [] },
    { run: { grid_run_id: "r1", status: "completed", cell_total: 1, cell_done: 1, dropped_row_count: 0 }, rows: [], cells: [] },
  ];
  const fetchRunImpl = async () => responses[Math.min(calls++, responses.length - 1)];

  const seen: string[] = [];
  function Probe() {
    const { detail } = useGridRun({ userId: "u", runId: "r1", intervalMs: 5, fetchRunImpl });
    if (detail) seen.push(detail.run.status);
    return null;
  }

  const root = createRoot(dom.window.document.getElementById("root")!);
  await act(async () => { root.render(<Probe />); });
  await act(async () => { await new Promise((r) => setTimeout(r, 40)); });
  await act(async () => root.unmount());
  restore();

  assert.ok(seen.includes("completed"), `expected a completed poll, saw ${seen.join(",")}`);
  const callsAtStop = calls;
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(calls, callsAtStop, "polling should stop after terminal status");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && node --experimental-strip-types --test src/analyst-grids/useGridRun.test.ts`
Expected: FAIL — `useGridRun` not found.

- [ ] **Step 3: Implement the hook**

Create `web/src/analyst-grids/useGridRun.ts`:

```ts
import { useEffect, useState } from "react";
import { fetchRun } from "./gridsClient.ts";
import type { GridRunDetail, GridRunStatus } from "./gridsTypes.ts";

const TERMINAL: ReadonlySet<GridRunStatus> = new Set(["completed", "partial", "failed"]);

export type UseGridRunResult = {
  status: GridRunStatus | null;
  detail: GridRunDetail | null;
  error: string | null;
};

export function useGridRun(args: {
  userId: string;
  runId: string | null;
  intervalMs?: number;
  fetchRunImpl?: (a: { userId: string; runId: string }) => Promise<GridRunDetail>;
}): UseGridRunResult {
  const { userId, runId, intervalMs = 1500 } = args;
  const [detail, setDetail] = useState<GridRunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const doFetch = args.fetchRunImpl ?? ((a) => fetchRun({ userId: a.userId, runId: a.runId }));

    async function tick() {
      try {
        const next = await doFetch({ userId, runId: runId as string });
        if (cancelled) return;
        setDetail(next);
        if (!TERMINAL.has(next.run.status)) {
          timer = setTimeout(tick, intervalMs);
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "run fetch failed");
        timer = setTimeout(tick, intervalMs);
      }
    }
    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [userId, runId, intervalMs]);

  return { status: detail?.run.status ?? null, detail, error };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && node --experimental-strip-types --test src/analyst-grids/useGridRun.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/analyst-grids/useGridRun.ts web/src/analyst-grids/useGridRun.test.ts
git commit -m "feat(web): useGridRun polling hook (stops on terminal status)"
```

---

### Task 8: `GridTable` renderer + evidence inspector hookup

**Files:**
- Create: `web/src/analyst-grids/GridTable.tsx`
- Test: `web/src/analyst-grids/GridTable.test.tsx`

`GridTable` renders rows × columns from a `GridRunDetail` plus the ordered column list. Each cell shows its state: `pending` → "…", `ok` → `display.value` with tone class, `missing_data`/`no_coverage` → flagged "—", `error` → "error". A cell with a `snapshot_id` + `primary_ref` is clickable and calls `useEvidenceInspector().openInspection({ snapshotId, ref })`.

- [ ] **Step 1: Write the failing render test**

Create `web/src/analyst-grids/GridTable.test.tsx`:

```tsx
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { GridTable } from "./GridTable.tsx";
import type { GridColumn, GridRunDetail } from "./gridsTypes.ts";

const COLUMNS: GridColumn[] = [{ column_key: "latest_market_cap", label: "Market Cap (latest)", kind: "deterministic" }];

const DETAIL: GridRunDetail = {
  run: { grid_run_id: "r1", status: "completed", cell_total: 2, cell_done: 2, dropped_row_count: 0 },
  rows: [
    { grid_row_id: "row-a", row_number: 0, subject_ref: { kind: "issuer", id: "AAA" }, status: "resolved" },
    { grid_row_id: "row-b", row_number: 1, subject_ref: { kind: "issuer", id: "BBB" }, status: "resolved" },
  ],
  cells: [
    { grid_row_id: "row-a", column_key: "latest_market_cap", status: "ok", display: { value: "$2.5T", tone: null }, snapshot_id: "snap-1", primary_ref: { kind: "fact", id: "fact-1" }, coverage_flag: null },
    { grid_row_id: "row-b", column_key: "latest_market_cap", status: "missing_data", display: { value: "—", tone: null }, snapshot_id: null, primary_ref: null, coverage_flag: null },
  ],
};

test("GridTable renders one row per subject and the cell value", () => {
  const html = renderToStaticMarkup(<GridTable columns={COLUMNS} detail={DETAIL} />);
  assert.match(html, /Market Cap \(latest\)/);
  assert.match(html, /\$2\.5T/);
  assert.match(html, /AAA/);
  assert.match(html, /BBB/);
});

test("GridTable marks an ok cell with a snapshot as inspectable and a missing cell as not", () => {
  const html = renderToStaticMarkup(<GridTable columns={COLUMNS} detail={DETAIL} />);
  // The ok cell carries the inspectable affordance; the missing cell does not.
  assert.match(html, /data-cell-inspectable="true"[^>]*data-snapshot-id="snap-1"/);
  assert.match(html, /data-cell-status="missing_data"/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && node --experimental-strip-types --test src/analyst-grids/GridTable.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `GridTable`**

Create `web/src/analyst-grids/GridTable.tsx`:

```tsx
import type { ReactElement } from "react";
import { useEvidenceInspector } from "../evidence/useEvidenceInspector.ts";
import type { GridColumn, GridCellDetail, GridRunDetail } from "./gridsTypes.ts";

function cellKey(rowId: string, columnKey: string): string {
  return `${rowId}::${columnKey}`;
}

function cellText(cell: GridCellDetail | undefined): string {
  if (!cell || cell.status === "pending") return "…";
  if (cell.status === "error") return "error";
  return cell.display?.value ?? "—";
}

function toneClass(cell: GridCellDetail | undefined): string {
  if (cell?.display?.tone === "best") return " text-pos";
  if (cell?.display?.tone === "worst") return " text-neg";
  return "";
}

type GridTableProps = { columns: ReadonlyArray<GridColumn>; detail: GridRunDetail };

export function GridTable({ columns, detail }: GridTableProps): ReactElement {
  const inspector = useEvidenceInspector();
  const byKey = new Map<string, GridCellDetail>();
  for (const c of detail.cells) byKey.set(cellKey(c.grid_row_id, c.column_key), c);

  return (
    <div data-testid="analyst-grid-table" className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full border-collapse text-left text-sm">
        <thead className="bg-surface-2">
          <tr>
            <th scope="col" className="border-b border-line px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted">Subject</th>
            {columns.map((col) => (
              <th key={col.column_key} scope="col" className="border-b border-line px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted">
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {detail.rows.map((row) => (
            <tr key={row.grid_row_id} className="border-t border-line">
              <td className="px-3 py-2 text-fg">{row.subject_ref.id}</td>
              {columns.map((col) => {
                const cell = byKey.get(cellKey(row.grid_row_id, col.column_key));
                const inspectable = Boolean(cell && cell.snapshot_id && cell.primary_ref);
                return (
                  <td
                    key={col.column_key}
                    className={`num px-3 py-2 text-fg${toneClass(cell)}${inspectable ? " cursor-pointer underline decoration-dotted" : ""}`}
                    data-cell-status={cell?.status ?? "pending"}
                    data-cell-inspectable={inspectable ? "true" : "false"}
                    data-snapshot-id={cell?.snapshot_id ?? undefined}
                    onClick={
                      inspectable && cell?.snapshot_id && cell.primary_ref
                        ? () => inspector?.openInspection({ snapshotId: cell.snapshot_id as string, ref: cell.primary_ref as { kind: "fact" | "claim"; id: string } })
                        : undefined
                    }
                  >
                    {cellText(cell)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

(`text-pos`/`text-neg` are the repo's positive/negative tone classes — confirm the exact class names against an existing toned component such as `web/src/home/` movers or `web/src/blocks/`; substitute the real ones if they differ.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && node --experimental-strip-types --test src/analyst-grids/GridTable.test.tsx`
Expected: PASS.

- [ ] **Step 5: Write an interaction test (JSDOM — click opens inspector)**

Append to `web/src/analyst-grids/GridTable.test.tsx` a JSDOM test that renders inside `AuthContext` + `EvidenceInspectorProvider`, clicks the ok cell, and asserts a POST to `/v1/evidence/inspect` was attempted (mock `fetch` on the dom window). Follow the pattern in `web/src/blocks/blockView.test.tsx` (it renders `EvidenceInspectorProvider` and exercises `openInspection`). Mock `window.fetch` to capture the inspect call:

```tsx
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { AuthContext } from "../shell/authTypes.ts";
import { EvidenceInspectorProvider } from "../evidence/EvidenceInspectorProvider.tsx";

test("clicking an inspectable cell triggers an evidence inspection fetch", async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
  const restore = installDomGlobals(dom.window as unknown as Window);
  const calls: string[] = [];
  (dom.window as unknown as { fetch: typeof fetch }).fetch = async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return new Response(JSON.stringify({ snapshot: {}, primary: {}, related: [] }), { status: 200, headers: { "content-type": "application/json" } });
  };
  (globalThis as unknown as { fetch: typeof fetch }).fetch = (dom.window as unknown as { fetch: typeof fetch }).fetch;
  try {
    const root = createRoot(dom.window.document.getElementById("root")!);
    await act(async () => {
      root.render(
        <AuthContext.Provider value={{ session: { userId: "11111111-1111-4111-a111-111111111111", displayName: "U" }, signIn: () => undefined, signOut: () => undefined }}>
          <EvidenceInspectorProvider>
            <GridTable columns={COLUMNS} detail={DETAIL} />
          </EvidenceInspectorProvider>
        </AuthContext.Provider>,
      );
    });
    const okCell = dom.window.document.querySelector('[data-snapshot-id="snap-1"]') as HTMLElement;
    await act(async () => { okCell.click(); });
    assert.ok(calls.some((u) => u.includes("/v1/evidence/inspect")), `expected an inspect call, saw ${calls.join(",")}`);
    await act(async () => root.unmount());
  } finally {
    restore();
  }
});

// reuse the installDomGlobals helper from useGridRun.test.ts (copy it in, or
// extract to web/src/analyst-grids/testDom.ts and import in both tests).
```

(Extract `installDomGlobals` to `web/src/analyst-grids/testDom.ts` and import it in both `useGridRun.test.ts` and `GridTable.test.tsx` to avoid duplication — DRY.)

- [ ] **Step 6: Run the interaction test to verify it passes**

Run: `cd web && node --experimental-strip-types --test src/analyst-grids/GridTable.test.tsx`
Expected: PASS (both render and interaction tests).

- [ ] **Step 7: Commit**

```bash
git add web/src/analyst-grids/GridTable.tsx web/src/analyst-grids/GridTable.test.tsx web/src/analyst-grids/testDom.ts web/src/analyst-grids/useGridRun.test.ts
git commit -m "feat(web): GridTable renderer + evidence inspector cell hookup"
```

---

### Task 9: `GridBuilder` (minimal universe + column composer)

**Files:**
- Create: `web/src/analyst-grids/GridBuilder.tsx`
- Test: `web/src/analyst-grids/GridBuilder.test.tsx`

A minimal builder: a universe-source selector (`manual` ticker textarea, or one of `screen`/`watchlist`/`portfolio`/`peers` with an id field), a checkbox list of catalog columns, and a "Create & Run" button that calls back with the assembled `{ universe_spec, column_specs }`. It does not own networking — the page (Task 10) wires `createGrid` + `createRun`. This keeps the builder a pure, testable form.

- [ ] **Step 1: Write the failing render test**

Create `web/src/analyst-grids/GridBuilder.test.tsx`:

```tsx
import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { installDomGlobals } from "./testDom.ts";
import { GridBuilder } from "./GridBuilder.tsx";
import type { GridColumn } from "./gridsTypes.ts";

const COLUMNS: GridColumn[] = [{ column_key: "latest_market_cap", label: "Market Cap (latest)", kind: "deterministic" }];

test("GridBuilder assembles a manual universe + selected columns and emits them", async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
  const restore = installDomGlobals(dom.window as unknown as Window);
  let emitted: unknown = null;
  try {
    const root = createRoot(dom.window.document.getElementById("root")!);
    await act(async () => {
      root.render(<GridBuilder columns={COLUMNS} onSubmit={(spec) => { emitted = spec; }} />);
    });
    const doc = dom.window.document;
    (doc.querySelector('[data-testid="grid-builder-manual-input"]') as HTMLTextAreaElement).value = "AAA, BBB";
    (doc.querySelector('[data-testid="grid-builder-manual-input"]') as HTMLTextAreaElement).dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    (doc.querySelector('[data-testid="grid-builder-col-latest_market_cap"]') as HTMLInputElement).click();
    await act(async () => { (doc.querySelector('[data-testid="grid-builder-submit"]') as HTMLButtonElement).click(); });
    await act(async () => root.unmount());
  } finally {
    restore();
  }
  assert.deepEqual(emitted, {
    universe_spec: { source: "manual", subject_refs: [{ kind: "issuer", id: "AAA" }, { kind: "issuer", id: "BBB" }] },
    column_specs: [{ column_key: "latest_market_cap" }],
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && node --experimental-strip-types --test src/analyst-grids/GridBuilder.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `GridBuilder`**

Create `web/src/analyst-grids/GridBuilder.tsx`:

```tsx
import { useState, type ReactElement } from "react";
import type { GridColumn } from "./gridsTypes.ts";

export type GridBuilderSubmit = { universe_spec: unknown; column_specs: Array<{ column_key: string }> };

const ID_SOURCES = ["screen", "watchlist", "portfolio", "peers"] as const;
type IdSource = (typeof ID_SOURCES)[number];

function manualSpec(raw: string): { source: "manual"; subject_refs: Array<{ kind: "issuer"; id: string }> } {
  const ids = raw.split(/[,\n]/).map((s) => s.trim()).filter((s) => s.length > 0);
  return { source: "manual", subject_refs: ids.map((id) => ({ kind: "issuer", id })) };
}

function idSpec(source: IdSource, id: string): unknown {
  switch (source) {
    case "screen": return { source, screen_id: id };
    case "watchlist": return { source, watchlist_id: id };
    case "portfolio": return { source, portfolio_id: id };
    case "peers": return { source, issuer_id: id };
  }
}

type GridBuilderProps = { columns: ReadonlyArray<GridColumn>; onSubmit: (spec: GridBuilderSubmit) => void };

export function GridBuilder({ columns, onSubmit }: GridBuilderProps): ReactElement {
  const [source, setSource] = useState<"manual" | IdSource>("manual");
  const [manual, setManual] = useState("");
  const [refId, setRefId] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function submit() {
    const universe_spec = source === "manual" ? manualSpec(manual) : idSpec(source, refId.trim());
    const column_specs = columns.filter((c) => selected.has(c.column_key)).map((c) => ({ column_key: c.column_key }));
    onSubmit({ universe_spec, column_specs });
  }

  return (
    <div data-testid="grid-builder" className="space-y-3">
      <label className="block text-sm">
        Universe source
        <select className="ml-2 rounded border border-line bg-surface-2 px-2 py-1" value={source} onChange={(e) => setSource(e.target.value as "manual" | IdSource)} data-testid="grid-builder-source">
          <option value="manual">Manual tickers</option>
          {ID_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>

      {source === "manual" ? (
        <textarea data-testid="grid-builder-manual-input" className="w-full rounded border border-line bg-surface-2 px-2 py-1" placeholder="comma- or newline-separated issuer ids" value={manual} onChange={(e) => setManual(e.target.value)} />
      ) : (
        <input data-testid="grid-builder-ref-input" className="w-full rounded border border-line bg-surface-2 px-2 py-1" placeholder={`${source} id`} value={refId} onChange={(e) => setRefId(e.target.value)} />
      )}

      <fieldset className="space-y-1">
        <legend className="text-xs uppercase tracking-wide text-muted">Columns</legend>
        {columns.map((col) => (
          <label key={col.column_key} className="flex items-center gap-2 text-sm">
            <input type="checkbox" data-testid={`grid-builder-col-${col.column_key}`} checked={selected.has(col.column_key)} onChange={() => toggle(col.column_key)} />
            {col.label}
          </label>
        ))}
      </fieldset>

      <button data-testid="grid-builder-submit" className="rounded bg-accent px-3 py-1 text-sm text-on-accent" onClick={submit}>Create &amp; Run</button>
    </div>
  );
}
```

(`bg-accent`/`text-on-accent` are illustrative — substitute the repo's actual primary-button classes from an existing button such as in `web/src/screener/` or `web/src/shell/`.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && node --experimental-strip-types --test src/analyst-grids/GridBuilder.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/analyst-grids/GridBuilder.tsx web/src/analyst-grids/GridBuilder.test.tsx
git commit -m "feat(web): minimal GridBuilder (universe source + column composer)"
```

---

### Task 10: `GridsPage` + route + nav

**Files:**
- Create: `web/src/analyst-grids/GridsPage.tsx`
- Modify: `web/src/App.tsx` (route)
- Modify: the nav entry list (locate via the existing nav config — likely `web/src/shell/` near `WorkspaceShell`)
- Test: `web/src/analyst-grids/GridsPage.test.tsx`

`GridsPage` wires the pieces: fetch the column catalog, render `GridBuilder`, on submit `createGrid` then `createRun`, then drive `useGridRun` and render `GridTable`.

- [ ] **Step 1: Write the failing page test (JSDOM, mocked fetch)**

Create `web/src/analyst-grids/GridsPage.test.tsx`. Mock `fetch` to answer the columns, create-grid, create-run, and run-detail endpoints, then assert the table renders the seeded value after a run.

```tsx
import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { installDomGlobals } from "./testDom.ts";
import { AuthContext } from "../shell/authTypes.ts";
import { EvidenceInspectorProvider } from "../evidence/EvidenceInspectorProvider.tsx";
import { GridsPage } from "./GridsPage.tsx";

function route(url: string): Response {
  if (url.includes("/v1/analyst-grids/columns")) return new Response(JSON.stringify({ columns: [{ column_key: "latest_market_cap", label: "Market Cap (latest)", kind: "deterministic" }] }), { status: 200, headers: { "content-type": "application/json" } });
  if (url.endsWith("/v1/analyst-grids")) return new Response(JSON.stringify({ grid_id: "g1" }), { status: 201, headers: { "content-type": "application/json" } });
  if (url.endsWith("/g1/runs")) return new Response(JSON.stringify({ run_id: "r1", status: "pending" }), { status: 202, headers: { "content-type": "application/json" } });
  if (url.includes("/v1/analyst-grids/runs/r1")) return new Response(JSON.stringify({ run: { grid_run_id: "r1", status: "completed", cell_total: 1, cell_done: 1, dropped_row_count: 0 }, rows: [{ grid_row_id: "row-a", row_number: 0, subject_ref: { kind: "issuer", id: "AAA" }, status: "resolved" }], cells: [{ grid_row_id: "row-a", column_key: "latest_market_cap", status: "ok", display: { value: "$2.5T", tone: null }, snapshot_id: "snap-1", primary_ref: { kind: "fact", id: "f1" }, coverage_flag: null }] }), { status: 200, headers: { "content-type": "application/json" } });
  return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
}

test("GridsPage builds a grid, runs it, and renders the resulting cell value", async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
  const restore = installDomGlobals(dom.window as unknown as Window);
  (globalThis as unknown as { fetch: typeof fetch }).fetch = async (input: RequestInfo | URL) => route(String(input));
  try {
    const root = createRoot(dom.window.document.getElementById("root")!);
    await act(async () => {
      root.render(
        <AuthContext.Provider value={{ session: { userId: "11111111-1111-4111-a111-111111111111", displayName: "U" }, signIn: () => undefined, signOut: () => undefined }}>
          <EvidenceInspectorProvider>
            <GridsPage />
          </EvidenceInspectorProvider>
        </AuthContext.Provider>,
      );
    });
    // let the columns load
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    const doc = dom.window.document;
    (doc.querySelector('[data-testid="grid-builder-manual-input"]') as HTMLTextAreaElement).value = "AAA";
    (doc.querySelector('[data-testid="grid-builder-manual-input"]') as HTMLTextAreaElement).dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    (doc.querySelector('[data-testid="grid-builder-col-latest_market_cap"]') as HTMLInputElement).click();
    await act(async () => { (doc.querySelector('[data-testid="grid-builder-submit"]') as HTMLButtonElement).click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 60)); });
    assert.match(doc.getElementById("root")!.innerHTML, /\$2\.5T/);
    await act(async () => root.unmount());
  } finally {
    restore();
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && node --experimental-strip-types --test src/analyst-grids/GridsPage.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `GridsPage`**

Create `web/src/analyst-grids/GridsPage.tsx`:

```tsx
import { useEffect, useState, type ReactElement } from "react";
import { useAuth } from "../shell/useAuth.ts";
import { fetchColumns, createGrid, createRun } from "./gridsClient.ts";
import { useGridRun } from "./useGridRun.ts";
import { GridBuilder, type GridBuilderSubmit } from "./GridBuilder.tsx";
import { GridTable } from "./GridTable.tsx";
import type { GridColumn } from "./gridsTypes.ts";

export function GridsPage(): ReactElement {
  const { session } = useAuth();
  const userId = session?.userId ?? null;
  const [columns, setColumns] = useState<GridColumn[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [activeColumns, setActiveColumns] = useState<GridColumn[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    fetchColumns({ userId }).then(setColumns).catch((e) => setError(e instanceof Error ? e.message : "failed to load columns"));
  }, [userId]);

  const { detail } = useGridRun({ userId: userId ?? "", runId });

  async function onSubmit(spec: GridBuilderSubmit) {
    if (!userId) return;
    setError(null);
    try {
      const grid = await createGrid({ userId, body: { name: "Untitled grid", universe_spec: spec.universe_spec, column_specs: spec.column_specs } });
      const run = await createRun({ userId, gridId: grid.grid_id });
      setActiveColumns(columns.filter((c) => spec.column_specs.some((s) => s.column_key === c.column_key)));
      setRunId(run.run_id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to start run");
    }
  }

  if (!userId) return <div className="p-4 text-sm text-muted">Sign in to build research grids.</div>;

  return (
    <div className="space-y-4 p-4">
      <h1 className="text-lg font-semibold">Analyst Grid</h1>
      <GridBuilder columns={columns} onSubmit={onSubmit} />
      {error ? <div className="text-sm text-neg">{error}</div> : null}
      {detail ? (
        <div className="space-y-2">
          <div className="text-xs text-muted">
            {detail.run.status} · {detail.run.cell_done}/{detail.run.cell_total} cells
            {detail.run.dropped_row_count > 0 ? ` · ${detail.run.dropped_row_count} rows dropped (cap 25)` : ""}
          </div>
          <GridTable columns={activeColumns} detail={detail} />
        </div>
      ) : runId ? (
        <div className="text-sm text-muted">Running…</div>
      ) : null}
    </div>
  );
}
```

(Confirm `useAuth` import path — the explorer found `AuthContext` in `web/src/shell/authTypes.ts`; locate the matching `useAuth` hook, e.g. `web/src/shell/useAuth.ts`, and import from there. `text-neg`/`text-muted` are repo tone classes — verify.)

- [ ] **Step 4: Run the page test to verify it passes**

Run: `cd web && node --experimental-strip-types --test src/analyst-grids/GridsPage.test.tsx`
Expected: PASS.

- [ ] **Step 5: Register the route**

In `web/src/App.tsx`, add inside the `<Route element={<WorkspaceShell />}>` block, following the existing `publicHandle`/`protected` pattern:

```tsx
import { GridsPage } from "./analyst-grids/GridsPage.tsx";
// ...
<Route path="analyst-grids" handle={publicHandle} element={<GridsPage />} />
```

Use the same `handle` style as a comparable feature (e.g. `analyze`/`screener` use `publicHandle`). If those pages are gated, mirror their handle.

- [ ] **Step 6: Add the nav entry**

Locate the nav list rendered by `WorkspaceShell` (search `web/src/shell/` for the array of `{ to, label }` nav items used to render the sidebar/top nav). Add an entry pointing at `/analyst-grids` with label `Analyst Grid`, matching the shape of the existing entries (e.g. the `Screener` or `Analyze` entry). Show the existing entry you copied and the new one you added.

- [ ] **Step 7: Verify the full web analyst-grids suite passes**

Run: `cd web && node --experimental-strip-types --test src/analyst-grids/*.test.ts src/analyst-grids/*.test.tsx`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add web/src/analyst-grids/GridsPage.tsx web/src/analyst-grids/GridsPage.test.tsx web/src/App.tsx web/src/shell
git commit -m "feat(web): Analyst Grid page, route, and nav entry"
```

---

## Final Verification (after all tasks)

- [ ] **Run the complete analyst-grids backend Docker-free suite**

Run:
```bash
cd services/analyst-grids && node --experimental-strip-types --test \
  test/queries.test.ts test/universe.test.ts test/http.test.ts test/http-runs.test.ts \
  test/universe-wiring.test.ts test/universe-wiring-screen.test.ts test/run-engine-unit.test.ts \
  test/cell-runner-error.test.ts test/column-catalog-unit.test.ts
```
Expected: all PASS, 0 fail.

- [ ] **Run the complete web analyst-grids suite**

Run: `cd web && node --experimental-strip-types --test src/analyst-grids/*.test.ts src/analyst-grids/*.test.tsx`
Expected: all PASS.

- [ ] **Note docker-pg suites for CI**

The docker-pg suites (`run-progress-queries.test.ts`, `period-context.test.ts`, `run-engine.test.ts`) run in CI's `analyst-grids (integration tests)` job. If the local Docker daemon is unavailable, confirm each module strip-loads (`node --experimental-strip-types --check <file>`) and flag that the docker tests were validated in CI rather than locally.

---

## Self-Review notes (filled during planning)

**Spec coverage** (against `docs/superpowers/specs/2026-06-09-analyst-grid-design.md`, build-order slices 3–4 + run-state UX):
- Async run engine / 25-row cap / dropped-row logging → Task 4 (`startGridRun`, `capUniverse`, `console.log`).
- Per-cell sealing reuse → Task 4 reuses Plan-1 `computeAndPersistCell` (no reimplementation).
- Run status + polling endpoints → Task 5 (`POST …/runs`, `GET …/runs/:id`); web polling → Task 7.
- `PeriodContext` per-row resolved → Task 2; worker persists it per row → Task 4 (`markRowResolved`).
- `GridTable` cell states + evidence drawer → Task 8; builder → Task 9; route/nav → Task 10.
- Fifth universe source (screen) wiring → Task 3.

**Known deferrals (explicit, not gaps):** `PeriodContext.document_refs` stays `[]` (no document→issuer linkage exists; Plan 3 must solve it before the reader column). Remaining deterministic columns + the reader column are Plan 3. Stalled-run sweep, caching, saved templates remain non-goals.

**Type consistency:** `PeriodContext`/`ResolvedPeriod` defined in `column-catalog.ts` (Task 2) and consumed by `period-context.ts`, `cell-runner.ts`, `run-engine.ts`. `RunStatus`/`RowStatus` defined in `queries.ts` (Task 1) and reused by `run-engine.ts`. Wire types in `gridsTypes.ts` mirror server JSON. `createAnalystGridsServer` takes a single `AnalystGridsServerDeps` object across Tasks 5/10 and both existing + new tests.
