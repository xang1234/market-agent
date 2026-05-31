# Task 8: Durable Analyze Playbook Persistence


**Files:**
- Modify: `services/analyze/src/template-runner.ts`
- Modify: `services/analyze/src/template-repo.ts`
- Modify: `spec/finance_research_db_schema.sql`
- Create: `db/migrations/0028_analyze_playbook_metadata.up.sql`
- Create: `db/migrations/0028_analyze_playbook_metadata.down.sql`
- Test: `services/analyze/test/template-runner.test.ts`
- Test: `services/analyze/test/template-repo.test.ts`
- Test: `services/analyze/test/template-runner.integration.test.ts`
- Test: `db/test/migration-registry.test.ts`

- [ ] **Step 1: Write failing persistence test**

Add to `services/analyze/test/template-runner.test.ts`:

```ts
test("persistAnalyzeTemplateRunAfterSnapshotSeal stores playbook metadata", async () => {
  const db = createRecordingAnalyzeRunClient();
  const result = await persistAnalyzeTemplateRunAfterSnapshotSeal(db.client, {
    template_id: "11111111-1111-4111-8111-111111111111",
    template_version: 1,
    playbook_id: "earnings_quality",
    run_metadata: {
      schema_version: 1,
      template_id: "11111111-1111-4111-8111-111111111111",
      template_version: 1,
      playbook_id: "earnings_quality",
      playbook_version: 1,
      instructions: "Focus on cash conversion.",
      source_categories: ["filings"],
      subject_refs: [],
      rerun_of_run_id: "33333333-3333-4333-8333-333333333333",
    },
    blocks: [],
    sealSnapshot: async () => verifiedSeal("22222222-2222-4222-8222-222222222222"),
  });
  assert.equal(result.ok, true);
  assert.equal(db.insertValues.playbook_id, "earnings_quality");
  assert.deepEqual(db.insertValues.run_metadata, {
    schema_version: 1,
    template_id: "11111111-1111-4111-8111-111111111111",
    template_version: 1,
    playbook_id: "earnings_quality",
    playbook_version: 1,
    instructions: "Focus on cash conversion.",
    source_categories: ["filings"],
    subject_refs: [],
    rerun_of_run_id: "33333333-3333-4333-8333-333333333333",
  });
});
```

Add a focused query test:

```ts
test("listAnalyzeTemplateRunsByUser uses bounded cursor pagination", async () => {
  const { db, queries } = fakeDb(() => [
    runRow({ run_id: "33333333-3333-4333-8333-333333333333", created_at: "2026-05-29T00:00:00.000Z" }),
    runRow({ run_id: "44444444-4444-4444-8444-444444444444", created_at: "2026-05-28T00:00:00.000Z" }),
  ]);
  const page = await listAnalyzeTemplateRunsByUser(db, {
    userId: "00000000-0000-4000-8000-000000000001",
    limit: 1,
    cursor: null,
  });
  assert.equal(page.runs.length, 1);
  assert.equal(typeof page.next_cursor, "string");
  assert.match(queries[0].text, /order by r\.created_at desc, r\.run_id desc/);
  assert.equal(queries[0].text.includes("t.name as template_name"), true);
  assert.equal(queries[0].text.includes("r.blocks"), false);
  assert.deepEqual(queries[0].values?.slice(-1), [2]);
});
```

- [ ] **Step 2: Run analyze tests to verify failure**

Run:

```bash
cd /Users/admin/Documents/Work/market-agent/services/analyze
npm test -- test/template-runner.test.ts
```

Expected: FAIL because `PersistAnalyzeTemplateRunInput` does not accept `playbook_id`
and `listAnalyzeTemplateRunsByUser` does not exist yet.

- [ ] **Step 3: Add migration**

Create `db/migrations/0028_analyze_playbook_metadata.up.sql`:

