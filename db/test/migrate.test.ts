import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import {
  connectedClient,
  createContainerName,
  dbRoot,
  dockerAvailable,
  queryValue,
  registerLifoCleanup,
  run,
  startPostgres,
  stopPostgres,
  waitForPostgres,
  workspaceRoot,
} from "./docker-pg.ts";

const schemaPath = join(workspaceRoot, "spec", "finance_research_db_schema.sql");
const initMigrationPath = join(dbRoot, "migrations", "0001_init.up.sql");
const snapshotManifestMigrationPath = join(dbRoot, "migrations", "0005_snapshot_document_refs.up.sql");

function loadExpectedTables() {
  return Array.from(
    readFileSync(schemaPath, "utf8").matchAll(/^create table ([a-z_][a-z0-9_]*) \($/gim),
    (match) => match[1],
  ).sort();
}

test("snapshot manifest forward migration owns post-baseline snapshot columns", () => {
  const initMigration = readFileSync(initMigrationPath, "utf8");
  const forwardMigration = readFileSync(snapshotManifestMigrationPath, "utf8");
  const schema = readFileSync(schemaPath, "utf8");

  for (const column of ["document_refs", "tool_call_result_hashes"]) {
    assert.doesNotMatch(initMigration, new RegExp(`\\b${column}\\b`));
    assert.match(forwardMigration, new RegExp(`\\b${column}\\b`));
    assert.match(schema, new RegExp(`\\b${column}\\b`));
  }
});

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
  assert.equal(queryValue(containerName, "select count(*) from schema_migrations"), "10");
  assert.deepEqual(
    queryValue(containerName, "select version || ':' || name from schema_migrations order by version").split("\n"),
    [
      "0001:init",
      "0002:issuer_aliases",
      "0003:default_manual_watchlist",
      "0004:agent_run_log",
      "0005:snapshot_document_refs",
      "0006:chat_messages_snapshot_not_null",
      "0007:documents_parent_idx",
      "0008:chat_threads_archived_at",
      "0009:theme_memberships_unique",
      "0010:analyze_template_runs",
    ],
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
  assert.match(statusResult.stdout, /0003\s+default_manual_watchlist\s+applied/);
  assert.match(statusResult.stdout, /0004\s+agent_run_log\s+applied/);
  assert.match(statusResult.stdout, /0005\s+snapshot_document_refs\s+applied/);
  assert.match(statusResult.stdout, /0006\s+chat_messages_snapshot_not_null\s+applied/);
  assert.match(statusResult.stdout, /0007\s+documents_parent_idx\s+applied/);
  assert.match(statusResult.stdout, /0008\s+chat_threads_archived_at\s+applied/);
  assert.match(statusResult.stdout, /0009\s+theme_memberships_unique\s+applied/);
  assert.match(statusResult.stdout, /0010\s+analyze_template_runs\s+applied/);
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

  assert.equal(queryValue(containerName, "select count(*) from schema_migrations"), "9");
  assert.equal(
    queryValue(containerName, "select count(*) from pg_tables where schemaname = 'public' and tablename = 'agent_run_logs'"),
    "1",
  );
  assert.equal(
    queryValue(containerName, "select count(*) from information_schema.columns where table_name = 'snapshots' and column_name in ('document_refs', 'tool_call_result_hashes')"),
    "2",
  );
  assert.equal(
    queryValue(containerName, "select count(*) from pg_indexes where schemaname = 'public' and indexname = 'watchlists_default_manual_per_user_idx'"),
    "1",
  );
  assert.equal(
    queryValue(containerName, "select count(*) from pg_tables where schemaname = 'public' and tablename = 'issuer_aliases'"),
    "1",
  );
  assert.equal(
    queryValue(
      containerName,
      "select count(*) from pg_indexes where schemaname = 'public' and indexname in ('documents_parent_idx', 'documents_conversation_idx')",
    ),
    "2",
  );
  assert.equal(
    queryValue(
      containerName,
      "select count(*) from information_schema.columns where table_name = 'chat_threads' and column_name = 'archived_at'",
    ),
    "1",
    "0008's archived_at column must remain — only 0010 should have been rolled back",
  );
  // 0009's effects must remain — only 0010 was rolled back.
  assert.equal(
    queryValue(
      containerName,
      "select count(*) from pg_constraint where conname = 'theme_memberships_theme_subject_unique'",
    ),
    "1",
    "0009's unique constraint must remain — only 0010 should have been rolled back",
  );
  // 0010-specific assertions: analyze_template_runs table and its index
  // must be gone after the rollback.
  assert.equal(
    queryValue(
      containerName,
      "select count(*) from pg_tables where schemaname = 'public' and tablename = 'analyze_template_runs'",
    ),
    "0",
    "analyze_template_runs table added by 0010.up must be removed by 0010.down",
  );
  assert.equal(
    queryValue(
      containerName,
      "select count(*) from pg_indexes where schemaname = 'public' and indexname = 'analyze_template_runs_template_created_idx'",
    ),
    "0",
    "analyze_template_runs index added by 0010.up must be removed by 0010.down",
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

  registerLifoCleanup(t, () => stopPostgres(containerName));

  await waitForPostgres(containerName, databaseUrl);

  const client = await connectedClient(t, databaseUrl);

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
    ["Alphabet Inc.", JSON.stringify(["Google", null, ""])],
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
  assert.equal(
    queryValue(containerName, "select count(*) from issuer_aliases where normalized_name = ''"),
    "0",
  );
});

test("migrate up keeps issuer aliases synchronized on issuer writes", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for db migration integration coverage");
    return;
  }

  const containerName = createContainerName("fra-6al-4-6");
  const password = "postgres";
  const hostPort = startPostgres(containerName, password);
  const databaseUrl = `postgresql://postgres:${password}@127.0.0.1:${hostPort}/postgres`;

  registerLifoCleanup(t, () => stopPostgres(containerName));

  await waitForPostgres(containerName, databaseUrl);

  const upResult = run("npm", ["run", "migrate", "--", "up", "--database-url", databaseUrl], {
    cwd: dbRoot,
    env: { DATABASE_URL: databaseUrl },
  });
  assert.equal(upResult.status, 0, upResult.stderr || upResult.stdout);

  const client = await connectedClient(t, databaseUrl);

  const issuer = await client.query<{ issuer_id: string }>(
    `insert into issuers (legal_name, former_names)
     values ($1, $2::jsonb)
     returning issuer_id`,
    ["Trigger Corp.", JSON.stringify(["Old Trigger", null, ""])],
  );
  const issuerId = issuer.rows[0].issuer_id;

  assert.equal(
    queryValue(containerName, `select count(*) from issuer_aliases where issuer_id = '${issuerId}' and normalized_name = 'trigger corp' and match_reason = 'legal_name'`),
    "1",
  );
  assert.equal(
    queryValue(containerName, `select count(*) from issuer_aliases where issuer_id = '${issuerId}' and normalized_name = 'old trigger' and match_reason = 'former_name'`),
    "1",
  );
  assert.equal(
    queryValue(containerName, `select count(*) from issuer_aliases where issuer_id = '${issuerId}' and normalized_name = ''`),
    "0",
  );

  await client.query(
    `update issuers
        set legal_name = $2,
            former_names = $3::jsonb
      where issuer_id = $1`,
    [issuerId, "Renamed Corp.", JSON.stringify(["Earlier Corp"])],
  );

  assert.equal(
    queryValue(containerName, `select count(*) from issuer_aliases where issuer_id = '${issuerId}' and normalized_name in ('trigger corp', 'old trigger')`),
    "0",
  );
  assert.equal(
    queryValue(containerName, `select count(*) from issuer_aliases where issuer_id = '${issuerId}' and normalized_name = 'renamed corp' and match_reason = 'legal_name'`),
    "1",
  );
  assert.equal(
    queryValue(containerName, `select count(*) from issuer_aliases where issuer_id = '${issuerId}' and normalized_name = 'earlier corp' and match_reason = 'former_name'`),
    "1",
  );
});

