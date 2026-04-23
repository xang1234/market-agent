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
