# Analyst Grid — Foundations (Plan 1 of 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the data model, grid CRUD service, universe resolution, the column-catalog/producer framework, and prove one deterministic column end-to-end — computed, sealed into its own snapshot, and openable in the existing evidence inspector.

**Architecture:** A new `services/analyst-grids/` service following the `services/watchlists` anatomy (raw-SQL `queries.ts`, an HTTP factory `http.ts`, a `dev.ts` Pool entrypoint). It orchestrates existing services: universes resolve to `SubjectRef[]`; deterministic columns reuse analyze's `buildFactBackedSealInput`; cells seal via `sealSnapshotWithPool`; the evidence inspector gains one new visibility path. This plan stops at a synchronously-computable cell (proving producer → seal → persist → inspect). The async run engine and web UI are Plan 2.

**Tech Stack:** Node ≥22 with `--experimental-strip-types`, `pg` (raw SQL, no ORM), `node:test` + `node:assert/strict`, docker-pg test harness (`db/test/docker-pg.ts`), numbered SQL migrations under `db/migrations/`.

**Spec:** `docs/superpowers/specs/2026-06-09-analyst-grid-design.md`

**Scope of Plan 1 (this document):**
- Migration: `research_grids`, `grid_runs`, `grid_rows`, `grid_cells`.
- `queries.ts`: grid CRUD + run/row/cell row helpers (insert + update).
- `universe.ts`: dispatcher resolving a `universe_spec` to `SubjectRef[]` (manual inline; screen/watchlist/portfolio/peers via injected source functions).
- `column-catalog.ts`: `GridColumnProducer` type + a registry + **one** deterministic producer (`latest_market_cap`).
- `cell-runner.ts`: compute one cell → build seal input → `sealSnapshotWithPool` → persist cell. (Synchronous; no background worker yet.)
- `http.ts`: `createAnalystGridsServer` with grid CRUD routes + `GET /v1/analyst-grids/columns`.
- `services/evidence/src/inspector.ts`: add the grid-cell visibility path.
- `dev.ts` + `package.json` + dev-api wiring note.

**Out of scope (Plan 2 / Plan 3):** async run endpoints + worker + progress polling, `PeriodContext` resolver, the web UI, additional deterministic columns, LLM reader columns, caching.

**Conventions to follow (verified in-repo):**
- `QueryExecutor` is the local minimal type (`services/watchlists/src/queries.ts:7`): `{ query<R>(text, values?): Promise<QueryResult<R>> }`. Re-declare it in the new service's `queries.ts` exactly as watchlists does (each service owns its copy).
- `SubjectRef` / `SubjectKind` come from `services/shared/src/subject-ref.ts` (`{ kind, id }`, `isSubjectRef`, `isUuid`).
- Auth via `readAuthenticatedUserId(req, options.auth)` from `services/shared/src/request-auth.ts`.
- Run tests for a service with: `cd services/analyst-grids && node --experimental-strip-types --test "test/**/*.test.ts"`.
- DB-backed tests use `bootstrapDatabase(t, "<beads-id>")` + `connectedClient(t, url)` from `db/test/docker-pg.ts`.

---

## File Structure

**Create:**
- `db/migrations/0030_analyst_grids.up.sql` — four tables + indexes.
- `db/migrations/0030_analyst_grids.down.sql` — drop in reverse.
- `services/analyst-grids/package.json` — service manifest (mirror `services/watchlists/package.json`).
- `services/analyst-grids/src/types.ts` — `QueryExecutor`, shared row/spec types, error classes.
- `services/analyst-grids/src/queries.ts` — grid CRUD + run/row/cell helpers.
- `services/analyst-grids/src/universe.ts` — `resolveUniverse` dispatcher + `UniverseResolverDeps`.
- `services/analyst-grids/src/column-catalog.ts` — `GridColumnProducer`, catalog registry, `latest_market_cap` producer.
- `services/analyst-grids/src/cell-runner.ts` — `computeAndPersistCell`.
- `services/analyst-grids/src/http.ts` — `createAnalystGridsServer`.
- `services/analyst-grids/src/dev.ts` — Pool entrypoint.
- `services/analyst-grids/src/index.ts` — public re-exports.
- `services/analyst-grids/test/queries.test.ts` — fakeDb CRUD tests.
- `services/analyst-grids/test/universe.test.ts` — dispatcher tests.
- `services/analyst-grids/test/column-catalog.test.ts` — producer tests (docker-pg).
- `services/analyst-grids/test/cell-runner.test.ts` — seal+persist (docker-pg).
- `services/analyst-grids/test/http.test.ts` — CRUD + catalog endpoint.
- `services/analyst-grids/test/inspector-grid-access.test.ts` — new inspector path (docker-pg).

**Modify:**
- `services/evidence/src/inspector.ts:114-145` — extend `assertSnapshotVisibleToUser`.

---

## Task 1: Migration — four tables

**Files:**
- Create: `db/migrations/0030_analyst_grids.up.sql`
- Create: `db/migrations/0030_analyst_grids.down.sql`

- [ ] **Step 1: Write the up migration**

Create `db/migrations/0030_analyst_grids.up.sql`:

```sql
create table research_grids (
  grid_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(user_id) on delete cascade,
  name text not null,
  description text,
  universe_spec jsonb not null,
  column_specs jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (created_at <= updated_at)
);

create table grid_runs (
  grid_run_id uuid primary key default gen_random_uuid(),
  grid_id uuid not null references research_grids(grid_id) on delete cascade,
  user_id uuid not null references users(user_id) on delete cascade,
  status text not null check (status in ('pending','running','partial','completed','failed')),
  as_of timestamptz not null,
  cell_total integer not null default 0,
  cell_done integer not null default 0,
  dropped_row_count integer not null default 0,
  error_message text,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create table grid_rows (
  grid_row_id uuid primary key default gen_random_uuid(),
  grid_run_id uuid not null references grid_runs(grid_run_id) on delete cascade,
  row_number integer not null,
  subject_ref jsonb not null,
  period_context jsonb,
  status text not null check (status in ('pending','resolved','failed')),
  created_at timestamptz not null default now(),
  unique (grid_run_id, row_number)
);

create table grid_cells (
  grid_cell_id uuid primary key default gen_random_uuid(),
  grid_row_id uuid not null references grid_rows(grid_row_id) on delete cascade,
  grid_run_id uuid not null references grid_runs(grid_run_id) on delete cascade,
  column_key text not null,
  status text not null check (status in ('pending','ok','missing_data','no_coverage','error')),
  display jsonb,
  snapshot_id uuid references snapshots(snapshot_id),
  primary_ref jsonb,
  coverage_flag text,
  computed_at timestamptz,
  unique (grid_row_id, column_key)
);

create index research_grids_user_idx on research_grids(user_id);
create index grid_runs_grid_idx on grid_runs(grid_id, started_at desc);
create index grid_rows_run_idx on grid_rows(grid_run_id);
create index grid_cells_row_idx on grid_cells(grid_row_id);
create index grid_cells_snapshot_idx on grid_cells(snapshot_id);
```

- [ ] **Step 2: Write the down migration**

Create `db/migrations/0030_analyst_grids.down.sql`:

```sql
drop table if exists grid_cells;
drop table if exists grid_rows;
drop table if exists grid_runs;
drop table if exists research_grids;
```

- [ ] **Step 3: Verify the migration applies and rolls back**

Run: `cd db && npm run migrate -- status`
Expected: lists `0030_analyst_grids` as **pending**.

Run: `cd db && npm run migrate -- up`
Expected: applies `0030_analyst_grids`; exit 0.

Run: `cd db && npm run migrate -- down`
Expected: reverts one migration (0030); exit 0. Then `npm run migrate -- up` again to leave it applied.

> Note: `migrate` needs a database; against docker-pg it picks up `DATABASE_URL`/`--database-url`. If no local DB is available, rely on the docker-pg tests in later tasks (which run all migrations during `bootstrapDatabase`) to exercise this file.

- [ ] **Step 4: Commit**

```bash
git add db/migrations/0030_analyst_grids.up.sql db/migrations/0030_analyst_grids.down.sql
git commit -m "feat(db): add analyst grid tables (research_grids, grid_runs, grid_rows, grid_cells)"
```

---

## Task 2: Service scaffold — package.json, types, index

**Files:**
- Create: `services/analyst-grids/package.json`
- Create: `services/analyst-grids/src/types.ts`
- Create: `services/analyst-grids/src/index.ts`

