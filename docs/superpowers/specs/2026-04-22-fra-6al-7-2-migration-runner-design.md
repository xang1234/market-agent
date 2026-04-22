# fra-6al.7.2 Migration Runner Design

## Scope

Implement a forward/backward SQL migration runner in the existing `db/` workspace so schema changes after the initial bootstrap are reproducible, tracked, and reversible.

This spec covers bead `fra-6al.7.2` only:
- migration file format and layout
- migration tracking table
- runner commands and behavior
- rollback contract
- integration-test strategy

This spec does not cover:
- metrics/source seed data (`fra-6al.7.3`)
- partition strategy (`fra-6al.7.4`)
- changes to `spec/finance_research_db_schema.sql`

## Context

`fra-6al.7.1` added a `db/` package with:
- `apply:schema` to load the normative schema pack from `spec/finance_research_db_schema.sql`
- `verify:schema` to verify `pgcrypto` plus the expected table inventory
- Docker-backed Postgres 15 integration coverage

That bootstrap path proves the schema pack can be applied to a fresh database, but it does not yet provide:
- tracked migration history
- ordered forward application of later schema changes
- reversible rollback support
- status inspection for applied vs pending migrations

`fra-6al.7.2` fills that gap.

## Goals

- Every schema change after the initial bootstrap runs through a tracked migration.
- Each migration has a forward file and a backward file.
- The runner can apply all pending migrations in order.
- The runner can roll back the most recently applied migration.
- The runner can report which migrations are applied and which remain pending.
- The runner works against PostgreSQL 15+ and reuses the current `db/` workspace/tooling.

## Non-Goals

- Partial rollback to an arbitrary in-between statement inside one migration.
- Parallel execution of unrelated migrations.
- ORM-based schema generation.
- Automatic drift detection against live databases beyond applied-migration history.
- Automatic creation of new migration files from diffs.

## Chosen Approach

Use SQL migration pairs plus a small TypeScript runner in `db/scripts/migrate.ts`.

Each migration version is represented by two files:
- `db/migrations/0001_init.up.sql`
- `db/migrations/0001_init.down.sql`

The runner will:
- create `schema_migrations` if missing
- discover migration pairs from `db/migrations/`
- validate that every version has both `.up.sql` and `.down.sql`
- apply pending `.up.sql` files in lexical order
- roll back exactly one most-recent migration by executing its `.down.sql`
- track applied migrations in `schema_migrations`
- report applied/pending status

This keeps the system aligned with the new `db/` package:
- SQL stays the source of truth
- no new framework is introduced
- tests can continue using disposable Postgres containers

## Migration Layout

Files:
- `db/migrations/0001_init.up.sql`
- `db/migrations/0001_init.down.sql`
- later migrations follow `NNNN_description.up.sql` and `NNNN_description.down.sql`

Rules:
- version prefix is zero-padded and ordered lexically
- version numbers are unique
- the same version must have exactly one `.up.sql` and one `.down.sql`
- descriptions are informational only; ordering is by version prefix

`0001_init.up.sql` will be an immutable SQL snapshot of the current normative schema pack.

`0001_init.down.sql` will drop objects in reverse dependency order, including:
- tables
- indexes that survive table drops only if needed explicitly
- enum types

The down migration must leave a fresh database with no application schema objects and no `schema_migrations` row for `0001_init`.

## Tracking Table

The runner will manage this table:

```sql
create table if not exists schema_migrations (
  version text primary key,
  name text not null,
  applied_at timestamptz not null default now()
);
```

Behavior:
- inserting a row marks a migration applied
- deleting that row marks it rolled back
- rows are ordered by `version`

The table belongs to the migration system, not the product schema pack.

## Runner Commands

Add a single CLI entry point with subcommands:
- `npm run migrate -- up`
- `npm run migrate -- down`
- `npm run migrate -- status`

Command behavior:

### `up`

- connect to the target database
- ensure `schema_migrations` exists
- load local migrations
- compare local versions with applied versions
- execute every pending `.up.sql` file in order
- wrap each migration in its own transaction
- insert its tracking row only after the SQL succeeds

### `down`

- connect to the target database
- ensure `schema_migrations` exists
- find the most recently applied migration by version
- execute its `.down.sql` in a transaction
- delete its row from `schema_migrations` only after success
- if no migrations are applied, exit cleanly with a no-op message

### `status`

- connect to the target database
- ensure `schema_migrations` exists
- print each local migration with status `applied` or `pending`
- fail if the database contains an applied migration version that is missing locally

## Transaction and Failure Rules

- Each migration runs in its own transaction.
- A failed migration leaves no tracking-row write behind.
- `up` stops at the first failure.
- `down` rolls back only one migration per invocation.
- If a migration file pair is malformed or missing, the runner fails before modifying the database.

This keeps failure boundaries clear and avoids partial-history corruption.

## Initial Migration Strategy

`0001_init.up.sql` is the bridge from the normative schema pack to tracked history.

Implementation rule:
- copy the current `spec/finance_research_db_schema.sql` contents into `db/migrations/0001_init.up.sql`

Rationale:
- migrations must remain immutable even if the normative schema pack changes later
- later diffs should be expressed as `0002_*`, `0003_*`, and so on

`apply:schema` from `fra-6al.7.1` remains useful as a direct bootstrap check for the normative pack. The migration runner becomes the required path for tracked schema evolution.

## Testing Strategy

Add Docker-backed integration coverage in `db/test/` that proves:

1. `up` on a fresh Postgres 15 database:
- creates `schema_migrations`
- applies `0001_init.up.sql`
- records `0001`
- yields the expected public tables

2. `status` after `up`:
- reports `0001_init` as applied

3. `down` after `up`:
- removes `0001` from `schema_migrations`
- removes application tables from `public`

4. Re-running `down` on an already-empty migration state:
- exits cleanly without error

The integration tests will reuse the current disposable-container pattern and dynamic Docker port allocation from `fra-6al.7.1`.

## Error Handling

The runner should fail clearly for:
- missing `DATABASE_URL`
- duplicate local migration versions
- missing `.up.sql` or `.down.sql` pair
- local/applied migration mismatch
- SQL execution failure inside a migration

Failure output should identify:
- the migration version
- the direction (`up` or `down`)
- the statement or file that failed when practical

## Files Expected

- `db/package.json`
- `db/README.md`
- `db/migrations/0001_init.up.sql`
- `db/migrations/0001_init.down.sql`
- `db/scripts/migrate.ts`
- `db/scripts/schema-support.ts`
- `db/test/*.test.ts`

## Acceptance Criteria

`fra-6al.7.2` is complete when:
- a tracked migration runner exists in `db/`
- `0001_init` has both `up` and `down` migration files
- `up`, `down`, and `status` commands work against Postgres 15+
- integration tests prove forward then backward migration on a fresh DB
- documentation reflects the tracked-migration workflow

## Self-Review Notes

Checked for:
- placeholders: none
- contradictions: none; bootstrap and tracked migrations have separate roles
- scope creep: seeds and partitioning are explicitly excluded
- ambiguity: rollback behavior is intentionally one-migration-per-run and explicit
