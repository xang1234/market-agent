# Analyst Grid — cited, GenGrid-style research tables

**Status:** Approved design (brainstorm) — ready for implementation planning
**Date:** 2026-06-09
**Author:** David Ten (with Claude)

## Summary

Turn market-agent from a one-question / one-memo assistant into an analyst
operating surface. A user picks a **universe** (saved screen, watchlist,
portfolio, peer set, or manual tickers), composes a set of **columns**
(deterministic metrics/KPIs or LLM "reader" extractions), and runs the columns
across every row. The result is a structured table where **every cell opens the
existing evidence inspector** — citations, confidence/verification/freshness
badges, and missing-coverage flags included.

This is AlphaSense GenGrid, made source-verifiable on primitives this repo
already has: universes that resolve to `SubjectRef[]`, deterministic section
producers, fact/claim provenance, snapshot sealing, and an evidence inspector
(backend + web drawer).

## Goals (v1)

- Pick a universe from **all five** sources: saved screen, watchlist, portfolio,
  computed peer set, manual ticker list.
- **Composable column catalog** — user assembles columns à la carte from a
  registry of available producers.
- **Deterministic columns** (fact-backed metrics/KPIs) **and** a small number of
  **LLM reader columns** (claim extraction from a backing document).
- **Async execution** with progress, capped at **25 rows** in v1.
- **Per-cell evidence**: every computed cell seals its own snapshot and opens the
  existing evidence inspector unchanged.
- **Per-row period context**: each subject resolves its own latest reported
  fiscal period + backing document, so staggered earnings calendars are handled
  correctly.

## Non-goals (explicit, deferred to fast-follow)

- **Cell caching** (content-hash reuse of unchanged cells across reruns).
- **Custom free-text prompt columns** authored in the UI.
- **Saved templates** as named presets over the catalog (the catalog itself
  ships; curated presets come later).
- **Durable job queue / cross-process resumption.** v1 runs in-process; a
  stalled-run sweep is a later phase.

## Decisions (resolved during brainstorming)

| Fork | Decision |
|------|----------|
| First slice | Deterministic columns **+ a few LLM reader columns** |
| Execution | **Async job** + 25-row cap |
| Column definition | **Composable column catalog** (presets are fast-follow) |
| Snapshot grain | **One snapshot per cell** |
| Period context | **Per-row resolved** period + backing document |
| Caching | **Deferred** to a fast-follow phase |
| Reader output | **Claim extraction** (predicate + cited excerpt) |
| Universe sources | **All five** in v1 |

## Architecture

New service **`services/analyst-grids/`**, wired into `services/dev-api` like
every other service (HTTP factory + `dev.ts` Pool entrypoint). It **orchestrates
existing services** rather than reimplementing them:

- **Universe resolution** — reuses screener replay (`POST .../screens/:id/replay`
  semantics), watchlist membership (incl. dynamic), portfolio holdings, peer-set
  resolver, manual list. All five already yield `SubjectRef[]` (`{kind, id}`).
- **Deterministic column producers** — call the same repos analyze uses
  (`StatsRepository`, `ConsensusRepository`, `fact-repo`, `peer-set-resolver`)
  and the same `buildFactBackedSealInput` sealing helper
  (`services/analyze/src/block-seal-input.ts`).
- **Reader column producers** — `services/llm` router (`router.ts`/`pi-adapter.ts`)
  + `services/evidence` document retrieval (`document-repo.ts`, `object-store.ts`)
  + `claim-repo` / `claim-evidence-repo`.
- **Sealing** — `services/snapshot` sealer, **one snapshot per cell**.
- **Inspection** — existing `services/evidence/src/inspector.ts` and the existing
  web drawer (`web/src/evidence/EvidenceInspectorDrawer.tsx`), with **one** new
  authorization path.

### The column abstraction (the load-bearing new piece)

Analyze's `SectionProducer` produces a whole **block** (a peer table, revenue
bars) for one subject. A grid **cell** is a single **value**. So we introduce a
sibling, finer-grained interface (it may reuse analyze's data-fetch + seal
helpers internally, but is not the same type):

```ts
type PeriodContext = {
  period_kind: 'point' | 'fiscal_q' | 'fiscal_y' | 'ttm' | 'range';
  fiscal_year: number | null;
  fiscal_period: string | null;        // 'Q1', 'Q2', ...
  period_start: string | null;
  period_end: string | null;
  document_refs: ReadonlyArray<{ kind: 'document'; id: UUID; doc_kind: string }>;
};

type GridColumnContext = {
  subject: SubjectRef;                  // the row
  period: PeriodContext;                // resolved per-row
  snapshotId: UUID;                     // fresh, per cell
  asOf: string;
};

type GridCellResult = {
  status: 'ok' | 'missing_data' | 'no_coverage' | 'error';
  display: { value: string; tone?: 'best' | 'worst' | null };  // pre-rendered
  primaryRef?: { kind: 'fact' | 'claim'; id: UUID };           // default ref to open
  seal?: SnapshotSealInput;             // facts/claims + sources for this cell
  coverageFlag?: string;
};

type GridColumnProducer = (
  deps: GridColumnDeps,
  ctx: GridColumnContext,
) => Promise<GridCellResult>;
```

