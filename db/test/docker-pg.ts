import { spawnSync } from "node:child_process";
import { join } from "node:path";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { Client } from "pg";

export const workspaceRoot = join(import.meta.dirname, "..", "..");
export const dbRoot = join(workspaceRoot, "db");

export function run(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
) {
  return spawnSync(command, args, {
    cwd: options.cwd ?? workspaceRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      ...options.env,
    },
  });
}

export function dockerAvailable() {
  const result = run("docker", ["version", "--format", "{{.Server.Version}}"]);
  return result.status === 0;
}

export function createContainerName(prefix: string) {
  return `${prefix}-${process.pid}-${Date.now()}`;
}

export function lookupPublishedHostPort(containerName: string) {
  const result = run("docker", ["port", containerName, "5432/tcp"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const mapping = result.stdout.trim();
  const match = mapping.match(/:(\d+)$/);
  assert.ok(match, `expected docker port output to include a host port, got: ${mapping}`);
  return match[1];
}

export function startPostgres(containerName: string, password: string) {
  const result = run("docker", [
    "run",
    "--detach",
    "--rm",
    "--name",
    containerName,
    "-e",
    `POSTGRES_PASSWORD=${password}`,
    "-p",
    "127.0.0.1::5432",
    "postgres:15",
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  return lookupPublishedHostPort(containerName);
}

export function stopPostgres(containerName: string) {
  run("docker", ["rm", "--force", containerName]);
}

export async function waitForPostgres(containerName: string) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const result = run("docker", ["exec", containerName, "pg_isready", "-U", "postgres"]);
    if (result.status === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  assert.fail(`Timed out waiting for Postgres container ${containerName}`);
}

export function queryValue(containerName: string, sql: string) {
  const result = run("docker", [
    "exec",
    containerName,
    "psql",
    "-U",
    "postgres",
    "-d",
    "postgres",
    "-tAc",
    sql,
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

// Open a pg client against `databaseUrl`, wait for connect, and register
// teardown. Shared lifecycle for tests that bring their own DB interactions
// on top of bootstrapDatabase.
export async function connectedClient(t: TestContext, databaseUrl: string): Promise<Client> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  t.after(() => client.end());
  return client;
}

// Spin up a Postgres container, apply the normative schema via `npm run
// apply:schema` in the db/ package, and register teardown. Returns the
// container name and a connection URL; callers bring their own pg client.
export async function bootstrapDatabase(
  t: TestContext,
  prefix: string,
): Promise<{ containerName: string; databaseUrl: string }> {
  const containerName = createContainerName(prefix);
  const password = "postgres";
  const hostPort = startPostgres(containerName, password);
  const databaseUrl = `postgresql://postgres:${password}@127.0.0.1:${hostPort}/postgres`;

  t.after(() => stopPostgres(containerName));
  await waitForPostgres(containerName);

  const applyResult = run("npm", ["run", "apply:schema", "--", "--database-url", databaseUrl], {
    cwd: dbRoot,
    env: { DATABASE_URL: databaseUrl },
  });
  assert.equal(applyResult.status, 0, applyResult.stderr || applyResult.stdout);

  return { containerName, databaseUrl };
}
