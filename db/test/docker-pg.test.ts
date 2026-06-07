import test from "node:test";
import assert from "node:assert/strict";
import * as dockerPg from "./docker-pg.ts";

type Cleanup = () => void | Promise<void>;
type TestContextLike = {
  after(callback: Cleanup): void;
};

test("registerLifoCleanup runs later cleanups before earlier ones using a single test hook", async () => {
  const api = dockerPg as Record<string, unknown>;
  assert.equal(typeof api.registerLifoCleanup, "function");

  const registerLifoCleanup = api.registerLifoCleanup as (t: TestContextLike, cleanup: Cleanup) => void;
  const callbacks: Cleanup[] = [];
  const order: string[] = [];
  const t: TestContextLike = {
    after(callback) {
      callbacks.push(callback);
    },
  };

  registerLifoCleanup(t, () => {
    order.push("container");
  });
  registerLifoCleanup(t, () => {
    order.push("client");
  });

  assert.equal(callbacks.length, 1);

  for (const callback of callbacks) {
    await callback();
  }

  assert.deepEqual(order, ["client", "container"]);
});

test("applySchemaWithRetry retries transient startup failures before succeeding", async () => {
  const api = dockerPg as Record<string, unknown>;
  assert.equal(typeof api.applySchemaWithRetry, "function");

  const applySchemaWithRetry = api.applySchemaWithRetry as (
    databaseUrl: string,
    options: {
      runner: (
        command: string,
        args: string[],
        options?: { cwd?: string; env?: NodeJS.ProcessEnv },
      ) => { status: number | null; stdout: string; stderr: string };
      sleep: (ms: number) => Promise<void>;
      maxAttempts?: number;
      retryDelayMs?: number;
    },
  ) => Promise<void>;

  let calls = 0;
  const delays: number[] = [];
  await applySchemaWithRetry("postgresql://example", {
    runner: () => {
      calls += 1;
      if (calls < 3) {
        return {
          status: 1,
          stdout: "",
          stderr: "error: the database system is starting up",
        };
      }

      return { status: 0, stdout: "ok", stderr: "" };
    },
    sleep: async (ms) => {
      delays.push(ms);
    },
    maxAttempts: 4,
    retryDelayMs: 250,
  });

  assert.equal(calls, 3);
  assert.deepEqual(delays, [250, 250]);
});

test("applySchemaWithRetry does not retry non-startup failures", async () => {
  const api = dockerPg as Record<string, unknown>;
  assert.equal(typeof api.applySchemaWithRetry, "function");

  const applySchemaWithRetry = api.applySchemaWithRetry as (
    databaseUrl: string,
    options: {
      runner: (
        command: string,
        args: string[],
        options?: { cwd?: string; env?: NodeJS.ProcessEnv },
      ) => { status: number | null; stdout: string; stderr: string };
      sleep: (ms: number) => Promise<void>;
      maxAttempts?: number;
      retryDelayMs?: number;
    },
  ) => Promise<void>;

  let calls = 0;
  await assert.rejects(
    applySchemaWithRetry("postgresql://example", {
      runner: () => {
        calls += 1;
        return {
          status: 1,
          stdout: "",
          stderr: "error: relation \"missing_table\" does not exist",
        };
      },
      sleep: async () => {},
      maxAttempts: 4,
      retryDelayMs: 250,
    }),
    /missing_table/,
  );

  assert.equal(calls, 1);
});

// Timeout-hardening contract: a wedged daemon must surface as a clear, bounded
// error rather than a bare `null !== 0` assertion or an unbounded hang.
// (Mirrors services/evidence/test/docker-minio.ts; both collapse when the
// docker test harnesses are consolidated.)
test("interpretDockerResult throws a clear timeout error on an ETIMEDOUT result", () => {
  const api = dockerPg as Record<string, unknown>;
  const interpretDockerResult = api.interpretDockerResult as (
    result: { status: number | null; error?: Error; stdout?: string; stderr?: string },
    action: string,
    timeoutMs: number,
  ) => void;

  const result = {
    status: null,
    error: Object.assign(new Error("spawnSync docker ETIMEDOUT"), { code: "ETIMEDOUT" }),
  };
  assert.throws(
    () => interpretDockerResult(result, "run", 120_000),
    /docker run failed: timed out after 120000ms/,
  );
});

test("interpretDockerResult surfaces stderr on a non-zero exit and is a no-op on success", () => {
  const api = dockerPg as Record<string, unknown>;
  const interpretDockerResult = api.interpretDockerResult as (
    result: { status: number | null; error?: Error; stdout?: string; stderr?: string },
    action: string,
    timeoutMs: number,
  ) => void;

  assert.throws(
    () => interpretDockerResult({ status: 1, stderr: "boom", stdout: "" }, "port", 15_000),
    /boom/,
  );
  assert.doesNotThrow(() =>
    interpretDockerResult({ status: 0, stdout: "ok" }, "run", 120_000),
  );
});

test("waitForDatabaseConnection retries transient connection resets before succeeding", async () => {
  const api = dockerPg as Record<string, unknown>;
  assert.equal(typeof api.waitForDatabaseConnection, "function");

  const waitForDatabaseConnection = api.waitForDatabaseConnection as (
    databaseUrl: string,
    options: {
      probe: (databaseUrl: string) => Promise<void>;
      sleep: (ms: number) => Promise<void>;
      maxAttempts?: number;
      retryDelayMs?: number;
    },
  ) => Promise<void>;

  let calls = 0;
  const delays: number[] = [];
  await waitForDatabaseConnection("postgresql://example", {
    probe: async () => {
      calls += 1;
      if (calls < 3) {
        throw new Error("read ECONNRESET");
      }
    },
    sleep: async (ms) => {
      delays.push(ms);
    },
    maxAttempts: 4,
    retryDelayMs: 125,
  });

  assert.equal(calls, 3);
  assert.deepEqual(delays, [125, 125]);
});

test("waitForDatabaseConnection does not retry non-transient connection failures", async () => {
  const api = dockerPg as Record<string, unknown>;
  assert.equal(typeof api.waitForDatabaseConnection, "function");

  const waitForDatabaseConnection = api.waitForDatabaseConnection as (
    databaseUrl: string,
    options: {
      probe: (databaseUrl: string) => Promise<void>;
      sleep: (ms: number) => Promise<void>;
      maxAttempts?: number;
      retryDelayMs?: number;
    },
  ) => Promise<void>;

  let calls = 0;
  await assert.rejects(
    waitForDatabaseConnection("postgresql://example", {
      probe: async () => {
        calls += 1;
        throw new Error("password authentication failed for user postgres");
      },
      sleep: async () => {},
      maxAttempts: 4,
      retryDelayMs: 125,
    }),
    /password authentication failed/,
  );

  assert.equal(calls, 1);
});
