# DB Bootstrap

Apply the normative schema pack to a Postgres database:

```bash
cd db
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/postgres npm run apply:schema
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/postgres npm run verify:schema
```

Run the disposable Postgres 15 integration test:

```bash
cd db
npm test
```