A **column catalog** registry maps
`column_key → { kind: 'deterministic' | 'reader', label, producer, requires }`.
The frontend fetches it via `GET /v1/analyst-grids/columns` to render the
composable column picker. `requires` lets a column declare prerequisites (e.g. a
reader column requires a backing document selector) so the builder can validate
before a run.

Display values are **pre-rendered to strings with optional `tone`**, matching the
existing analyze convention — the web table is a dumb renderer.

## Data model

One migration `db/migrations/NNNN_analyst_grids.{up,down}.sql`, four tables. Raw
SQL + `pg`, numbered migration pair, snake_case, per repo conventions.

```sql
create table research_grids (
  grid_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(user_id) on delete cascade,
  name text not null,
  description text,
  universe_spec jsonb not null,   -- { source: 'screen'|'watchlist'|'portfolio'|'peers'|'manual', ref... }
  column_specs jsonb not null,    -- ordered [{ column_key, params? }]
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table grid_runs (
  grid_run_id uuid primary key default gen_random_uuid(),
  grid_id uuid not null references research_grids(grid_id) on delete cascade,
  user_id uuid not null references users(user_id) on delete cascade,
  status text not null check (status in ('pending','running','partial','completed','failed')),
  as_of timestamptz not null,
  cell_total integer not null default 0,
  cell_done integer not null default 0,
  dropped_row_count integer not null default 0,  -- universe rows beyond the cap
  error_message text,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create table grid_rows (
  grid_row_id uuid primary key default gen_random_uuid(),
  grid_run_id uuid not null references grid_runs(grid_run_id) on delete cascade,
  row_number integer not null,
  subject_ref jsonb not null,         -- { kind, id }
  period_context jsonb,               -- resolved PeriodContext (null until resolved)
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
  display jsonb,                      -- { value, tone }
  snapshot_id uuid references snapshots(snapshot_id),
  primary_ref jsonb,                  -- { kind: 'fact'|'claim', id }
  coverage_flag text,
  computed_at timestamptz,
  unique (grid_row_id, column_key)
);

create index research_grids_user_idx on research_grids(user_id);
create index grid_runs_grid_idx on grid_runs(grid_id, started_at desc);
create index grid_rows_run_idx on grid_rows(grid_run_id);
create index grid_cells_row_idx on grid_cells(grid_row_id);
```

**Why rows belong to the run, not the grid:** screens (and dynamic watchlists)
re-resolve to different members over time, so each run snapshots its own resolved
universe. The grid definition stays re-runnable; each run is a stable artifact.

## Execution flow (async, in-process, 25-row cap)

`POST /v1/analyst-grids/:gridId/runs`:

1. Load grid; authorize `user_id`.
2. Resolve `universe_spec` → `SubjectRef[]`. **Cap at 25**; record
   `dropped_row_count` and `log()` the truncation — no silent drop.
3. Insert `grid_runs` (`pending`), `grid_rows` (`pending`), and `grid_cells`
   (`pending`, one per row × column). Set `cell_total`.
4. Return `{ run_id, status: 'pending' }` immediately.
5. **Detached in-process worker** (bounded concurrency, p-limit style):
   - For each row: resolve `PeriodContext` once (latest reported fiscal period +
     backing document refs); set `grid_rows.status='resolved'`.
   - For each (row, column): invoke the producer → if it returns a `seal`, seal a
     **fresh per-cell snapshot**; update `grid_cells`
     (`status`, `display`, `snapshot_id`, `primary_ref`, `coverage_flag`,
     `computed_at`); bump `cell_done`.
   - A producer error sets that cell `status='error'` and continues (one cell
     never fails the whole run).
   - Finalize run: `completed` (all ok-ish), `partial` (some cells errored), or
     `failed` (run-level failure, e.g. universe resolution).

`GET /v1/analyst-grids/runs/:runId` returns run status + rows + whatever cells
are done. The frontend **polls** until terminal.

**Durability caveat (stated, not solved in v1):** a process restart mid-run
leaves a run `running`. A later phase adds a stalled-run sweep
(`resumeStalledRuns`).

## Evidence wiring

Each cell's snapshot holds **only that cell's** `fact_refs`/`claim_refs` +
`source_ids`. Clicking a cell calls the **existing**
`loadEvidenceInspection(snapshot_id, primary_ref)` and opens the **existing**
drawer — badges (verification / freshness / coverage), confidence, and source
links come for free.

