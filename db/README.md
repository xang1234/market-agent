# DB Bootstrap

Apply the normative schema pack directly:

```bash
cd db
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/postgres npm run apply:schema
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/postgres npm run verify:schema
```

Run tracked migrations:

```bash
cd db
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/postgres npm run migrate -- up
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/postgres npm run migrate -- status
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/postgres npm run migrate -- down
```

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
- `0001_init.up.sql` is an immutable snapshot of the current normative schema pack.
- `schema_migrations` tracks applied migration versions.
- `down` rolls back one migration per invocation.
- Seed files in `db/seed/*.sql` are applied in lexical order and are idempotent — rerunning does not duplicate rows.
