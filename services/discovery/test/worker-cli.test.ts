import assert from "node:assert/strict";
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