test("migrate up provisions the implicit default manual watchlist on user insert", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for db migration integration coverage");
    return;
  }

  const containerName = createContainerName("fra-6al-6-1");
  const password = "postgres";
  const hostPort = startPostgres(containerName, password);
  const databaseUrl = `postgresql://postgres:${password}@127.0.0.1:${hostPort}/postgres`;

  registerLifoCleanup(t, () => stopPostgres(containerName));

  await waitForPostgres(containerName, databaseUrl);

  const client = await connectedClient(t, databaseUrl);

  // Seed a user before migrations run so the backfill path is exercised alongside the trigger.
  await client.query(readFileSync(initMigrationPath, "utf8"));
  await client.query(`
    create table schema_migrations (
      version text primary key,
      name text not null,
      applied_at timestamptz not null default now()
    );
    insert into schema_migrations(version, name) values ('0001', 'init');
  `);
  const preMigrationUser = await client.query<{ user_id: string }>(
    `insert into users (email) values ($1) returning user_id`,
    ["pre-migration@example.test"],
  );
  const preMigrationUserId = preMigrationUser.rows[0].user_id;

  const upResult = run("npm", ["run", "migrate", "--", "up", "--database-url", databaseUrl], {
    cwd: dbRoot,
    env: { DATABASE_URL: databaseUrl },
  });
  assert.equal(upResult.status, 0, upResult.stderr || upResult.stdout);

  // Backfill: the existing user now has exactly one manual watchlist named 'Watchlist'.
  assert.equal(
    queryValue(containerName, `select count(*) from watchlists where user_id = '${preMigrationUserId}' and mode = 'manual' and name = 'Watchlist'`),
    "1",
  );

  // Trigger: inserting a fresh user auto-creates one manual watchlist.
  const postMigrationUser = await client.query<{ user_id: string }>(
    `insert into users (email) values ($1) returning user_id`,
    ["post-migration@example.test"],
  );
  const postMigrationUserId = postMigrationUser.rows[0].user_id;
  assert.equal(
    queryValue(containerName, `select count(*) from watchlists where user_id = '${postMigrationUserId}' and mode = 'manual'`),
    "1",
  );

  // Invariant: the unique partial index rejects a second manual watchlist for the same user.
  await assert.rejects(
    client.query(
      `insert into watchlists (user_id, name, mode) values ($1, $2, 'manual')`,
      [postMigrationUserId, "Second Manual"],
    ),
    /watchlists_default_manual_per_user_idx|duplicate key/i,
  );

  // Non-manual modes are not constrained by the partial index.
  await client.query(
    `insert into watchlists (user_id, name, mode) values ($1, $2, 'screen')`,
    [postMigrationUserId, "Screen Derivation"],
  );
  assert.equal(
    queryValue(containerName, `select count(*) from watchlists where user_id = '${postMigrationUserId}'`),
    "2",
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
  assert.equal(queryValue(containerName, "select count(*) from schema_migrations"), "10");
  assert.equal(
    queryValue(containerName, "select count(*) from pg_tables where schemaname = 'public' and tablename = 'agent_run_logs'"),
    "1",
  );
  // Positive proof that the rollback was actually rejected: the most-recent
  // migration's schema change must still be in place. If the runner
  // accidentally executed the down DDL before hitting the trigger block, the
  // schema_migrations row count alone wouldn't catch that — checking the
  // latest migration's actual artifact does. 0010 added analyze_template_runs;
  // the down would drop it, so its presence is independent proof the down
  // DDL did not execute.
  assert.equal(
    queryValue(
      containerName,
      "select count(*) from pg_tables where schemaname = 'public' and tablename = 'analyze_template_runs'",
    ),
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
  assert.equal(queryValue(containerName, "select count(*) from schema_migrations"), "11");
  assert.equal(queryValue(containerName, "select count(*) from pg_tables where schemaname = 'public' and tablename = 'users'"), "1");
});

