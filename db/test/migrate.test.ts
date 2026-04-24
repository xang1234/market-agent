import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "pg";
import {
  createContainerName,
  dbRoot,
  dockerAvailable,
  queryValue,
  run,
  startPostgres,
  stopPostgres,
  waitForPostgres,
  workspaceRoot,
} from "./docker-pg.ts";

const schemaPath = join(workspaceRoot, "spec", "finance_research_db_schema.sql");
const initMigrationPath = join(dbRoot, "migrations", "0001_init.up.sql");

function loadExpectedTables() {
  return Array.from(
    readFileSync(schemaPath, "utf8").matchAll(/^create table ([a-z_][a-z0-9_]*) \($/gim),
    (match) => match[1],
  ).sort();
}

test("migrate up applies pending migrations and records them in schema_migrations", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for db migration integration coverage");
    return;
  }

  const containerName = createContainerName("fra-6al-7-2");
  const password = "postgres";
  const hostPort = startPostgres(containerName, password);
  const databaseUrl = `postgresql://postgres:${password}@127.0.0.1:${hostPort}/postgres`;

  t.after(() => {
    stopPostgres(containerName);
  });

  await waitForPostgres(containerName, databaseUrl);

  const migrateResult = run("npm", ["run", "migrate", "--", "up", "--database-url", databaseUrl], {
    cwd: dbRoot,
    env: { DATABASE_URL: databaseUrl },
  });

  assert.equal(migrateResult.status, 0, migrateResult.stderr || migrateResult.stdout);
  assert.equal(queryValue(containerName, "select count(*) from schema_migrations"), "2");
  assert.deepEqual(
    queryValue(containerName, "select version || ':' || name from schema_migrations order by version").split("\n"),
    ["0001:init", "0002:issuer_aliases"],
  );

  const publicTables = queryValue(
    containerName,
    "select tablename from pg_tables where schemaname = 'public' order by tablename",
  )
    .split("\n")
    .filter(Boolean)
    .filter((table) => table !== "schema_migrations")
    .sort();

  assert.deepEqual(publicTables, loadExpectedTables());
});

test("migrate status reports all migrations as applied after migrate up", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for db migration integration coverage");
    return;
  }

  const containerName = createContainerName("fra-6al-7-2");
  const password = "postgres";
  const hostPort = startPostgres(containerName, password);
  const databaseUrl = `postgresql://postgres:${password}@127.0.0.1:${hostPort}/postgres`;

  t.after(() => {
    stopPostgres(containerName);
  });

  await waitForPostgres(containerName, databaseUrl);

  const upResult = run("npm", ["run", "migrate", "--", "up", "--database-url", databaseUrl], {
    cwd: dbRoot,
    env: { DATABASE_URL: databaseUrl },
  });
  assert.equal(upResult.status, 0, upResult.stderr || upResult.stdout);

  const statusResult = run("npm", ["run", "migrate", "--", "status", "--database-url", databaseUrl], {
    cwd: dbRoot,
    env: { DATABASE_URL: databaseUrl },
  });

  assert.equal(statusResult.status, 0, statusResult.stderr || statusResult.stdout);
  assert.match(statusResult.stdout, /0001\s+init\s+applied/);
  assert.match(statusResult.stdout, /0002\s+issuer_aliases\s+applied/);
});

test("migrate down rolls back the most recently applied migration", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for db migration integration coverage");
    return;
  }

  const containerName = createContainerName("fra-6al-7-2");
  const password = "postgres";
  const hostPort = startPostgres(containerName, password);
  const databaseUrl = `postgresql://postgres:${password}@127.0.0.1:${hostPort}/postgres`;

  t.after(() => {
    stopPostgres(containerName);
  });

  await waitForPostgres(containerName, databaseUrl);

  const upResult = run("npm", ["run", "migrate", "--", "up", "--database-url", databaseUrl], {
    cwd: dbRoot,
    env: { DATABASE_URL: databaseUrl },
  });
  assert.equal(upResult.status, 0, upResult.stderr || upResult.stdout);

  const downResult = run("npm", ["run", "migrate", "--", "down", "--database-url", databaseUrl], {
    cwd: dbRoot,
    env: { DATABASE_URL: databaseUrl },
  });
  assert.equal(downResult.status, 0, downResult.stderr || downResult.stdout);

  assert.equal(queryValue(containerName, "select count(*) from schema_migrations"), "1");
  assert.equal(
    queryValue(containerName, "select count(*) from pg_tables where schemaname = 'public' and tablename = 'issuer_aliases'"),
    "0",
  );
  assert.equal(
    queryValue(containerName, "select count(*) from pg_tables where schemaname = 'public' and tablename = 'issuers'"),
    "1",
  );
});

