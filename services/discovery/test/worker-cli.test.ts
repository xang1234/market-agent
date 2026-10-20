import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runDiscoveryWorkerFromEnvironment } from "../src/worker-cli.ts";

test("worker CLI is inert while the discovery feature is disabled", async () => {
  await runDiscoveryWorkerFromEnvironment({ DISCOVERY_ENABLED: "false" });
});

test("worker CLI makes enabled-provider composition errors explicit", async () => {
  await assert.rejects(
    runDiscoveryWorkerFromEnvironment({ DISCOVERY_ENABLED: "true" }),
    /DISCOVERY_WORKER_MODULE is required/,
  );
});

test("worker CLI refuses a composition whose numerical criteria skip the financial engine", { timeout: 10_000 }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "discovery-worker-"));
  t.after(() => rm(dir, { recursive: true }));
  const modulePath = join(dir, "worker.mjs");
  await writeFile(modulePath, "export function createDiscoveryWorkerDeps() { return {}; }\n");
  await assert.rejects(
    runDiscoveryWorkerFromEnvironment({ DISCOVERY_ENABLED: "true", DISCOVERY_WORKER_MODULE: modulePath }),
    /createDiscoveryWorkerDeps\(\) must return deps with financialCriteria and financialReadiness/,
  );
});

test("worker CLI starts only once verified finance is ready", { timeout: 10_000 }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "discovery-worker-"));
  t.after(() => rm(dir, { recursive: true }));
  const modulePath = join(dir, "worker.mjs");
  await writeFile(modulePath, [
    "export function createDiscoveryWorkerDeps() {",
    "  return { financialCriteria: async () => new Map(), financialReadiness: async () => { throw new Error('verified finance is not ready for discovery'); } };",
    "}",
  ].join("\n"));
  await assert.rejects(
    runDiscoveryWorkerFromEnvironment({ DISCOVERY_ENABLED: "true", DISCOVERY_WORKER_MODULE: modulePath }),
    /verified finance is not ready for discovery/,
  );
});