test("migrate up applies 0009 cleanly even when legacy duplicate theme_memberships rows exist", { timeout: 120000 }, async (t) => {
  // Regression: the prior 0009 migration added the unique constraint
  // directly, which would hard-fail on any environment where the
  // race-induced duplicates the constraint is meant to prevent had
  // already happened. The migration now dedupes legacy duplicates
  // before adding the constraint; this test pins that behavior.
  if (!dockerAvailable()) {
    t.skip("Docker is required for db migration integration coverage");
    return;
  }

  const containerName = createContainerName("fra-6al-7-2");
  const password = "postgres";
  const hostPort = startPostgres(containerName, password);
  const databaseUrl = `postgresql://postgres:${password}@127.0.0.1:${hostPort}/postgres`;

  registerLifoCleanup(t, () => stopPostgres(containerName));

  await waitForPostgres(containerName, databaseUrl);

  // Apply through 0010, then roll back 0010 and 0009 so we land on
  // the schema as it existed before this migration (no unique
  // constraint on theme_memberships).
  const upResult = run("npm", ["run", "migrate", "--", "up", "--database-url", databaseUrl], {
    cwd: dbRoot,
    env: { DATABASE_URL: databaseUrl },
  });
  assert.equal(upResult.status, 0, upResult.stderr || upResult.stdout);
  for (let i = 0; i < 2; i++) {
    const downResult = run("npm", ["run", "migrate", "--", "down", "--database-url", databaseUrl], {
      cwd: dbRoot,
      env: { DATABASE_URL: databaseUrl },
    });
    assert.equal(downResult.status, 0, downResult.stderr || downResult.stdout);
  }
  assert.equal(
    queryValue(
      containerName,
      "select count(*) from pg_constraint where conname = 'theme_memberships_theme_subject_unique'",
    ),
    "0",
    "precondition: 0009's unique constraint must be absent before we seed duplicates",
  );

  // Seed two duplicate (theme_id, subject_kind, subject_id) rows.
  const client = await connectedClient(t, databaseUrl);
  const themeIns = await client.query<{ theme_id: string }>(
    `insert into themes (name, membership_mode, active_from)
     values ('dedupe-test', 'manual', now())
     returning theme_id::text as theme_id`,
  );
  const themeId = themeIns.rows[0].theme_id;
  const subjectId = "11111111-1111-4111-8111-111111111111";
  await client.query(
    `insert into theme_memberships (theme_id, subject_kind, subject_id, score)
     values ($1::uuid, 'issuer'::subject_kind, $2::uuid, 0.5),
            ($1::uuid, 'issuer'::subject_kind, $2::uuid, 0.7)`,
    [themeId, subjectId],
  );
  assert.equal(
    queryValue(
      containerName,
      `select count(*) from theme_memberships where theme_id = '${themeId}' and subject_kind = 'issuer' and subject_id = '${subjectId}'`,
    ),
    "2",
    "precondition: two duplicate rows must exist before re-applying 0009",
  );

  // Re-apply migrations. 0009's dedupe must collapse the duplicates
  // before the unique constraint is added; otherwise the alter table
  // hard-fails.
  const reupResult = run("npm", ["run", "migrate", "--", "up", "--database-url", databaseUrl], {
    cwd: dbRoot,
    env: { DATABASE_URL: databaseUrl },
  });
  assert.equal(reupResult.status, 0, reupResult.stderr || reupResult.stdout);
  assert.equal(
    queryValue(
      containerName,
      `select count(*) from theme_memberships where theme_id = '${themeId}' and subject_kind = 'issuer' and subject_id = '${subjectId}'`,
    ),
    "1",
    "0009 dedupe must collapse duplicates to a single row per (theme_id, subject_kind, subject_id)",
  );
  assert.equal(
    queryValue(
      containerName,
      "select count(*) from pg_constraint where conname = 'theme_memberships_theme_subject_unique'",
    ),
    "1",
    "0009 must successfully add the unique constraint after dedupe",
  );
});
