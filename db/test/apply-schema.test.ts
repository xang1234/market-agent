import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import {
  createContainerName,
  dbRoot,
  dockerAvailable,
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

function reserveHostPort(hostPort: string) {
  const containerName = `fra-6al-7-1-reserved-${process.pid}-${Date.now()}`;
  const result = run("docker", [
    "run",
    "--detach",
    "--rm",
    "--name",
    containerName,
    "-e",
    "POSTGRES_PASSWORD=postgres",
    "-p",
    `${hostPort}:5432`,
    "postgres:15",
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  return containerName;
}

function listTables(containerName: string) {
  const result = run("docker", [
    "exec",
    containerName,
    "psql",
    "-U",
    "postgres",
    "-d",
    "postgres",
    "-c",
    "\\dt",
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}

test("apply:schema loads the normative schema into a fresh Postgres 15 database", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for db/apply-schema integration coverage");
    return;
  }

  const containerName = createContainerName("fra-6al-7-1");
  const password = "postgres";
  const hostPort = startPostgres(containerName, password);
  const databaseUrl = `postgresql://postgres:${password}@127.0.0.1:${hostPort}/postgres`;

  t.after(() => {
    stopPostgres(containerName);
  });

  await waitForPostgres(containerName);

  const applyResult = run("npm", ["run", "apply:schema", "--", "--database-url", databaseUrl], {
    cwd: dbRoot,
    env: {
      DATABASE_URL: databaseUrl,
    },
  });

  assert.equal(applyResult.status, 0, applyResult.stderr || applyResult.stdout);

  const verifyResult = run("npm", ["run", "verify:schema", "--", "--database-url", databaseUrl], {
    cwd: dbRoot,
    env: {
      DATABASE_URL: databaseUrl,
    },
  });

  assert.equal(verifyResult.status, 0, verifyResult.stderr || verifyResult.stdout);

  const dtOutput = listTables(containerName);
  const expectedTables = loadExpectedTables();

  for (const tableName of expectedTables) {
    assert.match(dtOutput, new RegExp(`\\b${tableName}\\b`), `expected \\dt output to include ${tableName}`);
  }
});

test("apply:schema still works when the default host port is already occupied", { timeout: 120000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for db/apply-schema integration coverage");
    return;
  }

  const reservedContainer = reserveHostPort("55432");
  t.after(() => {
    stopPostgres(reservedContainer);
  });
  await waitForPostgres(reservedContainer);

  const containerName = createContainerName("fra-6al-7-1");
  const password = "postgres";
  const hostPort = startPostgres(containerName, password);
  const databaseUrl = `postgresql://postgres:${password}@127.0.0.1:${hostPort}/postgres`;

  assert.notEqual(hostPort, "55432");
  t.after(() => {
    stopPostgres(containerName);
  });

  await waitForPostgres(containerName);

  const applyResult = run("npm", ["run", "apply:schema", "--", "--database-url", databaseUrl], {
    cwd: dbRoot,
    env: {
      DATABASE_URL: databaseUrl,
    },
  });

  assert.equal(applyResult.status, 0, applyResult.stderr || applyResult.stdout);
});
