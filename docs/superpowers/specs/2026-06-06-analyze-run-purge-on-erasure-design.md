# Purge historical Analyze runs on account erasure

**Bead:** fra-hmbq
**Date:** 2026-06-06

## Problem

Analyze template deletion is a **soft delete** (migration 0028 added `analyze_templates.deleted_at`; `deleteAnalyzeTemplate` sets it via `UPDATE`, and reads filter `deleted_at is null`). To let historical runs stay inspectable after a template is soft-deleted, 0028 also **dropped the `on delete cascade`** from the `analyze_template_runs.template_id` foreign key:

```sql
-- 0028_analyze_playbook_metadata.up.sql
alter table analyze_template_runs drop constraint if exists analyze_template_runs_template_id_fkey;
alter table analyze_template_runs add constraint analyze_template_runs_template_id_fkey
  foreign key (template_id) references analyze_templates(template_id);   -- NO on delete clause
```

A foreign key with no `on delete` clause defaults to `NO ACTION` (≈ RESTRICT).

Separately, `analyze_templates.user_id` references `users(user_id) **on delete cascade**`. So deleting a user cascades to **hard-delete** that user's templates. After 0028, any surviving run **blocks** that template delete via the `NO ACTION` FK.

### Consequence (sharper than "orphaned data")

The existing erasure entry point — `deleteUserAndQueueObjectBlobs(db, userId)` in
`services/evidence/src/blob-gc-repo.ts` — runs `delete from users where user_id = $1`
inside a transaction. For any user who has ever run an Analyze template:

```
delete from users
  → cascade hard-delete analyze_templates
    → blocked by analyze_template_runs NO ACTION FK
  → foreign-key violation → whole erasure transaction rolls back and throws
```

So today, "user has Analyze history" silently means "user cannot be erased." This is
undiscovered because `deleteUserAndQueueObjectBlobs` is only re-exported
(`services/evidence/src/index.ts`), not yet wired to any handler, and its integration
test never seeds an Analyze template/run.

## Goal

Make user erasure explicitly purge a user's historical Analyze runs **before** deleting
the user, so the template cascade is unblocked and no run data survives erasure. Add this
as an explicit, auditable, test-pinned step in the existing erasure transaction. No new
HTTP endpoint.

## Ownership model

Runs have **no** `user_id` of their own; ownership is `user → analyze_templates → analyze_template_runs`. A user's runs are located by joining through their templates. Nothing references `analyze_template_runs` (no inbound FKs); runs reference `snapshots` (left untouched here).

## Why the purge lives in evidence's erasure transaction

`services/analyze` imports `services/evidence` (10 files). Therefore `evidence` **cannot**
import `analyze` — that would be a dependency cycle. A cleanly analyze-owned purge function
called *from* the evidence transaction is impossible without inverting the dependency graph
(out of scope; see "Rejected alternatives").

`blob-gc-repo.ts` is already the de-facto **user-erasure transaction** owner: it locks the
user scope, queues the user's document blobs, and runs `delete from users`. It already
reaches across domains (`users`, `documents`, `sources`). Adding a plain
`delete from analyze_template_runs …` step there — co-located with the user-delete it must
atomically precede — is consistent with what the module already does, and is the only
acyclic place the step can live while sharing the user-delete's transaction.

## Design

### 1. New internal helper (`blob-gc-repo.ts`, not exported)

Parallel to `lockUserBlobScope`. A plain DELETE — no Analyze domain logic:

```ts
async function purgeAnalyzeTemplateRunsForUser(db: QueryExecutor, userId: string): Promise<string[]> {
  const { rows } = await db.query<{ run_id: string }>(
    `delete from analyze_template_runs
      where template_id in (select template_id from analyze_templates where user_id = $1)
      returning run_id::text as run_id`,
    [userId],
  );
  return rows.map((row) => row.run_id);
}
```

### 2. Transaction ordering

Insert one call between the blob-queue step and the user-delete:

```
begin
  → lockUserBlobScope(db, userId)
  → queue document blobs            (unchanged)
  → purgeAnalyzeTemplateRunsForUser (NEW — must precede the user delete)
  → delete from users
commit
```

The purge must precede `delete from users` so the user→template cascade is no longer
blocked by surviving runs.

### 3. Return shape

Extend `DeleteUserBlobQueueResult` to record what was purged, matching the module's existing
"return what we touched" pattern:

```ts
export type DeleteUserBlobQueueResult = Readonly<{
  queued_raw_blob_ids: readonly string[];
  purged_analyze_run_ids: readonly string[];   // NEW
  deleted_user: boolean;
}>;
```

`deleteUserAndQueueObjectBlobs` populates `purged_analyze_run_ids` from the helper's return;
`deleteUserAndQueueObjectBlobsWithPool` is untouched (it just delegates).

### 4. Error handling / concurrency

Unchanged from the existing transaction. Any failure — including a rare run insert racing
between purge and `delete from users` (which would re-block the cascade) — rolls the whole
transaction back and rethrows; the caller retries. No partial state. This matches the
module's existing posture (it does not guard against a concurrent document insert either).

## Testing

`services/evidence/test/blob-gc-repo.test.ts` (docker-pg integration — the real FK-contract
gate). New test:

1. Seed a `users` row, an `analyze_templates` row for that user, a minimal `snapshots` row
   (`subject_refs`, `as_of`, `basis`, `normalization`, `allowed_transforms` are the
   non-defaulted NOT NULL columns), and an `analyze_template_runs` row
   (`template_id`, `template_version`, `snapshot_id`, `blocks`).
2. Call `deleteUserAndQueueObjectBlobs`.
3. Assert:
   - it **succeeds** (no FK-violation throw) — the regression proving the cascade is unblocked,
   - the `analyze_template_runs` row is gone,
   - the `users` row is gone (`deleted_user === true`),
   - `purged_analyze_run_ids` contains the seeded run id.

This test fails today (FK violation on erasure) and passes after the fix.

## Rejected alternatives

- **Schema cascade-restore** (re-add `on delete cascade` to the runs→template FK): one-line
  migration, erasure works automatically, soft-delete unaffected (an `UPDATE` doesn't fire
  cascade). Rejected: implicit (no audit hook / no record of what was purged), reverses
  0028's deliberate run/template lifetime decoupling, and is fragile if a future migration
  re-drops the cascade without realizing erasure depends on it.
- **Proper-layering orchestrator** (split evidence's fn into a blob-queue step, give analyze
  its own `deleteAnalyzeRunsForUser`, add a new erasure orchestrator composing both + the
  user-delete): cleanest boundaries, but the most new moving parts and a new owner for
  "user erasure" — beyond this P3's chosen scope ("wire into the existing erasure").

## Out of scope

- Building an account-erasure HTTP endpoint / wiring `deleteUserAndQueueObjectBlobs` to a handler.
- Purging the `snapshots` referenced by deleted runs (separate lifecycle).
- Archiving runs to a retention store (erasure requires removal, not retention).