- [ ] **Step 1: Write package.json**

Create `services/analyst-grids/package.json` (mirrors `services/watchlists/package.json`):

```json
{
  "name": "analyst-grids",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "engines": {
    "node": ">=22.19.0"
  },
  "scripts": {
    "dev": "node --experimental-strip-types src/dev.ts",
    "test": "node --experimental-strip-types --test \"test/**/*.test.ts\""
  },
  "dependencies": {
    "pg": "^8.20.0"
  },
  "devDependencies": {
    "@types/pg": "^8.20.0"
  }
}
```

- [ ] **Step 2: Write types.ts**

Create `services/analyst-grids/src/types.ts`:

```ts
import type { QueryResult } from "pg";
import type { JsonValue } from "../../observability/src/types.ts";
import type { SubjectRef } from "../../shared/src/subject-ref.ts";

// Local minimal queryable surface (pg.Pool / pg.Client both satisfy it), per the
// convention in services/watchlists/src/queries.ts.
export type QueryExecutor = {
  query<R extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<R>>;
};

export const UNIVERSE_SOURCES = ["manual", "screen", "watchlist", "portfolio", "peers"] as const;
export type UniverseSource = (typeof UNIVERSE_SOURCES)[number];

// A grid's universe definition. `manual` carries pre-resolved subject_refs;
// the other sources carry the id of the referenced object.
export type UniverseSpec =
  | { source: "manual"; subject_refs: ReadonlyArray<SubjectRef> }
  | { source: "screen"; screen_id: string }
  | { source: "watchlist"; watchlist_id: string }
  | { source: "portfolio"; portfolio_id: string }
  | { source: "peers"; issuer_id: string; limit?: number };

export type ColumnSpec = { column_key: string; params?: JsonValue };

export type ResearchGridRow = {
  grid_id: string;
  user_id: string;
  name: string;
  description: string | null;
  universe_spec: UniverseSpec;
  column_specs: ReadonlyArray<ColumnSpec>;
  created_at: string;
  updated_at: string;
};

export type CreateGridInput = {
  name: string;
  description?: string | null;
  universe_spec: UniverseSpec;
  column_specs: ReadonlyArray<ColumnSpec>;
};

export type CellStatus = "pending" | "ok" | "missing_data" | "no_coverage" | "error";

export class GridNotFoundError extends Error {
  constructor(message = "grid not found") {
    super(message);
    this.name = "GridNotFoundError";
  }
}

export class GridValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GridValidationError";
  }
}
```

- [ ] **Step 3: Write index.ts (re-exports)**

Create `services/analyst-grids/src/index.ts`:

```ts
export * from "./types.ts";
export * from "./queries.ts";
export * from "./universe.ts";
export * from "./column-catalog.ts";
export * from "./cell-runner.ts";
export * from "./http.ts";
```

> This file will fail to typecheck until Tasks 3–7 create the referenced modules. That is expected; do not run a build against it until Task 7. It exists now so later tasks can append without reordering.

- [ ] **Step 4: Commit**

```bash
git add services/analyst-grids/package.json services/analyst-grids/src/types.ts services/analyst-grids/src/index.ts
git commit -m "feat(analyst-grids): scaffold service package and core types"
```

---

## Task 3: Grid CRUD queries (createGrid / getGrid / listGrids)

**Files:**
- Create: `services/analyst-grids/src/queries.ts`
- Test: `services/analyst-grids/test/queries.test.ts`

- [ ] **Step 1: Write the failing test**

Create `services/analyst-grids/test/queries.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import type { QueryResult } from "pg";

import { createGrid, getGrid, listGrids } from "../src/queries.ts";
import { GridNotFoundError, type QueryExecutor } from "../src/types.ts";

const USER_ID = "11111111-1111-4111-a111-111111111111";
const GRID_ID = "22222222-2222-4222-a222-222222222222";

type Captured = { text: string; values?: unknown[] };

function fakeDb(responder: (text: string, values?: unknown[]) => unknown[]): {
  db: QueryExecutor;
  queries: Captured[];
} {
  const queries: Captured[] = [];
  const db: QueryExecutor = {
    async query<R extends Record<string, unknown>>(text: string, values?: unknown[]) {
      queries.push({ text, values });
      return { rows: responder(text, values) as R[], rowCount: 0, command: "", oid: 0, fields: [] } satisfies QueryResult<R>;
    },
  };
  return { db, queries };
}

const GRID_DB_ROW = {
  grid_id: GRID_ID,
  user_id: USER_ID,
  name: "AI capex exposure",
  description: null,
  universe_spec: { source: "manual", subject_refs: [] },
  column_specs: [{ column_key: "latest_market_cap" }],
  created_at: "2026-06-09T00:00:00.000Z",
  updated_at: "2026-06-09T00:00:00.000Z",
};

test("createGrid inserts and returns the grid row", async () => {
  const { db, queries } = fakeDb((text) => (text.startsWith("insert") ? [GRID_DB_ROW] : []));
  const grid = await createGrid(db, USER_ID, {
    name: "AI capex exposure",
    universe_spec: { source: "manual", subject_refs: [] },
    column_specs: [{ column_key: "latest_market_cap" }],
  });
  assert.equal(grid.grid_id, GRID_ID);
  assert.equal(grid.name, "AI capex exposure");
  assert.ok(queries[0].text.startsWith("insert into research_grids"));
});

test("getGrid throws GridNotFoundError when the grid is missing or not owned", async () => {
  const { db } = fakeDb(() => []);
  await assert.rejects(() => getGrid(db, USER_ID, GRID_ID), GridNotFoundError);
});

test("listGrids returns the user's grids", async () => {
  const { db } = fakeDb(() => [GRID_DB_ROW]);
  const grids = await listGrids(db, USER_ID);
  assert.equal(grids.length, 1);
  assert.equal(grids[0].grid_id, GRID_ID);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd services/analyst-grids && node --experimental-strip-types --test "test/queries.test.ts"`
Expected: FAIL — cannot find module `../src/queries.ts`.

- [ ] **Step 3: Write the minimal implementation**

Create `services/analyst-grids/src/queries.ts`:

```ts
import {
  GridNotFoundError,
  type CreateGridInput,
  type QueryExecutor,
  type ResearchGridRow,
} from "./types.ts";

const GRID_COLUMNS = `grid_id::text as grid_id,
       user_id::text as user_id,
       name,
       description,
       universe_spec,
       column_specs,
       created_at,
       updated_at`;

type GridDbRow = {
  grid_id: string;
  user_id: string;
  name: string;
  description: string | null;
  universe_spec: unknown;
  column_specs: unknown;
  created_at: Date | string;
  updated_at: Date | string;
};

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function toGrid(row: GridDbRow): ResearchGridRow {
  return {
    grid_id: row.grid_id,
    user_id: row.user_id,
    name: row.name,
    description: row.description,
    universe_spec: row.universe_spec as ResearchGridRow["universe_spec"],
    column_specs: row.column_specs as ResearchGridRow["column_specs"],
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  };
}

export async function createGrid(
  db: QueryExecutor,
  userId: string,
  input: CreateGridInput,
): Promise<ResearchGridRow> {
  const result = await db.query<GridDbRow>(
    `insert into research_grids (user_id, name, description, universe_spec, column_specs)
     values ($1, $2, $3, $4::jsonb, $5::jsonb)
     returning ${GRID_COLUMNS}`,
    [
      userId,
      input.name,
      input.description ?? null,
      JSON.stringify(input.universe_spec),
      JSON.stringify(input.column_specs),
    ],
  );
  return toGrid(result.rows[0]);
}

export async function getGrid(
  db: QueryExecutor,
  userId: string,
  gridId: string,
): Promise<ResearchGridRow> {
  const result = await db.query<GridDbRow>(
    `select ${GRID_COLUMNS} from research_grids where grid_id = $1 and user_id = $2`,
    [gridId, userId],
  );
  if (!result.rows[0]) throw new GridNotFoundError();
  return toGrid(result.rows[0]);
}

export async function listGrids(
  db: QueryExecutor,
  userId: string,
): Promise<ReadonlyArray<ResearchGridRow>> {
  const result = await db.query<GridDbRow>(
    `select ${GRID_COLUMNS} from research_grids
      where user_id = $1
      order by updated_at desc, grid_id asc`,
    [userId],
  );
  return result.rows.map(toGrid);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd services/analyst-grids && node --experimental-strip-types --test "test/queries.test.ts"`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add services/analyst-grids/src/queries.ts services/analyst-grids/test/queries.test.ts