test("migrate down exits cleanly when nothing is applied", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for db migration integration coverage");
    return;
  }

  const containerName = createContainerName("fra-6al-7-2");
  const password = "postgres";
  const hostPort = startPostgres(containerName, password);
  const databaseUrl = `postgresql://postgres:${password}@127.0.0.1:${hostPort}/postgres`;

  t.after(() => {
    stopPostgres(containerName);
  });

  await waitForPostgres(containerName, databaseUrl);

  const downResult = run("npm", ["run", "migrate", "--", "down", "--database-url", databaseUrl], {
    cwd: dbRoot,
    env: { DATABASE_URL: databaseUrl },
  });

  assert.equal(downResult.status, 0, downResult.stderr || downResult.stdout);
  assert.match(downResult.stdout, /No applied migrations to roll back/);
});

test("migrate status fails when an applied migration is missing locally", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for db migration integration coverage");
    return;
  }

  const containerName = createContainerName("fra-6al-7-2");
  const password = "postgres";
  const hostPort = startPostgres(containerName, password);
  const databaseUrl = `postgresql://postgres:${password}@127.0.0.1:${hostPort}/postgres`;

  t.after(() => {
    stopPostgres(containerName);
  });

  await waitForPostgres(containerName, databaseUrl);

  const result = run("docker", [
    "exec",
    containerName,
    "psql",
    "-U",
    "postgres",
    "-d",
    "postgres",
    "-c",
    "create table schema_migrations (version text primary key, name text not null, applied_at timestamptz not null default now()); insert into schema_migrations(version, name) values ('9999', 'missing_local');",
  ]);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const statusResult = run("npm", ["run", "migrate", "--", "status", "--database-url", databaseUrl], {
    cwd: dbRoot,
    env: { DATABASE_URL: databaseUrl },
  });

  assert.notEqual(statusResult.status, 0);
  assert.match(statusResult.stderr || statusResult.stdout, /Applied migration 9999 is missing locally/);
});

test("verify:schema succeeds after migrate up", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for db migration integration coverage");
    return;
  }

  const containerName = createContainerName("fra-6al-7-2");
  const password = "postgres";
  const hostPort = startPostgres(containerName, password);
  const databaseUrl = `postgresql://postgres:${password}@127.0.0.1:${hostPort}/postgres`;

  t.after(() => {
    stopPostgres(containerName);
  });

  await waitForPostgres(containerName, databaseUrl);

  const upResult = run("npm", ["run", "migrate", "--", "up", "--database-url", databaseUrl], {
    cwd: dbRoot,
    env: { DATABASE_URL: databaseUrl },
  });
  assert.equal(upResult.status, 0, upResult.stderr || upResult.stdout);

  const verifyResult = run("npm", ["run", "verify:schema", "--", "--database-url", databaseUrl], {
    cwd: dbRoot,
    env: { DATABASE_URL: databaseUrl },
  });

  assert.equal(verifyResult.status, 0, verifyResult.stderr || verifyResult.stdout);
});

test("migrate up creates indexed issuer aliases and backfills issuer names", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for db migration integration coverage");
    return;
  }

  const containerName = createContainerName("fra-6al-4-6");
  const password = "postgres";
  const hostPort = startPostgres(containerName, password);
  const databaseUrl = `postgresql://postgres:${password}@127.0.0.1:${hostPort}/postgres`;

  t.after(() => {
    stopPostgres(containerName);
  });

  await waitForPostgres(containerName, databaseUrl);

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  t.after(() => client.end().catch(() => {}));

  await client.query(readFileSync(initMigrationPath, "utf8"));
  await client.query(`
    create table schema_migrations (
      version text primary key,
      name text not null,
      applied_at timestamptz not null default now()
    );
    insert into schema_migrations(version, name) values ('0001', 'init');
  `);
  await client.query(
    `insert into issuers (legal_name, former_names)
     values ($1, $2::jsonb)`,
    ["Alphabet Inc.", JSON.stringify(["Google"])],
  );

  const upResult = run("npm", ["run", "migrate", "--", "up", "--database-url", databaseUrl], {
    cwd: dbRoot,
    env: { DATABASE_URL: databaseUrl },
  });
  assert.equal(upResult.status, 0, upResult.stderr || upResult.stdout);

  assert.equal(
    queryValue(containerName, "select count(*) from pg_tables where schemaname = 'public' and tablename = 'issuer_aliases'"),
    "1",
  );
  assert.equal(
    queryValue(containerName, "select count(*) from pg_indexes where schemaname = 'public' and indexname = 'issuer_aliases_normalized_name_idx'"),
    "1",
  );
  assert.equal(
    queryValue(containerName, "select count(*) from issuer_aliases where normalized_name = 'alphabet inc' and match_reason = 'legal_name'"),
    "1",
  );
  assert.equal(
    queryValue(containerName, "select count(*) from issuer_aliases where normalized_name = 'google' and match_reason = 'former_name'"),
    "1",
  );
});

