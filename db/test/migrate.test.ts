import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
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

function loadExpectedTables() {
  return Array.from(
    readFileSync(schemaPath, "utf8").matchAll(/^create table ([a-z_][a-z0-9_]*) \($/gim),
    (match) => match[1],
  ).sort();
}

test("migrate up applies 0001_init and records it in schema_migrations", { timeout: 120000 }, async (t) => {
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

  await waitForPostgres(containerName);

  const migrateResult = run("npm", ["run", "migrate", "--", "up", "--database-url", databaseUrl], {
    cwd: dbRoot,
    env: { DATABASE_URL: databaseUrl },
  });

  assert.equal(migrateResult.status, 0, migrateResult.stderr || migrateResult.stdout);
  assert.equal(queryValue(containerName, "select count(*) from schema_migrations"), "1");
  assert.equal(
    queryValue(containerName, "select version || ':' || name from schema_migrations order by version"),
    "0001:init",
  );

  const publicTableCount = Number(queryValue(containerName, "select count(*) from pg_tables where schemaname = 'public'"));
  assert.ok(publicTableCount >= loadExpectedTables().length);
});

test("migrate status reports 0001_init as applied after migrate up", { timeout: 120000 }, async (t) => {
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

  await waitForPostgres(containerName);

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

  await waitForPostgres(containerName);

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

  assert.equal(queryValue(containerName, "select count(*) from schema_migrations"), "0");
  assert.equal(
    queryValue(containerName, "select count(*) from pg_tables where schemaname = 'public' and tablename <> 'schema_migrations'"),
    "0",
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

  await waitForPostgres(containerName);

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

  await waitForPostgres(containerName);

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