git commit -m "feat(analyst-grids): grid CRUD queries with fakeDb tests"
```

---

## Task 4: Run / row / cell row helpers

**Files:**
- Modify: `services/analyst-grids/src/queries.ts` (append)
- Modify: `services/analyst-grids/test/queries.test.ts` (append)

- [ ] **Step 1: Write the failing test (append to test file)**

Append to `services/analyst-grids/test/queries.test.ts`:

```ts
import { createRun, insertRow, insertPendingCell, updateCellResult } from "../src/queries.ts";

const RUN_ID = "44444444-4444-4444-a444-444444444444";
const ROW_ID = "55555555-5555-4555-a555-555555555555";
const SNAP_ID = "66666666-6666-4666-a666-666666666666";

test("createRun inserts a pending run and returns its id", async () => {
  const { db, queries } = fakeDb((text) =>
    text.startsWith("insert into grid_runs") ? [{ grid_run_id: RUN_ID }] : [],
  );
  const runId = await createRun(db, {
    gridId: GRID_ID,
    userId: USER_ID,
    asOf: "2026-06-09T00:00:00.000Z",
    cellTotal: 6,
    droppedRowCount: 0,
  });
  assert.equal(runId, RUN_ID);
  assert.ok(queries[0].values?.includes(6));
});