```sql
alter table analyze_templates
  add column deleted_at timestamptz;

alter table analyze_template_runs
  drop constraint if exists analyze_template_runs_template_id_fkey;

alter table analyze_template_runs
  add constraint analyze_template_runs_template_id_fkey
  foreign key (template_id) references analyze_templates(template_id);

alter table analyze_template_runs
  add column playbook_id text,
  add column run_metadata jsonb not null default '{}'::jsonb;

drop index if exists analyze_template_runs_template_created_idx;

create index analyze_template_runs_template_created_idx
  on analyze_template_runs(template_id, created_at desc, run_id desc);

create index analyze_templates_user_template_idx
  on analyze_templates(user_id, template_id);

create index analyze_template_runs_playbook_created_idx
  on analyze_template_runs(playbook_id, created_at desc)
  where playbook_id is not null;
```

Ordinary template deletion must be a soft delete so historical Analyze runs remain
openable. Removing `ON DELETE CASCADE` from `analyze_template_runs.template_id`
prevents an accidental hard delete from wiping sealed run artifacts. Account erasure
or test cleanup that truly needs to remove users/templates must explicitly delete
dependent runs first rather than relying on template cascade.

Do not add a `playbook_version` column in this migration. Store playbook version in
`run_metadata`; add a dedicated column later only if product queries need to filter
or aggregate by playbook version.
The database default exists only so older rows and migrations stay loadable. New
application writes must pass versioned metadata with `schema_version: 1`; do not rely
on the default `{}` for newly created runs.

Create `db/migrations/0028_analyze_playbook_metadata.down.sql`:

```sql
drop index if exists analyze_template_runs_playbook_created_idx;
drop index if exists analyze_templates_user_template_idx;

drop index if exists analyze_template_runs_template_created_idx;
create index analyze_template_runs_template_created_idx
  on analyze_template_runs(template_id, created_at desc);

alter table analyze_template_runs
  drop constraint if exists analyze_template_runs_template_id_fkey;

alter table analyze_template_runs
  add constraint analyze_template_runs_template_id_fkey
  foreign key (template_id) references analyze_templates(template_id) on delete cascade;

alter table analyze_template_runs
  drop column if exists run_metadata,
  drop column if exists playbook_id;

alter table analyze_templates
  drop column if exists deleted_at;
```

Update `spec/finance_research_db_schema.sql` table `analyze_templates`:

```sql
  deleted_at timestamptz,
```

Update `spec/finance_research_db_schema.sql` table `analyze_template_runs`:

```sql
  template_id uuid not null references analyze_templates(template_id),
  playbook_id text,
  run_metadata jsonb not null default '{}'::jsonb,
```

Update indexes in `spec/finance_research_db_schema.sql`:

```sql
create index analyze_templates_user_template_idx
  on analyze_templates(user_id, template_id);

create index analyze_template_runs_template_created_idx
  on analyze_template_runs(template_id, created_at desc, run_id desc);
```

- [ ] **Step 4: Extend persistence input and row shape**

Modify `services/analyze/src/template-runner.ts`:

```ts
export type AnalyzeTemplateRunRow = {
  run_id: string;
  template_id: string;
  template_version: number;
  playbook_id: string | null;
  run_metadata: JsonValue;
  snapshot_id: string;
  blocks: ReadonlyArray<JsonValue>;
  created_at: string;
};

export type AnalyzeTemplateRunWithTemplateRow = AnalyzeTemplateRunRow & {
  template_name: string;
};

export type AnalyzeTemplateRunSummaryRow = Omit<AnalyzeTemplateRunWithTemplateRow, "blocks">;

export type PersistAnalyzeTemplateRunInput = {
  template_id: string;
  template_version: number;
  playbook_id?: string | null;
  run_metadata: JsonValue;
  blocks: ReadonlyArray<JsonValue>;
  sealSnapshot(): Promise<SnapshotSealResult>;
};
```

Either make the internal DB row type's `blocks` field optional or introduce a
separate `AnalyzeTemplateRunSummaryDbRow`; the summary list query intentionally does
not select `blocks`.

