# Analyze Run Purge on Account Erasure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make user erasure explicitly purge a user's historical Analyze runs before deleting the user, so the `users → analyze_templates` cascade is no longer FK-blocked by surviving `analyze_template_runs`.

**Architecture:** Add a private `purgeAnalyzeTemplateRunsForUser` helper to `services/evidence/src/blob-gc-repo.ts` (the de-facto user-erasure transaction owner; `evidence` can't import `analyze` without a dependency cycle), call it inside the existing `deleteUserAndQueueObjectBlobs` transaction immediately before `delete from users`, and surface what was purged via a new `purged_analyze_run_ids` field on the result. A docker-pg integration test proves the FK-unblock against the real schema; a FakeDb unit test pins the ordering and return wiring.

**Tech Stack:** Node `--experimental-strip-types` + `node:test`, Postgres (`pg`), docker-pg integration harness (`db/test/docker-pg.ts`).

---

## File Structure

- `services/evidence/src/blob-gc-repo.ts` — **Modify.** Add the private `purgeAnalyzeTemplateRunsForUser` helper; call it in the `deleteUserAndQueueObjectBlobs` transaction before `delete from users`; add `purged_analyze_run_ids` to `DeleteUserBlobQueueResult` and populate it.
- `services/evidence/test/blob-gc-repo.test.ts` — **Modify.** Add a docker-pg integration test (real FK-unblock + run purge); extend the `FakeDb` with an `analyze_template_runs` delete branch and update the ordering assertions in the existing "queues … before deleting the user" test.

No CI workflow change: the evidence CI job already installs `db` deps and runs docker-pg integration tests.

---

## Task 1: Docker-pg integration test for the FK-unblock (failing)

**Files:**
- Test: `services/evidence/test/blob-gc-repo.test.ts`

- [ ] **Step 1: Add the harness import**

At the top of the file, after the existing `import type { QueryExecutor } from "../src/types.ts";` line, add:

```ts
import {
  bootstrapDatabase,
  connectedClient,
  dockerAvailable,
} from "../../../db/test/docker-pg.ts";
```

- [ ] **Step 2: Append the integration test**

Add at the end of the file:

```ts
test(
  "deleteUserAndQueueObjectBlobs purges the user's analyze runs so the template cascade is not FK-blocked",
  { skip: !dockerAvailable(), timeout: 120000 },
  async (t) => {
    const { databaseUrl } = await bootstrapDatabase(t, "blob-gc-analyze-purge");
    const client = await connectedClient(t, databaseUrl);

    const { rows: userRows } = await client.query<{ user_id: string }>(
      `insert into users (email) values ('erase-me@example.com') returning user_id::text as user_id`,
    );
    const userId = userRows[0].user_id;

    const { rows: templateRows } = await client.query<{ template_id: string }>(
      `insert into analyze_templates (user_id, name, prompt_template)
       values ($1::uuid, 'T', 'P')
       returning template_id::text as template_id`,
      [userId],
    );
    const templateId = templateRows[0].template_id;

    const { rows: snapshotRows } = await client.query<{ snapshot_id: string }>(
      `insert into snapshots (subject_refs, as_of, basis, normalization, allowed_transforms)
       values ('[]'::jsonb, now(), 'as_reported', 'none', '[]'::jsonb)
       returning snapshot_id::text as snapshot_id`,
    );
    const snapshotId = snapshotRows[0].snapshot_id;

    const { rows: runRows } = await client.query<{ run_id: string }>(
      `insert into analyze_template_runs (template_id, template_version, snapshot_id, blocks)
       values ($1::uuid, 1, $2::uuid, '[]'::jsonb)
       returning run_id::text as run_id`,
      [templateId, snapshotId],
    );
    const runId = runRows[0].run_id;

    // Before the fix, this throws a foreign-key violation: deleting the user
    // cascades to hard-delete the template, which the surviving run blocks.
    const result = await deleteUserAndQueueObjectBlobs(objectBlobGcTransactionClient(client), userId);

    assert.equal(result.deleted_user, true);
    assert.deepEqual(result.purged_analyze_run_ids, [runId]);

    const runCount = await client.query<{ n: string }>(
      `select count(*)::text as n from analyze_template_runs where run_id = $1::uuid`,
      [runId],
    );
    assert.equal(runCount.rows[0].n, "0", "the analyze run is purged");

    const userCount = await client.query<{ n: string }>(
      `select count(*)::text as n from users where user_id = $1::uuid`,
      [userId],
    );
    assert.equal(userCount.rows[0].n, "0", "the user is deleted");

    const templateCount = await client.query<{ n: string }>(
      `select count(*)::text as n from analyze_templates where template_id = $1::uuid`,
      [templateId],
    );
    assert.equal(templateCount.rows[0].n, "0", "the template is cascade-deleted");
  },
);
```

- [ ] **Step 3: Run the test to verify it fails**

Requires Docker running.
Run:
```bash
cd services/evidence && npm test
```
Expected: this new test FAILS — `deleteUserAndQueueObjectBlobs` throws a foreign-key violation (`update or delete on table "analyze_templates" violates foreign key constraint "analyze_template_runs_template_id_fkey"`) because the run still references the template the user-delete cascade is trying to remove. (If Docker is unavailable the test SKIPS — start Docker before implementing.)

- [ ] **Step 4: Commit**

```bash
git add services/evidence/test/blob-gc-repo.test.ts
git commit -m "test(evidence): erasure purges analyze runs / unblocks template cascade (fra-hmbq)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: FakeDb unit assertions for ordering + return wiring (failing)

**Files:**
- Test: `services/evidence/test/blob-gc-repo.test.ts`

- [ ] **Step 1: Teach the `FakeDb` to answer the purge query**

In the `FakeDb.query` method, add a branch immediately before the final fallthrough `return { rows: [], rowCount: 0 } as never;` (currently the last statement of the method):

```ts
    if (/delete from analyze_template_runs/i.test(text)) {
      return { rows: [{ run_id: "run-1" }] as R[], rowCount: 1 } as never;
    }
```

- [ ] **Step 2: Update the ordering test**

In the test `"deleteUserAndQueueObjectBlobs queues sha256 user document blobs before deleting the user"`, the purge now sits between the blob-queue insert (`queries[3]`) and the user-delete, shifting the user-delete from index 4 to index 5. Replace the final block of assertions (the `assert.match(db.queries[4]...)` line through the `commit` assertion) with:

```ts
  assert.match(db.queries[4].text, /delete from analyze_template_runs/i);
  assert.match(db.queries[4].text, /template_id in \(select template_id from analyze_templates where user_id = \$1\)/i);
  assert.match(db.queries[5].text, /delete from users where user_id = \$1/i);
  assert.match(db.queries.at(-1)?.text ?? "", /^commit$/i);
  assert.deepEqual(result.purged_analyze_run_ids, ["run-1"]);
```

- [ ] **Step 3: Run the test to verify it fails**

Run:
```bash
cd services/evidence && npm test 2>&1 | grep -E "queues sha256|tests|pass|fail"
```
Expected: the "queues sha256 …" test FAILS — `db.queries[4]` is still `delete from users` (purge not yet issued), and `result.purged_analyze_run_ids` is `undefined` (field not yet on the result).

- [ ] **Step 4: Commit**

```bash
git add services/evidence/test/blob-gc-repo.test.ts
git commit -m "test(evidence): pin purge ordering + return wiring in FakeDb erasure test (fra-hmbq)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Implement the purge helper, wiring, and result field

**Files:**
- Modify: `services/evidence/src/blob-gc-repo.ts`

- [ ] **Step 1: Add `purged_analyze_run_ids` to the result type**

Replace the `DeleteUserBlobQueueResult` type (currently):

```ts
export type DeleteUserBlobQueueResult = Readonly<{
  queued_raw_blob_ids: readonly string[];
  deleted_user: boolean;
}>;
```

with:

```ts
export type DeleteUserBlobQueueResult = Readonly<{
  queued_raw_blob_ids: readonly string[];
  purged_analyze_run_ids: readonly string[];
  deleted_user: boolean;
}>;
```

- [ ] **Step 2: Add the purge helper**

Add immediately above the existing `lockUserBlobScope` function (the private helpers section):

```ts
// Analyze runs are owned via user → analyze_templates → analyze_template_runs (runs
// carry no user_id). Migration 0028 dropped the runs→template ON DELETE CASCADE so
// runs stay inspectable after a template *soft* delete, but that leaves surviving runs
// blocking the user→template hard-delete cascade during erasure. Purge them first.
// Lives here (not in services/analyze) because analyze imports evidence — evidence
// cannot import analyze — and this must share the user-delete's transaction.
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

- [ ] **Step 3: Call the helper in the transaction and populate the result**

In `deleteUserAndQueueObjectBlobs`, replace this block:

```ts
    const deleted = await db.query<{ user_id: string }>(
      `delete from users where user_id = $1 returning user_id`,
      [userId],
    );
    await db.query("commit");
    return Object.freeze({
      queued_raw_blob_ids: Object.freeze(queued.rows.map((row) => row.raw_blob_id)),
      deleted_user: deleted.rowCount === 1,
    });
```

with:

```ts
    const purgedRunIds = await purgeAnalyzeTemplateRunsForUser(db, userId);
    const deleted = await db.query<{ user_id: string }>(
      `delete from users where user_id = $1 returning user_id`,
      [userId],
    );
    await db.query("commit");
    return Object.freeze({
      queued_raw_blob_ids: Object.freeze(queued.rows.map((row) => row.raw_blob_id)),
      purged_analyze_run_ids: Object.freeze(purgedRunIds),
      deleted_user: deleted.rowCount === 1,
    });
```

- [ ] **Step 4: Run the evidence suite to verify all green**

Run (Docker running):
```bash
cd services/evidence && npm test 2>&1 | grep -E "ℹ (tests|pass|fail)|analyze runs|queues sha256"
```
Expected: PASS — both the docker-pg integration test and the FakeDb "queues sha256 …" test pass; `fail 0`.

- [ ] **Step 5: Commit**

```bash
git add services/evidence/src/blob-gc-repo.ts
git commit -m "feat(evidence): purge analyze runs during user erasure before user delete (fra-hmbq)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Full verification, close bead, push, PR

- [ ] **Step 1: Re-run the full evidence suite**

```bash
cd services/evidence && npm test 2>&1 | grep -E "ℹ (tests|pass|fail)"
```
Expected: `fail 0`.

- [ ] **Step 2: Confirm no other caller relied on the old result shape**

```bash
grep -rn "deleteUserAndQueueObjectBlobs\b" services/ --include=*.ts | grep -v "test"
```
Expected: only the definitions/re-exports in `services/evidence/src/blob-gc-repo.ts` and `services/evidence/src/index.ts` (no consumer destructures the result, so adding a field is safe).

- [ ] **Step 3: Close the bead and push the branch**

```bash
bd close fra-hmbq --reason="User erasure now purges a user's analyze_template_runs before delete from users, unblocking the user→template cascade; purged run ids returned. Covered by a docker-pg FK-unblock test + FakeDb ordering test."
git push -u origin feat/fra-hmbq-analyze-run-purge
```

- [ ] **Step 4: Open the PR**

```bash
gh pr create --base main --title "Purge Analyze runs on account erasure (fra-hmbq)" --body "$(cat <<'EOF'
## Summary
- User erasure (deleteUserAndQueueObjectBlobs) now purges a user's analyze_template_runs **before** delete from users, so the users→analyze_templates cascade is no longer FK-blocked by surviving runs (migration 0028 dropped the runs→template ON DELETE CASCADE).
- The purge lives in evidence's existing erasure transaction (evidence can't import analyze — dependency cycle); returns the purged run ids via a new purged_analyze_run_ids result field.

## Test Plan
- [x] docker-pg integration test: seeding a user+template+snapshot+run, erasure succeeds (no FK violation), run + user + template are gone, purged_analyze_run_ids contains the run — fails before the fix
- [x] FakeDb unit test: purge is issued between blob-queue and delete-from-users, result carries purged_analyze_run_ids
- [x] services/evidence npm test green

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Notes for the implementer

- **Docker required for Tasks 1 & 3:** the integration test SKIPS (not fails) when Docker is down. Start Docker so the red→green is real.
- **Ordering matters:** the purge MUST run before `delete from users` — that's the whole point (it unblocks the cascade). The FakeDb ordering test guards this.
- **Why not restore the FK cascade instead:** considered and rejected in the spec (implicit/no audit hook, reverses 0028's decoupling, fragile to future migrations). Keep the explicit purge.
- **`WithPool` variant:** `deleteUserAndQueueObjectBlobsWithPool` just delegates to `deleteUserAndQueueObjectBlobs`, so it inherits the new field automatically — no change needed.