test("updateCellResult writes status, display, snapshot and primary_ref", async () => {
  const { db, queries } = fakeDb(() => []);
  await updateCellResult(db, {
    gridRowId: ROW_ID,
    columnKey: "latest_market_cap",
    status: "ok",
    display: { value: "$3.2T", tone: null },
    snapshotId: SNAP_ID,
    primaryRef: { kind: "fact", id: "77777777-7777-4777-a777-777777777777" },
    coverageFlag: null,
  });
  assert.ok(queries[0].text.startsWith("update grid_cells"));
  assert.ok(queries[0].values?.includes(SNAP_ID));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd services/analyst-grids && node --experimental-strip-types --test "test/queries.test.ts"`
Expected: FAIL — `createRun`/`updateCellResult` not exported.

- [ ] **Step 3: Write the minimal implementation (append to queries.ts)**

Append to `services/analyst-grids/src/queries.ts`:

```ts
import type { CellStatus } from "./types.ts";
import type { SubjectRef } from "../../shared/src/subject-ref.ts";

export async function createRun(
  db: QueryExecutor,
  input: {
    gridId: string;
    userId: string;
    asOf: string;
    cellTotal: number;
    droppedRowCount: number;
  },
): Promise<string> {
  const result = await db.query<{ grid_run_id: string }>(
    `insert into grid_runs (grid_id, user_id, status, as_of, cell_total, dropped_row_count)
     values ($1, $2, 'pending', $3, $4, $5)
     returning grid_run_id::text as grid_run_id`,
    [input.gridId, input.userId, input.asOf, input.cellTotal, input.droppedRowCount],
  );
  return result.rows[0].grid_run_id;
}

export async function insertRow(
  db: QueryExecutor,
  input: { gridRunId: string; rowNumber: number; subjectRef: SubjectRef },
): Promise<string> {
  const result = await db.query<{ grid_row_id: string }>(
    `insert into grid_rows (grid_run_id, row_number, subject_ref, status)
     values ($1, $2, $3::jsonb, 'pending')
     returning grid_row_id::text as grid_row_id`,
    [input.gridRunId, input.rowNumber, JSON.stringify(input.subjectRef)],
  );
  return result.rows[0].grid_row_id;
}

export async function insertPendingCell(
  db: QueryExecutor,
  input: { gridRowId: string; gridRunId: string; columnKey: string },
): Promise<string> {
  const result = await db.query<{ grid_cell_id: string }>(
    `insert into grid_cells (grid_row_id, grid_run_id, column_key, status)
     values ($1, $2, $3, 'pending')
     returning grid_cell_id::text as grid_cell_id`,
    [input.gridRowId, input.gridRunId, input.columnKey],
  );
  return result.rows[0].grid_cell_id;
}

export async function updateCellResult(
  db: QueryExecutor,
  input: {
    gridRowId: string;
    columnKey: string;
    status: CellStatus;
    display: { value: string; tone: "best" | "worst" | null } | null;
    snapshotId: string | null;
    primaryRef: { kind: "fact" | "claim"; id: string } | null;
    coverageFlag: string | null;
  },
): Promise<void> {
  await db.query(
    `update grid_cells
        set status = $3,
            display = $4::jsonb,
            snapshot_id = $5,
            primary_ref = $6::jsonb,
            coverage_flag = $7,
            computed_at = now()
      where grid_row_id = $1 and column_key = $2`,
    [
      input.gridRowId,
      input.columnKey,
      input.status,
      input.display === null ? null : JSON.stringify(input.display),
      input.snapshotId,
      input.primaryRef === null ? null : JSON.stringify(input.primaryRef),
      input.coverageFlag,
    ],
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd services/analyst-grids && node --experimental-strip-types --test "test/queries.test.ts"`
Expected: PASS (5 tests total).

- [ ] **Step 5: Commit**

```bash
git add services/analyst-grids/src/queries.ts services/analyst-grids/test/queries.test.ts
git commit -m "feat(analyst-grids): run/row/cell row helpers"
```

---

## Task 5: Universe dispatcher

**Files:**
- Create: `services/analyst-grids/src/universe.ts`
- Test: `services/analyst-grids/test/universe.test.ts`

The dispatcher keeps the grid service decoupled from screener/watchlist/portfolio/fundamentals internals: each non-manual source is an **injected function** returning `SubjectRef[]`. dev-api wires the real implementations (Task 10 note); tests inject fakes.

- [ ] **Step 1: Write the failing test**

Create `services/analyst-grids/test/universe.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";

import { resolveUniverse, type UniverseResolverDeps } from "../src/universe.ts";
import { GridValidationError } from "../src/types.ts";
import type { SubjectRef } from "../../shared/src/subject-ref.ts";

const USER_ID = "11111111-1111-4111-a111-111111111111";
const REF_A: SubjectRef = { kind: "issuer", id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa" };
const REF_B: SubjectRef = { kind: "issuer", id: "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb" };

function deps(over: Partial<UniverseResolverDeps> = {}): UniverseResolverDeps {
  return {
    resolveScreen: async () => [REF_A, REF_B],
    resolveWatchlist: async () => [REF_A],
    resolvePortfolio: async () => [REF_B],
    resolvePeers: async () => [REF_A, REF_B],
    ...over,
  };
}

test("manual source returns its inline subject_refs unchanged", async () => {
  const refs = await resolveUniverse(deps(), USER_ID, {
    source: "manual",
    subject_refs: [REF_A, REF_B],
  });
  assert.deepEqual(refs, [REF_A, REF_B]);
});

test("screen source delegates to the injected resolver", async () => {
  const refs = await resolveUniverse(deps(), USER_ID, { source: "screen", screen_id: "s1" });
  assert.deepEqual(refs, [REF_A, REF_B]);
});

test("invalid manual subject_refs raise GridValidationError", async () => {
  await assert.rejects(
    () => resolveUniverse(deps(), USER_ID, { source: "manual", subject_refs: [{ kind: "bogus", id: "x" } as never] }),
    GridValidationError,
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd services/analyst-grids && node --experimental-strip-types --test "test/universe.test.ts"`
Expected: FAIL — cannot find `../src/universe.ts`.

- [ ] **Step 3: Write the minimal implementation**

Create `services/analyst-grids/src/universe.ts`:

```ts
import { isSubjectRef, type SubjectRef } from "../../shared/src/subject-ref.ts";
import { GridValidationError, type UniverseSpec } from "./types.ts";

// Each non-manual source is injected so the grid service never imports
// screener/watchlist/portfolio/fundamentals internals directly.
export type UniverseResolverDeps = {
  resolveScreen: (userId: string, screenId: string) => Promise<ReadonlyArray<SubjectRef>>;
  resolveWatchlist: (userId: string, watchlistId: string) => Promise<ReadonlyArray<SubjectRef>>;
  resolvePortfolio: (userId: string, portfolioId: string) => Promise<ReadonlyArray<SubjectRef>>;
  resolvePeers: (issuerId: string, limit: number) => Promise<ReadonlyArray<SubjectRef>>;
};

export const DEFAULT_PEER_LIMIT = 5;

export async function resolveUniverse(
  deps: UniverseResolverDeps,
  userId: string,
  spec: UniverseSpec,
): Promise<ReadonlyArray<SubjectRef>> {
  switch (spec.source) {
    case "manual": {
      for (const ref of spec.subject_refs) {
        if (!isSubjectRef(ref)) {
          throw new GridValidationError("manual universe contains an invalid subject_ref");
        }
      }
      return spec.subject_refs;
    }
    case "screen":
      return deps.resolveScreen(userId, spec.screen_id);
    case "watchlist":
      return deps.resolveWatchlist(userId, spec.watchlist_id);
    case "portfolio":
      return deps.resolvePortfolio(userId, spec.portfolio_id);
    case "peers":
      return deps.resolvePeers(spec.issuer_id, spec.limit ?? DEFAULT_PEER_LIMIT);
    default: {
      const _exhaustive: never = spec;
      throw new GridValidationError(`unknown universe source: ${(_exhaustive as UniverseSpec).source}`);
    }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd services/analyst-grids && node --experimental-strip-types --test "test/universe.test.ts"`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add services/analyst-grids/src/universe.ts services/analyst-grids/test/universe.test.ts
git commit -m "feat(analyst-grids): universe dispatcher with injected source resolvers"
```

---

## Task 6: Column catalog + `latest_market_cap` deterministic producer

**Files:**
- Create: `services/analyst-grids/src/column-catalog.ts`
- Test: `services/analyst-grids/test/column-catalog.test.ts`

The producer loads the latest `market_cap` fact for an issuer and returns a `GridCellResult` whose `seal` is built with analyze's `buildFactBackedSealInput`. The metric is identified by code (`market_cap`) via the `metrics` table.

> **Reference:** `services/analyze/src/block-seal-input.ts` (`buildFactBackedSealInput`, `FactRow`), `services/analyze/src/metrics-comparison-snapshot.ts` for the block shape pattern. `FactRow` here = `VerifierFact & { source_id }`.

- [ ] **Step 1: Write the failing test (docker-pg, with seeded fact)**

Create `services/analyst-grids/test/column-catalog.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { bootstrapDatabase, connectedClient } from "../../../db/test/docker-pg.ts";
import { getColumn, listColumns } from "../src/column-catalog.ts";
import type { QueryExecutor } from "../src/types.ts";

test("catalog lists the latest_market_cap column", () => {
  const entries = listColumns();
  const keys = entries.map((c) => c.column_key);
  assert.ok(keys.includes("latest_market_cap"));
  assert.equal(getColumn("latest_market_cap")?.kind, "deterministic");
});

test("latest_market_cap produces a sealable ok cell for a seeded fact", async (t) => {
  const { databaseUrl } = await bootstrapDatabase(t, "analyst-grids-col");
  const client = await connectedClient(t, databaseUrl);
  const db = client as unknown as QueryExecutor;

  // Seed: source, issuer, metric, fact. (Use the minimal columns each table requires.)
  const sourceId = randomUUID();
  const issuerId = randomUUID();
  const metricId = randomUUID();
  const factId = randomUUID();
  await db.query(
    `insert into sources (source_id, provider, kind, trust_tier, license_class, retrieved_at)
     values ($1, 'SEC EDGAR', 'filing', 'primary', 'permissive', now())`,
    [sourceId],
  );
  await db.query(
    `insert into issuers (issuer_id, legal_name) values ($1, 'Acme Corp')`,
    [issuerId],
  );
  await db.query(
    `insert into metrics (metric_id, code, label, unit_class) values ($1, 'market_cap', 'Market Cap', 'currency')`,
    [metricId],
  );
  await db.query(
    `insert into facts (fact_id, subject_kind, subject_id, metric_id, period_kind,
        value_num, unit, as_of, observed_at, source_id, method, verification_status,
        freshness_class, coverage_level, confidence)
     values ($1,'issuer',$2,$3,'point', 3200000000000, 'USD', now(), now(), $4,
        'reported','authoritative','eod','full', 0.95)`,
    [factId, issuerId, metricId, sourceId],
  );

  const producer = getColumn("latest_market_cap")!.producer;
  const result = await producer(
    { db },
    {
      subject: { kind: "issuer", id: issuerId },
      period: null,
      snapshotId: randomUUID(),
      asOf: new Date().toISOString(),
    },
  );

  assert.equal(result.status, "ok");
  assert.match(result.display.value, /3\.2/);
  assert.equal(result.primaryRef?.kind, "fact");
  assert.equal(result.primaryRef?.id, factId);
  assert.ok(result.seal, "expected a seal input");
});

test("latest_market_cap returns missing_data when no fact exists", async (t) => {
  const { databaseUrl } = await bootstrapDatabase(t, "analyst-grids-col-empty");
  const client = await connectedClient(t, databaseUrl);
  const db = client as unknown as QueryExecutor;
  const result = await getColumn("latest_market_cap")!.producer(
    { db },
    { subject: { kind: "issuer", id: randomUUID() }, period: null, snapshotId: randomUUID(), asOf: new Date().toISOString() },
  );
  assert.equal(result.status, "missing_data");
  assert.equal(result.seal, undefined);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd services/analyst-grids && node --experimental-strip-types --test "test/column-catalog.test.ts"`
Expected: FAIL — cannot find `../src/column-catalog.ts`.

- [ ] **Step 3: Write the minimal implementation**

Create `services/analyst-grids/src/column-catalog.ts`:

```ts
import { randomUUID } from "node:crypto";
import type { SubjectRef } from "../../shared/src/subject-ref.ts";
import type { SnapshotSealInput } from "../../snapshot/src/snapshot-sealer.ts";
import { buildFactBackedSealInput, type FactRow } from "../../analyze/src/block-seal-input.ts";
import type { QueryExecutor } from "./types.ts";

// A grid cell's period context. Plan 1 producers ignore it (null); Plan 2 adds
// the per-row resolver and period-sensitive columns.
export type PeriodContext = null | {
  period_kind: string;
  fiscal_year: number | null;
  fiscal_period: string | null;
};

export type GridColumnContext = {
  subject: SubjectRef;
  period: PeriodContext;
  snapshotId: string;
  asOf: string;
};

export type GridCellResult = {
  status: "ok" | "missing_data" | "no_coverage" | "error";
  display: { value: string; tone: "best" | "worst" | null };
  primaryRef?: { kind: "fact" | "claim"; id: string };
  seal?: SnapshotSealInput;
  coverageFlag?: string;
};

export type GridColumnDeps = { db: QueryExecutor };

export type GridColumnProducer = (
  deps: GridColumnDeps,
  ctx: GridColumnContext,
) => Promise<GridCellResult>;

export type ColumnCatalogEntry = {
  column_key: string;
  label: string;
  kind: "deterministic" | "reader";
  producer: GridColumnProducer;
};

const MISSING: GridCellResult = { status: "missing_data", display: { value: "—", tone: null } };

// Format a USD currency value compactly, e.g. 3_200_000_000_000 -> "$3.2T".
function formatCompactUsd(value: number): string {
  const abs = Math.abs(value);
  const units: ReadonlyArray<[number, string]> = [
    [1e12, "T"],
    [1e9, "B"],
    [1e6, "M"],
  ];
  for (const [scale, suffix] of units) {
    if (abs >= scale) return `$${(value / scale).toFixed(1)}${suffix}`;
  }
  return `$${value.toFixed(0)}`;
}

const latestMarketCapProducer: GridColumnProducer = async (deps, ctx) => {
  if (ctx.subject.kind !== "issuer") return MISSING;
  const { rows } = await deps.db.query<{
    fact_id: string;
    value_num: string | number | null;
    source_id: string;
    unit: string;
    period_kind: string;
    period_start: string | null;
    period_end: string | null;
    fiscal_year: number | null;
    fiscal_period: string | null;
  }>(
    `select f.fact_id::text as fact_id, f.value_num, f.source_id::text as source_id,
            f.unit, f.period_kind,
            f.period_start::text as period_start, f.period_end::text as period_end,
            f.fiscal_year, f.fiscal_period
       from facts f
       join metrics m on m.metric_id = f.metric_id
      where m.code = 'market_cap'
        and f.subject_kind = 'issuer'
        and f.subject_id = $1
        and f.value_num is not null
        and f.invalidated_at is null
        and f.superseded_by is null
      order by f.as_of desc
      limit 1`,
    [ctx.subject.id],
  );
  const row = rows[0];
  if (!row || row.value_num === null) return MISSING;

  const valueNum = Number(row.value_num);
  const factRow: FactRow = {
    fact_id: row.fact_id,
    source_id: row.source_id,
    unit: row.unit,
    period_kind: row.period_kind,
    period_start: row.period_start,
    period_end: row.period_end,
    fiscal_year: row.fiscal_year,
    fiscal_period: row.fiscal_period,
  } as FactRow;

  // The seal's provenance block MUST use a REGISTERED block kind whose body the
  // verifier can extract the fact from — `buildFactBackedSealInput` passes
  // `kind`/`source_refs`/`items` through untouched, and the snapshot verifier
  // requires block.kind ∈ REGISTERED_BLOCK_KINDS, a source_refs array, and
  // data_ref.kind === block.kind. We reuse `metric_row` (extracts items[].value_ref
  // as a fact) — the same fact-backed pattern revenue_bars uses. Do NOT invent a
  // "grid_cell" kind (it would require editing the shared snapshot verifier).
  const block = {
    id: randomUUID(),
    kind: "metric_row" as const,
    snapshot_id: ctx.snapshotId,
    as_of: ctx.asOf,
    source_refs: [row.source_id],
    data_ref: { kind: "metric_row", id: row.fact_id, params: { column_key: "latest_market_cap" } },
    items: [{ value_ref: row.fact_id }],
  };

  const seal = buildFactBackedSealInput({
    block,
    factRefs: [row.fact_id],
    subjectRefs: [{ kind: ctx.subject.kind, id: ctx.subject.id }],
    facts: [factRow],
  });

  return {
    status: "ok",
    display: { value: formatCompactUsd(valueNum), tone: null },
    primaryRef: { kind: "fact", id: row.fact_id },
    seal,
  };
};

const CATALOG: ReadonlyMap<string, ColumnCatalogEntry> = new Map([
  [
    "latest_market_cap",
    {
      column_key: "latest_market_cap",
      label: "Market Cap (latest)",
      kind: "deterministic",
      producer: latestMarketCapProducer,
    },
  ],
]);

export function listColumns(): ReadonlyArray<Omit<ColumnCatalogEntry, "producer">> {
  return [...CATALOG.values()].map(({ column_key, label, kind }) => ({ column_key, label, kind }));
}

export function getColumn(columnKey: string): ColumnCatalogEntry | undefined {
  return CATALOG.get(columnKey);
}
```

> **If `buildFactBackedSealInput` rejects the block shape:** match the exact `VerifierBlock`/`SealableBlock` fields by reading `services/analyze/src/block-seal-input.ts:67-123` and `services/analyze/src/metrics-comparison-snapshot.ts`. The `data_ref.kind` string and `block.id` are free-form; the load-bearing requirement is that every `factRef` has a matching row in `facts` with `source_id`/`unit`/`period_*`. Do not invent fields not present in those references.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd services/analyst-grids && node --experimental-strip-types --test "test/column-catalog.test.ts"`
Expected: PASS (3 tests). (Docker required for the two DB tests.)

- [ ] **Step 5: Commit**

```bash
git add services/analyst-grids/src/column-catalog.ts services/analyst-grids/test/column-catalog.test.ts
git commit -m "feat(analyst-grids): column catalog + latest_market_cap deterministic producer"
```

---

## Task 7: Cell runner — compute, seal, persist

**Files:**
- Create: `services/analyst-grids/src/cell-runner.ts`
- Test: `services/analyst-grids/test/cell-runner.test.ts`

`computeAndPersistCell` runs a producer, seals the returned `seal` via `sealSnapshotWithPool` (one snapshot per cell), then writes the cell row. On `missing_data`/`no_coverage`/`error` (no `seal`), it persists the status with a null snapshot.

- [ ] **Step 1: Write the failing test (docker-pg)**

Create `services/analyst-grids/test/cell-runner.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";

import { bootstrapDatabase, connectedClient } from "../../../db/test/docker-pg.ts";
import { computeAndPersistCell } from "../src/cell-runner.ts";
import { getColumn } from "../src/column-catalog.ts";
import { createGrid, createRun, insertRow, insertPendingCell } from "../src/queries.ts";
import type { QueryExecutor } from "../src/types.ts";

test("computeAndPersistCell seals a snapshot and writes an ok cell", async (t) => {
  const { databaseUrl } = await bootstrapDatabase(t, "analyst-grids-cell");
  const client = await connectedClient(t, databaseUrl);
  const db = client as unknown as QueryExecutor;
  const pool = new Pool({ connectionString: databaseUrl });
  t.after(() => pool.end());

  // Seed a user, issuer, metric, source, fact (as in column-catalog.test.ts).
  const userId = randomUUID();
  const issuerId = randomUUID();
  const metricId = randomUUID();
  const sourceId = randomUUID();
  const factId = randomUUID();
  await db.query(`insert into users (user_id, email) values ($1, $2)`, [userId, `${userId}@t.dev`]);
  await db.query(
    `insert into sources (source_id, provider, kind, trust_tier, license_class, retrieved_at)
     values ($1,'SEC EDGAR','filing','primary','permissive',now())`,
    [sourceId],
  );
  await db.query(`insert into issuers (issuer_id, legal_name) values ($1,'Acme')`, [issuerId]);
  await db.query(
    `insert into metrics (metric_id, code, label, unit_class) values ($1,'market_cap','Market Cap','currency')`,
    [metricId],
  );
  await db.query(
    `insert into facts (fact_id, subject_kind, subject_id, metric_id, period_kind, value_num, unit,
        as_of, observed_at, source_id, method, verification_status, freshness_class, coverage_level, confidence)
     values ($1,'issuer',$2,$3,'point',3200000000000,'USD',now(),now(),$4,'reported','authoritative','eod','full',0.95)`,
    [factId, issuerId, metricId, sourceId],
  );

  const grid = await createGrid(db, userId, {
    name: "g",
    universe_spec: { source: "manual", subject_refs: [{ kind: "issuer", id: issuerId }] },
    column_specs: [{ column_key: "latest_market_cap" }],
  });
  const runId = await createRun(db, { gridId: grid.grid_id, userId, asOf: new Date().toISOString(), cellTotal: 1, droppedRowCount: 0 });
  const rowId = await insertRow(db, { gridRunId: runId, rowNumber: 0, subjectRef: { kind: "issuer", id: issuerId } });
  await insertPendingCell(db, { gridRowId: rowId, gridRunId: runId, columnKey: "latest_market_cap" });

  await computeAndPersistCell(
    { db, pool },
    {
      column: getColumn("latest_market_cap")!,
      gridRowId: rowId,
      subject: { kind: "issuer", id: issuerId },
      period: null,
      asOf: new Date().toISOString(),
    },
  );

  const { rows } = await db.query<{ status: string; snapshot_id: string | null; display: unknown }>(
    `select status, snapshot_id::text as snapshot_id, display from grid_cells where grid_row_id = $1`,
    [rowId],
  );
  assert.equal(rows[0].status, "ok");
  assert.ok(rows[0].snapshot_id, "expected a sealed snapshot id");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd services/analyst-grids && node --experimental-strip-types --test "test/cell-runner.test.ts"`
Expected: FAIL — cannot find `../src/cell-runner.ts`.

- [ ] **Step 3: Write the minimal implementation**

Create `services/analyst-grids/src/cell-runner.ts`:

```ts
import { randomUUID } from "node:crypto";
import {
  sealSnapshotWithPool,
  type SnapshotClientPool,
} from "../../snapshot/src/snapshot-sealer.ts";
import type { SubjectRef } from "../../shared/src/subject-ref.ts";
import { updateCellResult } from "./queries.ts";
import type { ColumnCatalogEntry, PeriodContext } from "./column-catalog.ts";
import type { QueryExecutor } from "./types.ts";

export type CellRunnerDeps = { db: QueryExecutor; pool: SnapshotClientPool };

export type ComputeCellInput = {
  column: ColumnCatalogEntry;
  gridRowId: string;
  subject: SubjectRef;
  period: PeriodContext;
  asOf: string;
};

export async function computeAndPersistCell(
  deps: CellRunnerDeps,
  input: ComputeCellInput,
): Promise<void> {
  const snapshotId = randomUUID();
  let result;
  try {
    result = await input.column.producer(
      { db: deps.db },
      { subject: input.subject, period: input.period, snapshotId, asOf: input.asOf },
    );
  } catch {
    await updateCellResult(deps.db, {
      gridRowId: input.gridRowId,
      columnKey: input.column.column_key,
      status: "error",
      display: { value: "—", tone: null },
      snapshotId: null,
      primaryRef: null,
      coverageFlag: null,
    });
    return;
  }

  let sealedSnapshotId: string | null = null;
  if (result.seal) {
    const sealResult = await sealSnapshotWithPool(deps.pool, result.seal);
    if (!sealResult.ok) {
      await updateCellResult(deps.db, {
        gridRowId: input.gridRowId,
        columnKey: input.column.column_key,
        status: "error",
        display: { value: "—", tone: null },
        snapshotId: null,
        primaryRef: null,
        coverageFlag: null,
      });
      return;
    }
    sealedSnapshotId = sealResult.snapshot.snapshot_id;
  }

  await updateCellResult(deps.db, {
    gridRowId: input.gridRowId,
    columnKey: input.column.column_key,
    status: result.status,
    display: result.display,
    snapshotId: sealedSnapshotId,
    primaryRef: result.primaryRef ?? null,
    coverageFlag: result.coverageFlag ?? null,
  });
}
```

> **Snapshot id note:** the producer embeds `ctx.snapshotId` in its block; `sealSnapshotWithPool` persists and returns the sealed `snapshot.snapshot_id`. We store the returned id (authoritative) on the cell, not the locally-generated one, in case the sealer derives its own. If a mismatch is observed in the test, read `services/snapshot/src/snapshot-sealer.ts:69-120` to confirm whether the input id or a generated id wins, and align the producer + cell accordingly.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd services/analyst-grids && node --experimental-strip-types --test "test/cell-runner.test.ts"`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add services/analyst-grids/src/cell-runner.ts services/analyst-grids/test/cell-runner.test.ts
git commit -m "feat(analyst-grids): cell runner seals per-cell snapshot and persists result"
```

---

## Task 8: HTTP server — grid CRUD + column catalog

**Files:**
- Create: `services/analyst-grids/src/http.ts`
- Create: `services/analyst-grids/src/dev.ts`
- Test: `services/analyst-grids/test/http.test.ts`

Routes (Plan 1 subset): `GET /v1/analyst-grids`, `POST /v1/analyst-grids`, `GET /v1/analyst-grids/:gridId`, `GET /v1/analyst-grids/columns`. (Run endpoints arrive in Plan 2.)

- [ ] **Step 1: Write the failing test**

Create `services/analyst-grids/test/http.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { QueryResult } from "pg";

import { createAnalystGridsServer } from "../src/http.ts";
import type { QueryExecutor } from "../src/types.ts";

const USER_ID = "11111111-1111-4111-a111-111111111111";
const GRID_ID = "22222222-2222-4222-a222-222222222222";

function fakeDb(responder: (text: string) => unknown[]): QueryExecutor {
  return {
    async query<R extends Record<string, unknown>>(text: string) {
      return { rows: responder(text) as R[], rowCount: 0, command: "", oid: 0, fields: [] } satisfies QueryResult<R>;
    },
  };
}

async function startServer(db: QueryExecutor) {
  const server = createAnalystGridsServer(db, { auth: { mode: "dev_user_header" } });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { server, base: `http://127.0.0.1:${port}` };
}

test("GET /v1/analyst-grids/columns returns the catalog", async () => {
  const { server, base } = await startServer(fakeDb(() => []));
  try {
    const res = await fetch(`${base}/v1/analyst-grids/columns`, { headers: { "x-user-id": USER_ID } });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { columns: Array<{ column_key: string }> };
    assert.ok(body.columns.some((c) => c.column_key === "latest_market_cap"));
  } finally {
    server.close();
  }
});

test("POST then GET a grid round-trips", async () => {
  const row = {
    grid_id: GRID_ID,
    user_id: USER_ID,
    name: "g",
    description: null,
    universe_spec: { source: "manual", subject_refs: [] },
    column_specs: [{ column_key: "latest_market_cap" }],
    created_at: "2026-06-09T00:00:00.000Z",
    updated_at: "2026-06-09T00:00:00.000Z",
  };
  const { server, base } = await startServer(fakeDb(() => [row]));
  try {
    const created = await fetch(`${base}/v1/analyst-grids`, {
      method: "POST",
      headers: { "x-user-id": USER_ID, "content-type": "application/json" },
      body: JSON.stringify({ name: "g", universe_spec: { source: "manual", subject_refs: [] }, column_specs: [{ column_key: "latest_market_cap" }] }),
    });
    assert.equal(created.status, 201);
    const got = await fetch(`${base}/v1/analyst-grids/${GRID_ID}`, { headers: { "x-user-id": USER_ID } });
    assert.equal(got.status, 200);
  } finally {
    server.close();
  }
});

test("missing x-user-id returns 401", async () => {
  const { server, base } = await startServer(fakeDb(() => []));
  try {
    const res = await fetch(`${base}/v1/analyst-grids`);
    assert.equal(res.status, 401);
  } finally {
    server.close();
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd services/analyst-grids && node --experimental-strip-types --test "test/http.test.ts"`
Expected: FAIL — cannot find `../src/http.ts`.

- [ ] **Step 3: Write the minimal implementation**

Create `services/analyst-grids/src/http.ts`:

```ts
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  authenticatedUserRequiredMessage,
  readAuthenticatedUserId,
  type RequestAuthConfig,
} from "../../shared/src/request-auth.ts";
import { createGrid, getGrid, listGrids } from "./queries.ts";
import { listColumns } from "./column-catalog.ts";
import { GridNotFoundError, GridValidationError, type CreateGridInput, type QueryExecutor } from "./types.ts";

const MAX_BODY = 64 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function respond(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(json);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new GridValidationError("request body too large");
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8") || "{}";
  const parsed = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null) throw new GridValidationError("body must be an object");
  return parsed as Record<string, unknown>;
}

function parseCreateInput(body: Record<string, unknown>): CreateGridInput {
  if (typeof body.name !== "string" || body.name.length === 0) throw new GridValidationError("'name' is required");
  if (typeof body.universe_spec !== "object" || body.universe_spec === null) throw new GridValidationError("'universe_spec' is required");
  if (!Array.isArray(body.column_specs)) throw new GridValidationError("'column_specs' must be an array");
  return {
    name: body.name,
    description: typeof body.description === "string" ? body.description : null,
    universe_spec: body.universe_spec as CreateGridInput["universe_spec"],
    column_specs: body.column_specs as CreateGridInput["column_specs"],
  };
}

export function createAnalystGridsServer(
  db: QueryExecutor,
  options: { auth?: RequestAuthConfig } = {},
): Server {
  return createServer(async (req, res) => {
    try {
      const method = req.method ?? "GET";
      const url = new URL(req.url ?? "/", "http://localhost");
      const path = url.pathname;

      // Public-within-service catalog still requires an authenticated user.
      const userId = readAuthenticatedUserId(req, options.auth);
      if (!userId) {
        respond(res, 401, { error: authenticatedUserRequiredMessage(options.auth) });
        return;
      }

      if (method === "GET" && path === "/v1/analyst-grids/columns") {
        respond(res, 200, { columns: listColumns() });
        return;
      }

      if (method === "GET" && path === "/v1/analyst-grids") {
        respond(res, 200, { grids: await listGrids(db, userId) });
        return;
      }

      if (method === "POST" && path === "/v1/analyst-grids") {
        const input = parseCreateInput(await readJson(req));
        const grid = await createGrid(db, userId, input);
        respond(res, 201, grid);
        return;
      }

      const gridMatch = path.match(/^\/v1\/analyst-grids\/([^/]+)$/);
      if (method === "GET" && gridMatch && UUID_RE.test(gridMatch[1])) {
        const grid = await getGrid(db, userId, gridMatch[1]);
        respond(res, 200, grid);
        return;
      }

      respond(res, 404, { error: "not found" });
    } catch (error) {
      if (error instanceof GridValidationError) {
        respond(res, 400, { error: error.message });
        return;
      }
      if (error instanceof GridNotFoundError) {
        respond(res, 404, { error: error.message });
        return;
      }
      respond(res, 500, { error: "internal error" });
    }
  });
}
```

- [ ] **Step 4: Write dev.ts**

Create `services/analyst-grids/src/dev.ts`:

```ts
import { Pool } from "pg";
import { createAnalystGridsServer } from "./http.ts";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const port = Number(process.env.PORT ?? 8093);
const host = process.env.HOST ?? "127.0.0.1";
const pool = new Pool({ connectionString: databaseUrl });
const server = createAnalystGridsServer(pool);
server.listen(port, host, () => {
  console.log(`analyst-grids listening on http://${host}:${port}`);
});
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd services/analyst-grids && node --experimental-strip-types --test "test/http.test.ts"`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add services/analyst-grids/src/http.ts services/analyst-grids/src/dev.ts services/analyst-grids/test/http.test.ts
git commit -m "feat(analyst-grids): HTTP server with grid CRUD and column catalog endpoint"
```

---

## Task 9: Evidence inspector — grid-cell visibility path

**Files:**
- Modify: `services/evidence/src/inspector.ts:114-145`
- Test: `services/analyst-grids/test/inspector-grid-access.test.ts`

A grid cell's snapshot must be inspectable by the grid's owner. Add a fourth `exists` clause to `assertSnapshotVisibleToUser` joining `grid_cells → grid_runs → research_grids` on `user_id`.

- [ ] **Step 1: Write the failing test (docker-pg)**

Create `services/analyst-grids/test/inspector-grid-access.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { bootstrapDatabase, connectedClient } from "../../../db/test/docker-pg.ts";
import { loadEvidenceInspection } from "../../evidence/src/inspector.ts";
import type { QueryExecutor } from "../src/types.ts";

// Seeds a fact + a sealed snapshot referenced by a grid cell, then asserts the
// grid owner can inspect it and a stranger cannot.
test("grid owner can inspect a snapshot referenced by their grid cell", async (t) => {
  const { databaseUrl } = await bootstrapDatabase(t, "analyst-grids-inspect");
  const client = await connectedClient(t, databaseUrl);
  const db = client as unknown as QueryExecutor;

  const ownerId = randomUUID();
  const strangerId = randomUUID();
  const issuerId = randomUUID();
  const metricId = randomUUID();
  const sourceId = randomUUID();
  const factId = randomUUID();
  const snapshotId = randomUUID();

  await db.query(`insert into users (user_id, email) values ($1,$2),($3,$4)`, [
    ownerId, `${ownerId}@t.dev`, strangerId, `${strangerId}@t.dev`,
  ]);
  await db.query(
    `insert into sources (source_id, provider, kind, trust_tier, license_class, retrieved_at)
     values ($1,'SEC EDGAR','filing','primary','permissive',now())`,
    [sourceId],
  );
  await db.query(`insert into issuers (issuer_id, legal_name) values ($1,'Acme')`, [issuerId]);
  await db.query(
    `insert into metrics (metric_id, code, label, unit_class) values ($1,'market_cap','Market Cap','currency')`,
    [metricId],
  );
  await db.query(
    `insert into facts (fact_id, subject_kind, subject_id, metric_id, period_kind, value_num, unit,
        as_of, observed_at, source_id, method, verification_status, freshness_class, coverage_level, confidence)
     values ($1,'issuer',$2,$3,'point',3200000000000,'USD',now(),now(),$4,'reported','authoritative','eod','full',0.95)`,
    [factId, issuerId, metricId, sourceId],
  );
  // Minimal sealed snapshot referencing the fact (insert directly for the access test).
  await db.query(
    `insert into snapshots (snapshot_id, subject_refs, fact_refs, source_ids, as_of, basis, normalization, allowed_transforms)
     values ($1, $2::jsonb, $3::jsonb, $4::jsonb, now(), 'unadjusted', 'raw', '{}'::jsonb)`,
    [snapshotId, JSON.stringify([{ kind: "issuer", id: issuerId }]), JSON.stringify([factId]), JSON.stringify([sourceId])],
  );

  // Grid -> run -> row -> cell referencing the snapshot.
  const gridId = randomUUID();
  const runId = randomUUID();
  const rowId = randomUUID();
  await db.query(
    `insert into research_grids (grid_id, user_id, name, universe_spec, column_specs)
     values ($1,$2,'g','{"source":"manual","subject_refs":[]}'::jsonb,'[]'::jsonb)`,
    [gridId, ownerId],
  );
  await db.query(
    `insert into grid_runs (grid_run_id, grid_id, user_id, status, as_of)
     values ($1,$2,$3,'completed',now())`,
    [runId, gridId, ownerId],
  );
  await db.query(
    `insert into grid_rows (grid_row_id, grid_run_id, row_number, subject_ref, status)
     values ($1,$2,0,$3::jsonb,'resolved')`,
    [rowId, runId, JSON.stringify({ kind: "issuer", id: issuerId })],
  );
  await db.query(
    `insert into grid_cells (grid_row_id, grid_run_id, column_key, status, snapshot_id, primary_ref)
     values ($1,$2,'latest_market_cap','ok',$3,$4::jsonb)`,
    [rowId, runId, snapshotId, JSON.stringify({ kind: "fact", id: factId })],
  );

  const inspection = await loadEvidenceInspection(db, {
    user_id: ownerId,
    snapshot_id: snapshotId,
    ref: { kind: "fact", id: factId },
  });
  assert.equal(inspection.ref.id, factId);

  await assert.rejects(() =>
    loadEvidenceInspection(db, { user_id: strangerId, snapshot_id: snapshotId, ref: { kind: "fact", id: factId } }),
  );
});
```

> Confirm the exact `loadEvidenceInspection` argument shape against `services/evidence/src/inspector.ts` before running (it takes `{ user_id, snapshot_id, ref }`). Adjust the call if the signature differs.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd services/analyst-grids && node --experimental-strip-types --test "test/inspector-grid-access.test.ts"`
Expected: FAIL — stranger rejection passes, but the **owner** call throws "snapshot is not visible" (the new path doesn't exist yet).

- [ ] **Step 3: Add the visibility path**

In `services/evidence/src/inspector.ts`, inside `assertSnapshotVisibleToUser`, add a fourth `or exists (...)` clause to the SQL (after the `findings` clause, before the closing backtick):

```sql
       or exists (
         select 1
           from grid_cells gc
           join grid_runs gr on gr.grid_run_id = gc.grid_run_id
           join research_grids g on g.grid_id = gr.grid_id
          where gc.snapshot_id = $1::uuid
            and g.user_id = $2::uuid
       )
```

The final query string in `assertSnapshotVisibleToUser` becomes the existing three clauses plus this one.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd services/analyst-grids && node --experimental-strip-types --test "test/inspector-grid-access.test.ts"`
Expected: PASS (owner inspects; stranger rejected).

- [ ] **Step 5: Run the evidence service's own tests to confirm no regression**

Run: `cd services/evidence && node --experimental-strip-types --test "test/**/*.test.ts"`
Expected: PASS (existing inspector tests unaffected — the new clause only widens visibility).

- [ ] **Step 6: Commit**

```bash
git add services/evidence/src/inspector.ts services/analyst-grids/test/inspector-grid-access.test.ts
git commit -m "feat(evidence): allow grid owners to inspect snapshots cited by their grid cells"
```

---

## Task 10: Wire universe resolvers + mount in dev-api

**Files:**
- Create: `services/analyst-grids/src/universe-wiring.ts`
- Modify: `services/dev-api/src/http.ts` (mount note)
- Test: `services/analyst-grids/test/universe-wiring.test.ts`

This binds the injected `UniverseResolverDeps` to the real services. It lives in the grid service (not dev-api) so the wiring is unit-testable, but it is only imported where a Pool + the source services are available.

- [ ] **Step 1: Write the failing test**

Create `services/analyst-grids/test/universe-wiring.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import type { QueryResult } from "pg";

import { createUniverseResolverDeps } from "../src/universe-wiring.ts";
import type { QueryExecutor } from "../src/types.ts";

const USER_ID = "11111111-1111-4111-a111-111111111111";

function fakeDb(responder: (text: string) => unknown[]): QueryExecutor {
  return {
    async query<R extends Record<string, unknown>>(text: string) {
      return { rows: responder(text) as R[], rowCount: 0, command: "", oid: 0, fields: [] } satisfies QueryResult<R>;
    },
  };
}

test("resolveWatchlist reads watchlist_members as subject refs", async () => {
  const db = fakeDb((text) =>
    text.includes("watchlist_members")
      ? [{ subject_kind: "issuer", subject_id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa", created_at: "2026-06-09T00:00:00.000Z" }]
      : text.includes("from watchlists")
        ? [{ watchlist_id: "w1" }]
        : [],
  );
  const deps = createUniverseResolverDeps(db);
  const refs = await deps.resolveWatchlist(USER_ID, "w1");
  assert.equal(refs[0].kind, "issuer");
});

test("resolvePortfolio maps holdings to subject refs", async () => {
  const db = fakeDb((text) =>
    text.includes("portfolio_holdings")
      ? [{ portfolio_holding_id: "h1", portfolio_id: "p1", subject_kind: "instrument", subject_id: "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb", quantity: 1, cost_basis: null, opened_at: null, closed_at: null, created_at: "x", updated_at: "x" }]
      : [],
  );
  const deps = createUniverseResolverDeps(db);
  const refs = await deps.resolvePortfolio(USER_ID, "p1");
  assert.equal(refs[0].kind, "instrument");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd services/analyst-grids && node --experimental-strip-types --test "test/universe-wiring.test.ts"`
Expected: FAIL — cannot find `../src/universe-wiring.ts`.

- [ ] **Step 3: Write the minimal implementation**

Create `services/analyst-grids/src/universe-wiring.ts`:

```ts
import type { SubjectRef } from "../../shared/src/subject-ref.ts";
import { listMembers } from "../../watchlists/src/queries.ts";
import { listHoldings } from "../../portfolio/src/queries.ts";
import { createPeerSetResolver } from "../../fundamentals/src/peer-set-resolver.ts";
import type { UniverseResolverDeps } from "./universe.ts";
import type { QueryExecutor } from "./types.ts";

// Binds the grid service's injected universe resolvers to the real services.
// resolveScreen is provided as a no-op-throwing stub in Plan 1 (screen
// execution needs the screener candidate registry, wired in Plan 2).
export function createUniverseResolverDeps(db: QueryExecutor): UniverseResolverDeps {
  const peers = createPeerSetResolver(db as never);
  return {
    resolveScreen: async () => {
      throw new Error("screen universe resolution is not wired until Plan 2");
    },
    resolveWatchlist: async (_userId: string, watchlistId: string): Promise<ReadonlyArray<SubjectRef>> => {
      const members = await listMembers(db as never, watchlistId);
      return members.map((m) => m.subject_ref);
    },
    resolvePortfolio: async (_userId: string, portfolioId: string): Promise<ReadonlyArray<SubjectRef>> => {
      const holdings = await listHoldings(db as never, portfolioId);
      return holdings.map((h) => h.subject_ref as SubjectRef);
    },
    resolvePeers: async (issuerId: string, limit: number): Promise<ReadonlyArray<SubjectRef>> => {
      const refs = await peers.resolvePeers(issuerId, { limit });
      return refs.map((r) => ({ kind: r.kind, id: r.id }));
    },
  };
}
```

> **Type bridging:** each source service declares its own structural `QueryExecutor`. They are compatible at runtime (all wrap `pg`), but TypeScript sees nominally distinct types, so `db as never` is used at the call boundary. If a source's exported function name differs from what's referenced here, grep the source service's `src/queries.ts` for the exact export and adjust. Do **not** add new exports to those services.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd services/analyst-grids && node --experimental-strip-types --test "test/universe-wiring.test.ts"`
Expected: PASS (2 tests).

- [ ] **Step 5: Add the dev-api mount note**

dev-api composes services. Add the analyst-grids server alongside the others. In `services/dev-api/src/http.ts`, follow the existing pattern used to mount per-feature handlers (search for how `/v1/analyze` and `/v1/watchlists` requests reach their adapters). The minimal mount is: construct `createAnalystGridsServer(pool, { auth })` and delegate requests whose path starts with `/v1/analyst-grids` to it, OR (if dev-api inlines handlers rather than composing servers) register the four Plan-1 routes by importing `createGrid`/`getGrid`/`listGrids`/`listColumns` directly. Match whichever composition style the file already uses; do not introduce a new one.

> This step has no automated test in Plan 1 (dev-api wiring is exercised by dev-api's own integration tests, which Plan 2 extends with run endpoints). Verify manually: `DATABASE_URL=... node --experimental-strip-types services/analyst-grids/src/dev.ts` then `curl -H 'x-user-id: <uuid>' localhost:8093/v1/analyst-grids/columns`.

- [ ] **Step 6: Commit**

```bash
git add services/analyst-grids/src/universe-wiring.ts services/analyst-grids/test/universe-wiring.test.ts services/dev-api/src/http.ts
git commit -m "feat(analyst-grids): wire watchlist/portfolio/peers universe resolvers + dev-api mount"
```

---

## Task 11: Full service test sweep + index typecheck

**Files:**
- Modify: none (verification task)

- [ ] **Step 1: Run the whole service test suite**

Run: `cd services/analyst-grids && node --experimental-strip-types --test "test/**/*.test.ts"`
Expected: PASS — all of queries, universe, column-catalog, cell-runner, http, inspector-grid-access, universe-wiring.

- [ ] **Step 2: Confirm index.ts re-exports resolve**

Run: `cd services/analyst-grids && node --experimental-strip-types -e "import('./src/index.ts').then(()=>console.log('index ok'))"`
Expected: prints `index ok` (all modules import without error).

- [ ] **Step 3: Run evidence + db suites to confirm no cross-service regression**

Run: `cd services/evidence && node --experimental-strip-types --test "test/**/*.test.ts"`
Expected: PASS.

Run: `cd db && npm test`
Expected: PASS (migration 0030 applies cleanly within bootstrap).

- [ ] **Step 4: Commit (if any fixups were needed)**

```bash
git add -A
git commit -m "chore(analyst-grids): green test sweep for foundations"
```

- [ ] **Step 5: Push**

```bash
git push
```

---

## Self-Review (completed during authoring)

**Spec coverage (Plan 1 portion of `2026-06-09-analyst-grid-design.md`):**
- Data model (4 tables) → Task 1. ✅
- Grid CRUD + run/row/cell helpers → Tasks 3–4. ✅
- Universe resolution, all five sources → Task 5 (dispatcher: manual inline; screen/watchlist/portfolio/peers injected) + Task 10 (watchlist/portfolio/peers wired; **screen deferred to Plan 2**, see note below). ⚠️ partial-by-design.
- Column catalog + `GridColumnProducer` + one deterministic column → Task 6. ✅
- One snapshot per cell (seal + persist) → Task 7. ✅
- Evidence inspector grid-cell visibility path → Task 9. ✅
- HTTP factory + catalog endpoint → Task 8. ✅
- Pre-rendered display strings with `tone` convention → Task 6 (`formatCompactUsd`, `tone`). ✅

**Deferred to Plan 2 / Plan 3 (intentional, documented in spec Non-goals + here):** async run engine, run endpoints + polling, `PeriodContext` resolver, screen universe wiring (needs candidate registry), web UI, extra deterministic columns, reader columns, caching.

**Placeholder scan:** no `TBD`/`TODO`/"add validation" — every code step contains the actual code. Two clearly-bounded "if X differs, read file Y" guards in Tasks 6/7/10 are verification hedges against signatures I could not 100% pin from grep, not missing content.

**Type consistency:** `QueryExecutor` (local, re-declared per service convention), `SubjectRef`, `UniverseSpec`/`ColumnSpec`, `GridCellResult`/`GridColumnProducer`, `CellStatus`, `updateCellResult` input shape, and `sealSnapshotWithPool`/`SnapshotClientPool` are used identically across Tasks 2–10. Cell statuses match the SQL `check` constraint in Task 1.

---

## Subsequent plans (roadmap — to be written after Plan 1 lands & is verified)

**Plan 2 — Async run engine + web UI:** run endpoints (`POST /:gridId/runs`, `GET /runs/:runId`), in-process bounded-concurrency worker, `cell_done`/status progress, `PeriodContext` resolver (per-row latest period + backing document), screen-universe wiring via the candidate registry, and the React surface (`GridBuilder`, `GridTable`, `useGridRun` polling, evidence-drawer hookup). Plan 2 is written against the exact types Plan 1 ships.

**Plan 3 — Column library + reader columns + polish:** remaining deterministic producers (margins, revenue growth, analyst consensus — reusing analyze emitters), one LLM reader column (claim extraction via `services/llm` router + `claim-repo`/`claim-evidence`), coverage flags, run-state UX, nav entry. Fast-follow after that: cell caching, custom prompt columns, curated templates.
