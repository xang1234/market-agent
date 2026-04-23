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