**One change to `services/evidence/src/inspector.ts`:** the snapshot-visibility
guard currently authorizes via `chat_messages`, `analyze_template_runs`, and
`findings`. Add a **fourth path** — "snapshot referenced by a `grid_cell` whose
run's grid belongs to the requesting user" (one `exists` subquery joining
`grid_cells → grid_runs → research_grids` on `user_id`).

## Reader (LLM) columns

A reader column's catalog entry declares:

```ts
{
  kind: 'reader',
  documentSelector: 'latest_transcript' | 'latest_filing',
  predicate: string,           // e.g. 'guidance_change'
  prompt: string,              // structured extraction prompt
}
```

Producer flow:

1. Resolve the target document from the row's `PeriodContext.document_refs`
   (matching `doc_kind`). None available → `status: 'no_coverage'` (a first-class
   missing-coverage flag), no snapshot.
2. Fetch document text via evidence `document-repo` / `object-store`.
3. Call `services/llm` router for a **structured** answer + supporting excerpt.
4. Persist a `claim` (`claim-repo`, with `predicate`, `polarity`, `modality`,
   `confidence`) and a `claim_evidence` row (`locator`, `excerpt_hash`) citing the
   source document.
5. Seal a per-cell snapshot with `claim_refs` + the document's `source_ids`.
6. Cell `display.value` = the extracted answer; `primary_ref = {kind:'claim'}`.

Confidence/modality/status badges then render automatically through the existing
inspector path.

## Frontend (`web/src/analyst-grids/`)

- `gridsClient.ts` — list/create/get grids, create run, poll run, fetch column
  catalog. Uses `authenticatedFetch` + `HttpJsonError`.
- `useGridRun.ts` — polling hook (stops on terminal status).
- `GridBuilder.tsx` — universe-source picker (screen / watchlist / portfolio /
  peers / manual) + catalog-driven column composer with `requires` validation.
- `GridTable.tsx` — rows × columns; per-cell states
  (`pending` → spinner, `ok` → value+tone, `missing_data` / `no_coverage` →
  flagged dash, `error` → error chip); cell click → existing `EvidenceInspector`
  via `useEvidenceInspector` / `EvidenceInspectorProvider`.
- Route + nav entry; reuse existing `Table` styling conventions.

## Build order (tracer-bullet slices)

1. Migration + grid CRUD + universe resolution (returns rows, no columns).
2. Column catalog + `GridColumnProducer` framework + **one** deterministic column
   end-to-end (sealed, inspectable) — proves the full spine.
3. Async run engine + progress + `GridTable` rendering + evidence drawer hookup.
4. `PeriodContext` resolver (per-row latest period + backing document).
5. Remaining deterministic columns.
6. **One** reader column end-to-end (claim extraction).
7. Polish: coverage flags, cap logging, nav, run-state UX.

## Testing (repo conventions)

- `node:test` + `node:assert/strict` throughout.
- docker-pg (`bootstrapDatabase`) for: grid CRUD queries, universe resolution,
  cell sealing, and the **new inspector access path**.
- Producer unit tests with fake repos (deterministic and reader).
- HTTP tests (start server, authenticated fetch, assert payloads).
- Frontend render tests against mock run payloads (table cell states + inspector
  invocation).

## Key file references (existing primitives reused)

| Concern | Path |
|---|---|
| Section producer pattern | `services/analyze/src/section-producers.ts`, `section-runner.ts` |
| Fact-backed sealing | `services/analyze/src/block-seal-input.ts` |
| Snapshot sealer | `services/snapshot/src/snapshot-sealer.ts`, `manifest-staging.ts` |
| Evidence inspector (backend) | `services/evidence/src/inspector.ts` |
| Evidence inspector (web) | `web/src/evidence/EvidenceInspectorDrawer.tsx`, `useEvidenceInspector.ts`, `inspectionClient.ts` |
| Facts / claims / claim-evidence | `services/evidence/src/{fact-repo,claim-repo,claim-evidence-repo}.ts` |
| Subject refs | `services/shared/src/subject-ref.ts` |
| Universe — screens | `services/screener/src/screen-repository.ts`, `result.ts` |
| Universe — watchlists | `services/watchlists/src/{queries,dynamic-membership}.ts` |
| Universe — portfolio | `services/portfolio/src/{queries,holdings}.ts` |
| Universe — peers | `services/fundamentals/src/peer-set-resolver.ts` |
| LLM router | `services/llm/src/{router,pi-adapter}.ts` |
| Document retrieval | `services/evidence/src/{document-repo,object-store}.ts` |
| Service anatomy reference | `services/watchlists/`, `services/home/` |
| Web table renderer | `web/src/blocks/Table.tsx` |
| Migration runner | `db/scripts/migrate.ts`, `db/scripts/schema-support.ts` |
