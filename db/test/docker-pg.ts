import { spawnSync } from "node:child_process";
import { join } from "node:path";
import assert from "node:assert/strict";

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
