import { readFileSync } from "node:fs";
import { createServer } from "node:net";
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

async function findAvailableHostPort() {
  const server = createServer();

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  assert.ok(address && typeof address === "object", "expected a bound TCP address");
  const hostPort = String(address.port);

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });

  return hostPort;
}

async function reserveHostPort() {
  const hostPort = await findAvailableHostPort();
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
    `127.0.0.1:${hostPort}:5432`,
    "postgres:15",
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  return { containerName, hostPort };
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

  await waitForPostgres(containerName, databaseUrl);

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

  const { containerName: reservedContainer, hostPort: reservedPort } = await reserveHostPort();
  t.after(() => {
    stopPostgres(reservedContainer);
  });
  await waitForPostgres(reservedContainer);

  const containerName = createContainerName("fra-6al-7-1");
  const password = "postgres";
  const hostPort = startPostgres(containerName, password);
  const databaseUrl = `postgresql://postgres:${password}@127.0.0.1:${hostPort}/postgres`;

  assert.notEqual(hostPort, reservedPort);
  t.after(() => {
    stopPostgres(containerName);
  });

  await waitForPostgres(containerName, databaseUrl);

  const applyResult = run("npm", ["run", "apply:schema", "--", "--database-url", databaseUrl], {
    cwd: dbRoot,
    env: {
      DATABASE_URL: databaseUrl,
    },
  });

  assert.equal(applyResult.status, 0, applyResult.stderr || applyResult.stdout);
});