Add a user-scoped run-history query:

```ts
export async function listAnalyzeTemplateRunsByUser(
  db: AnalyzeTemplateRunPersistenceDb,
  input: { userId: string; limit: number; cursor: string | null },
): Promise<{ runs: ReadonlyArray<AnalyzeTemplateRunSummaryRow>; next_cursor: string | null }> {
  assertNonEmptyString(input.userId, "user_id");
  const cursor = input.cursor ? decodeAnalyzeRunCursor(input.cursor) : null;
  const limit = clampAnalyzeRunLimit(input.limit);
  const { rows } = await db.query<AnalyzeTemplateRunDbRow>(
    `select r.run_id::text as run_id,
            r.template_id::text as template_id,
            t.name as template_name,
            r.template_version,
            r.playbook_id,
            r.run_metadata,
            r.snapshot_id::text as snapshot_id,
            r.created_at
       from analyze_template_runs r
       join analyze_templates t on t.template_id = r.template_id
      where t.user_id = $1::uuid
        and (
          $2::timestamptz is null
          or (r.created_at, r.run_id) < ($2::timestamptz, $3::uuid)
        )
      order by r.created_at desc, r.run_id desc
      limit $4::integer`,
    [input.userId, cursor?.created_at ?? null, cursor?.run_id ?? null, limit + 1],
  );
  const pageRows = rows.slice(0, limit).map(summaryRowFromDb);
  return Object.freeze({
    runs: Object.freeze(pageRows),
    next_cursor: rows.length > limit ? encodeAnalyzeRunCursor(pageRows[pageRows.length - 1]) : null,
  });
}
```

Add `summaryRowFromDb` next to the existing full `rowFromDb` mapper. It should parse
the same scalar fields as `rowFromDb`, including `template_name`, but intentionally
omit `blocks`; the history list query must not select or deserialize full memo
blocks.
Add `rowWithTemplateFromDb` for the detail lookup; it should parse full `blocks` plus
`template_name`.

Keep `listAnalyzeTemplateRunsByTemplate` for template-detail views, but use
`listAnalyzeTemplateRunsByUser` for `/v1/analyze/runs`.
`listAnalyzeTemplateRunsByUser` must order by `created_at desc, run_id desc` and
fetch `limit + 1` rows so it can return `next_cursor` without a count query.
Do not filter `listAnalyzeTemplateRunsByUser` or `getAnalyzeTemplateRunForUser` by
`analyze_templates.deleted_at`; deleted templates must not hide historical run
artifacts.

Add cursor helpers near the run-history query:

```ts
type AnalyzeRunCursor = {
  created_at: string;
  run_id: string;
};

function encodeAnalyzeRunCursor(row: AnalyzeTemplateRunSummaryRow): string {
  return Buffer.from(JSON.stringify({
    created_at: row.created_at,
    run_id: row.run_id,
  })).toString("base64url");
}

function decodeAnalyzeRunCursor(value: string): AnalyzeRunCursor {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<AnalyzeRunCursor>;
    assertNonEmptyString(parsed.created_at, "cursor.created_at");
    assertNonEmptyString(parsed.run_id, "cursor.run_id");
    return { created_at: parsed.created_at, run_id: parsed.run_id };
  } catch {
    throw new AnalyzeTemplateRunPersistenceError("cursor: invalid analyze run cursor");
  }
}

function clampAnalyzeRunLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit <= 0) return 25;
  return Math.min(limit, 100);
}
```

Modify `services/analyze/src/template-repo.ts` so app-level template deletion is a
soft delete:

```ts
export async function deleteAnalyzeTemplate(
  db: QueryExecutor,
  templateId: string,
): Promise<void> {
  assertUuidString(templateId, "template_id");
  const result = await db.query(
    `update analyze_templates
        set deleted_at = now(),
            updated_at = now()
      where template_id = $1::uuid
        and deleted_at is null`,
    [templateId],
  );
  if ((result.rowCount ?? 0) === 0) {
    throw new AnalyzeTemplateNotFoundError();
  }
}
```

