import assert from "node:assert/strict";
import test from "node:test";

import { runDiscoveryWorkerFromEnvironment } from "../../discovery/src/worker-cli.ts";
import { activeFinancialSurfaces, loadFinancialModes } from "../src/financial-env.ts";

const EVERY_FINANCE_FLAG = {
  CHAT_FINANCIAL_MODE: "enforce",
  FINANCIAL_WORKER_ENABLED: "true",
};

test("analyze and thesis always need readiness; the recovery worker is on unless the server's environment says otherwise", () => {
  assert.deepEqual(loadFinancialModes({}), { worker: true });
  assert.deepEqual(activeFinancialSurfaces(loadFinancialModes({})), ["analyze", "thesis", "worker"]);
  assert.deepEqual(loadFinancialModes({ FINANCIAL_WORKER_ENABLED: "false" }), { worker: false });
  assert.deepEqual(activeFinancialSurfaces(loadFinancialModes({ FINANCIAL_WORKER_ENABLED: "false" })), ["analyze", "thesis"]);
  assert.deepEqual(loadFinancialModes(EVERY_FINANCE_FLAG), { worker: true });
  assert.deepEqual(activeFinancialSurfaces(loadFinancialModes(EVERY_FINANCE_FLAG)), ["analyze", "thesis", "worker"]);
});

test("a malformed worker flag stops startup", () => {
  assert.throws(() => loadFinancialModes({ FINANCIAL_WORKER_ENABLED: "1" }), /FINANCIAL_WORKER_ENABLED must be true or false/u);
});

test("enabling verified finance does not enable Discovery", async () => {
  // Without DISCOVERY_ENABLED the worker returns before loading any composition module.
  assert.equal(await runDiscoveryWorkerFromEnvironment({ ...EVERY_FINANCE_FLAG }), undefined);
  await assert.rejects(
    () => runDiscoveryWorkerFromEnvironment({ ...EVERY_FINANCE_FLAG, DISCOVERY_ENABLED: "true" }),
    /DISCOVERY_WORKER_MODULE is required/u,
    "only Discovery's own flag starts it",
  );
});
