import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const workspaceRoot = join(import.meta.dirname, "..", "..");
const dbRoot = join(workspaceRoot, "db");
const schemaPath = join(workspaceRoot, "spec", "finance_research_db_schema.sql");

function run(command: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd ?? workspaceRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      ...options.env,
    },
  });
}

function loadExpectedTables() {
  return Array.from(
    readFileSync(schemaPath, "utf8").matchAll(/^create table ([a-z_][a-z0-9_]*) \($/gim),
    (match) => match[1],
  ).sort();
}

function dockerAvailable() {
  const result = run("docker", ["version", "--format", "{{.Server.Version}}"]);
  return result.status === 0;
}

function createContainerName() {
  return `fra-6al-7-1-${process.pid}-${Date.now()}`;
}

function startPostgres(containerName: string, password: string, hostPort: string) {
  const result = run("docker", [
    "run",
    "--detach",
    "--rm",
    "--name",
    containerName,
    "-e",
    `POSTGRES_PASSWORD=${password}`,
    "-p",
    `${hostPort}:5432`,
    "postgres:15",
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
}

function stopPostgres(containerName: string) {
  run("docker", ["rm", "--force", containerName]);
}

async function waitForPostgres(containerName: string) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const result = run("docker", ["exec", containerName, "pg_isready", "-U", "postgres"]);
    if (result.status === 0) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  assert.fail(`Timed out waiting for Postgres container ${containerName}`);
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

  const containerName = createContainerName();
  const password = "postgres";
  const hostPort = "55432";
  const databaseUrl = `postgresql://postgres:${password}@127.0.0.1:${hostPort}/postgres`;

  startPostgres(containerName, password, hostPort);
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