Filter active template reads used for selection and execution:

```sql
where deleted_at is null
```

Add that predicate to `getAnalyzeTemplate`, `listAnalyzeTemplatesByUser`, and
`updateAnalyzeTemplate`. Keep run-history joins unfiltered as noted above.
Reruns against a soft-deleted template should fail with `409` and message
`analyze template is no longer runnable`, while opening the historical run still
returns the persisted blocks and snapshot.

Replace existing cascade-delete tests with tests that prove deleting a template
sets `deleted_at`, removes it from active template lists/lookups, and leaves
`analyze_template_runs` rows intact. Update the integration test currently named
`analyze_template_runs: cascade delete from analyze_templates wipes its runs` so it
asserts the opposite retention contract.

Add a user-scoped run lookup for rerun/share paths:

```ts
export async function getAnalyzeTemplateRunForUser(
  db: AnalyzeTemplateRunPersistenceDb,
  input: { userId: string; runId: string },
): Promise<AnalyzeTemplateRunWithTemplateRow | null> {
  assertNonEmptyString(input.userId, "user_id");
  assertNonEmptyString(input.runId, "run_id");
  const { rows } = await db.query<AnalyzeTemplateRunDbRow>(
    `select r.run_id::text as run_id,
            r.template_id::text as template_id,
            t.name as template_name,
            r.template_version,
            r.playbook_id,
            r.run_metadata,
            r.snapshot_id::text as snapshot_id,
            r.blocks,
            r.created_at
       from analyze_template_runs r
       join analyze_templates t on t.template_id = r.template_id
      where t.user_id = $1::uuid
        and r.run_id = $2::uuid`,
    [input.userId, input.runId],
  );
  return rows[0] ? rowWithTemplateFromDb(rows[0]) : null;
}
```

Update insert SQL:

```ts
`insert into analyze_template_runs
   (template_id, template_version, playbook_id, run_metadata, snapshot_id, blocks)
 values ($1::uuid, $2::integer, $3, $4::jsonb, $5::uuid, $6::jsonb)
 returning ${SELECT_COLUMNS}`
```

Update values:

```ts
[
  input.template_id,
  input.template_version,
  input.playbook_id ?? null,
  serializeJsonValue(input.run_metadata),
  snapshotId,
  serializeJsonValue(input.blocks as JsonValue),
]
```

When `createServiceDevApiAdapters.createRun` calls
`persistAnalyzeTemplateRunAfterSnapshotSealWithPool`, pass both identities and the
resolved run input context through the versioned metadata serializer:

```ts
playbook_id: resolvedPlaybook.playbook.playbook_id,
run_metadata: serializeAnalyzeRunMetadataV1({
  playbook_id: resolvedPlaybook.playbook.playbook_id,
  playbook_version: resolvedPlaybook.playbook.version,
  template_id: template.template_id,
  template_version: template.version,
  instructions,
  source_categories: sourceCategories,
  subject_refs: subjectRefs,
}),
```

- [ ] **Step 5: Run analyze and db tests**

Run:

```bash
cd /Users/admin/Documents/Work/market-agent/services/analyze
npm test -- test/template-runner.test.ts test/template-repo.test.ts
npm test -- test/template-runner.integration.test.ts
cd /Users/admin/Documents/Work/market-agent/db
npm test -- test/migration-registry.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add services/analyze/src/template-runner.ts services/analyze/src/template-repo.ts services/analyze/test/template-runner.test.ts services/analyze/test/template-repo.test.ts services/analyze/test/template-runner.integration.test.ts spec/finance_research_db_schema.sql db/migrations/0028_analyze_playbook_metadata.up.sql db/migrations/0028_analyze_playbook_metadata.down.sql db/test/migration-registry.test.ts
git commit -m "feat(analyze): persist playbook run metadata"
```