test("migrate up enforces listings uniqueness and fact confidence bounds", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for db migration integration coverage");
    return;
  }

  const containerName = createContainerName("fra-6al-7-2");
  const password = "postgres";
  const hostPort = startPostgres(containerName, password);
  const databaseUrl = `postgresql://postgres:${password}@127.0.0.1:${hostPort}/postgres`;

  t.after(() => {
    stopPostgres(containerName);
  });

  await waitForPostgres(containerName, databaseUrl);

  const upResult = run("npm", ["run", "migrate", "--", "up", "--database-url", databaseUrl], {
    cwd: dbRoot,
    env: { DATABASE_URL: databaseUrl },
  });
  assert.equal(upResult.status, 0, upResult.stderr || upResult.stdout);

  const setupResult = run("docker", [
    "exec",
    containerName,
    "psql",
    "-U",
    "postgres",
    "-d",
    "postgres",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    `insert into issuers (legal_name) values ('Example Issuer');
     insert into instruments (issuer_id, asset_type)
     select issuer_id, 'common_stock'::asset_type from issuers where legal_name = 'Example Issuer';
     insert into listings (instrument_id, mic, ticker, trading_currency, timezone)
     select instrument_id, 'XNAS', 'EXMPL', 'USD', 'UTC' from instruments limit 1;
     insert into metrics (metric_key, display_name, unit_class, aggregation, interpretation, canonical_source_class)
     values ('test_metric', 'Test Metric', 'currency', 'sum', 'neutral', 'gaap');
     insert into sources (provider, kind, trust_tier, license_class, retrieved_at)
     values ('test_provider', 'internal', 'primary', 'internal', now());`,
  ]);
  assert.equal(setupResult.status, 0, setupResult.stderr || setupResult.stdout);

  const duplicateListingResult = run("docker", [
    "exec",
    containerName,
    "psql",
    "-U",
    "postgres",
    "-d",
    "postgres",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    `insert into listings (instrument_id, mic, ticker, trading_currency, timezone)
     select instrument_id, 'XNAS', 'EXMPL', 'USD', 'UTC' from instruments limit 1;`,
  ]);
  assert.notEqual(duplicateListingResult.status, 0);
  assert.match(
    duplicateListingResult.stderr || duplicateListingResult.stdout,
    /duplicate key value violates unique constraint/,
  );

  const invalidConfidenceResult = run("docker", [
    "exec",
    containerName,
    "psql",
    "-U",
    "postgres",
    "-d",
    "postgres",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    `insert into facts (
       subject_kind, subject_id, metric_id, period_kind, observed_at, as_of,
       unit, confidence, source_id, method, definition_version,
       verification_status, freshness_class, coverage_level
     )
     select
       'issuer'::subject_kind,
       gen_random_uuid(),
       metric_id,
       'fiscal_q',
       now(),
       now(),
       'USD',
       2,
       (select source_id from sources where provider = 'test_provider'),
       'reported'::fact_method,
       1,
       'authoritative'::verification_status,
       'filing_time'::freshness_class,
       'full'::coverage_level
     from metrics
     where metric_key = 'test_metric';`,
  ]);
  assert.notEqual(invalidConfidenceResult.status, 0);
  assert.match(
    invalidConfidenceResult.stderr || invalidConfidenceResult.stdout,
    /violates check constraint/,
  );
});

