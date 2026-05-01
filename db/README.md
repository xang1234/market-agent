# DB Bootstrap

Apply the normative schema pack directly:

```bash
cd db
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/postgres npm run apply:schema
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/postgres npm run verify:schema
```

Use this direct path for untracked or dev schema verification. For databases
managed by `schema_migrations`, use the tracked migration path below instead;
do not run both bootstrap paths against the same empty database.

Run tracked migrations:

```bash
cd db
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/postgres npm run migrate -- up
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/postgres npm run migrate -- status
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/postgres npm run migrate -- down
```

Before applying `0006_chat_messages_snapshot_not_null`, check for legacy
message rows without sealed snapshots:

```sql
select count(*) from chat_messages where snapshot_id is null;
```

The migration intentionally fails if any such rows exist. Remediate by
deleting unsealed message history or attaching each row to a valid sealed
snapshot before rerunning `migrate -- up`.

Before applying `0009_theme_memberships_unique`, check for duplicate
`(theme_id, subject_kind, subject_id)` rows in `theme_memberships`:

```sql
select theme_id, subject_kind, subject_id, count(*)
  from theme_memberships
 group by theme_id, subject_kind, subject_id
having count(*) > 1;
```

The migration adds a unique constraint over that triple and will fail if
any duplicates exist. Remediate by keeping the most recent row per group
(typically by `effective_at desc`, then `theme_membership_id desc` as a
tiebreaker) and deleting the rest before rerunning `migrate -- up`.

Seed reference data (metrics registry + minimal source registry):

```bash
cd db
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/postgres npm run seed
```

Run integration tests:

```bash
cd db
npm test
```

Notes:
- `0001_init.up.sql` is immutable migration history. Later migrations upgrade it
  to the current normative schema in `spec/finance_research_db_schema.sql`.
- `schema_migrations` tracks applied migration versions.
- `down` rolls back one migration per invocation.
- Seed files in `db/seed/*.sql` are applied in lexical order and are idempotent — rerunning does not duplicate rows.
