import { spawnSync } from "node:child_process";
import { join } from "node:path";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { Client } from "pg";

export const workspaceRoot = join(import.meta.dirname, "..", "..");
export const dbRoot = join(workspaceRoot, "db");
type Cleanup = () => void | Promise<void>;
type CommandResult = ReturnType<typeof run>;
type CommandRunner = typeof run;
type Sleep = (ms: number) => Promise<void>;
const cleanupStacks = new WeakMap<TestContext, Cleanup[]>();

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

function isStartupRace(result: CommandResult) {
  const combinedOutput = `${result.stderr}\n${result.stdout}`.toLowerCase();
  return combinedOutput.includes("the database system is starting up");
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

// node:test runs t.after() hooks in registration order, so shared helpers
// keep their own stack and drain it in reverse to close clients before
// stopping the backing Postgres container.
export function registerLifoCleanup(t: TestContext, cleanup: Cleanup) {
  let stack = cleanupStacks.get(t);
  if (!stack) {
    stack = [];
    cleanupStacks.set(t, stack);
    t.after(async () => {
      const callbacks = cleanupStacks.get(t) ?? [];
      cleanupStacks.delete(t);
      for (let index = callbacks.length - 1; index >= 0; index -= 1) {
        await callbacks[index]();
      }
    });
  }

  stack.push(cleanup);
}

export async function applySchemaWithRetry(
  databaseUrl: string,
  options: {
    runner?: CommandRunner;
    sleep?: Sleep;
    maxAttempts?: number;
    retryDelayMs?: number;
  } = {},
) {
  const runner = options.runner ?? run;
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const maxAttempts = options.maxAttempts ?? 5;
  const retryDelayMs = options.retryDelayMs ?? 1000;
  let lastResult: CommandResult | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const applyResult = runner("npm", ["run", "apply:schema", "--", "--database-url", databaseUrl], {
      cwd: dbRoot,
      env: { DATABASE_URL: databaseUrl },
    });
    if (applyResult.status === 0) return;

    lastResult = applyResult;
    if (attempt === maxAttempts || !isStartupRace(applyResult)) {
      break;
    }

    await sleep(retryDelayMs);
  }

  assert.notEqual(lastResult, null);
  assert.equal(lastResult.status, 0, lastResult.stderr || lastResult.stdout);
}

// Open a pg client against `databaseUrl`, wait for connect, and register
// teardown. Shared lifecycle for tests that bring their own DB interactions
// on top of bootstrapDatabase.
export async function connectedClient(t: TestContext, databaseUrl: string): Promise<Client> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  registerLifoCleanup(t, () => client.end());
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
  registerLifoCleanup(t, () => stopPostgres(containerName));
  const hostPort = startPostgres(containerName, password);
  const databaseUrl = `postgresql://postgres:${password}@127.0.0.1:${hostPort}/postgres`;

  await waitForPostgres(containerName);
  await applySchemaWithRetry(databaseUrl);

  return { containerName, databaseUrl };
}