test("migrate up rolls back schema changes when recording the migration fails", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for db migration integration coverage");
    return;
  }

  const containerName = createContainerName("fra-6al-7-2");
  const password = "postgres";
  const hostPort = startPostgres(containerName, password);
  const databaseUrl = `postgresql://postgres:${password}@127.0.0.1:${hostPort}/postgres`;

  t.after(() => {
    stopPostgres(containerName);
  });

  await waitForPostgres(containerName, databaseUrl);

  const triggerResult = run("docker", [
    "exec",
    containerName,
    "psql",
    "-U",
    "postgres",
    "-d",
    "postgres",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    `create table schema_migrations (version text primary key, name text not null, applied_at timestamptz not null default now());
     create function reject_schema_migrations_insert() returns trigger language plpgsql as $$
     begin
       raise exception 'rejecting schema_migrations insert';
     end;
     $$;
     create trigger schema_migrations_reject_insert
       before insert on schema_migrations
       for each row execute function reject_schema_migrations_insert();`,
  ]);
  assert.equal(triggerResult.status, 0, triggerResult.stderr || triggerResult.stdout);

  const upResult = run("npm", ["run", "migrate", "--", "up", "--database-url", databaseUrl], {
    cwd: dbRoot,
    env: { DATABASE_URL: databaseUrl },
  });

  assert.notEqual(upResult.status, 0);
  assert.match(upResult.stderr || upResult.stdout, /rejecting schema_migrations insert/);
  assert.equal(queryValue(containerName, "select count(*) from schema_migrations"), "0");
  assert.equal(
    queryValue(containerName, "select count(*) from pg_tables where schemaname = 'public' and tablename <> 'schema_migrations'"),
    "0",
  );
});

test("migrate down rolls back schema changes when removing the migration record fails", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for db migration integration coverage");
    return;
  }

  const containerName = createContainerName("fra-6al-7-2");
  const password = "postgres";
  const hostPort = startPostgres(containerName, password);
  const databaseUrl = `postgresql://postgres:${password}@127.0.0.1:${hostPort}/postgres`;

  t.after(() => {
    stopPostgres(containerName);
  });

  await waitForPostgres(containerName, databaseUrl);

  const upResult = run("npm", ["run", "migrate", "--", "up", "--database-url", databaseUrl], {
    cwd: dbRoot,
    env: { DATABASE_URL: databaseUrl },
  });
  assert.equal(upResult.status, 0, upResult.stderr || upResult.stdout);

  const triggerResult = run("docker", [
    "exec",
    containerName,
    "psql",
    "-U",
    "postgres",
    "-d",
    "postgres",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    `create function reject_schema_migrations_delete() returns trigger language plpgsql as $$
     begin
       raise exception 'rejecting schema_migrations delete';
     end;
     $$;
     create trigger schema_migrations_reject_delete
       before delete on schema_migrations
       for each row execute function reject_schema_migrations_delete();`,
  ]);
  assert.equal(triggerResult.status, 0, triggerResult.stderr || triggerResult.stdout);

  const downResult = run("npm", ["run", "migrate", "--", "down", "--database-url", databaseUrl], {
    cwd: dbRoot,
    env: { DATABASE_URL: databaseUrl },
  });

  assert.notEqual(downResult.status, 0);
  assert.match(downResult.stderr || downResult.stdout, /rejecting schema_migrations delete/);
  assert.equal(queryValue(containerName, "select count(*) from schema_migrations"), "2");
  assert.equal(
    queryValue(containerName, "select count(*) from pg_tables where schemaname = 'public' and tablename = 'issuer_aliases'"),
    "1",
  );
});

test("migrate down fails when any applied migration is missing locally", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for db migration integration coverage");
    return;
  }

  const containerName = createContainerName("fra-6al-7-2");
  const password = "postgres";
  const hostPort = startPostgres(containerName, password);
  const databaseUrl = `postgresql://postgres:${password}@127.0.0.1:${hostPort}/postgres`;

  t.after(() => {
    stopPostgres(containerName);
  });

  await waitForPostgres(containerName, databaseUrl);

  const upResult = run("npm", ["run", "migrate", "--", "up", "--database-url", databaseUrl], {
    cwd: dbRoot,
    env: { DATABASE_URL: databaseUrl },
  });
  assert.equal(upResult.status, 0, upResult.stderr || upResult.stdout);

  const insertMissingResult = run("docker", [
    "exec",
    containerName,
    "psql",
    "-U",
    "postgres",
    "-d",
    "postgres",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    "insert into schema_migrations(version, name) values ('0000', 'missing_local');",
  ]);
  assert.equal(insertMissingResult.status, 0, insertMissingResult.stderr || insertMissingResult.stdout);

  const downResult = run("npm", ["run", "migrate", "--", "down", "--database-url", databaseUrl], {
    cwd: dbRoot,
    env: { DATABASE_URL: databaseUrl },
  });

  assert.notEqual(downResult.status, 0);
  assert.match(downResult.stderr || downResult.stdout, /Applied migration 0000 is missing locally/);
  assert.equal(queryValue(containerName, "select count(*) from schema_migrations"), "3");
  assert.equal(queryValue(containerName, "select count(*) from pg_tables where schemaname = 'public' and tablename = 'users'"), "1");
});
