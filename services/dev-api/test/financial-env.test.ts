import assert from "node:assert/strict";
import test from "node:test";

import { runDiscoveryWorkerFromEnvironment } from "../../discovery/src/worker-cli.ts";
import { activeFinancialSurfaces, loadFinancialModes } from "../src/financial-env.ts";

const EVERY_FINANCE_FLAG = {
  CHAT_FINANCIAL_MODE: "enforce",
  ANALYZE_FINANCIAL_MODE: "enforce",
  FINANCIAL_WORKER_ENABLED: "true",
};

test("analyze is off and the recovery worker on unless the server's environment says otherwise; thesis always needs readiness", () => {
  assert.deepEqual(loadFinancialModes({}), { analyze: "off", worker: true });
  assert.deepEqual(activeFinancialSurfaces(loadFinancialModes({})), ["thesis", "worker"]);
  assert.deepEqual(loadFinancialModes({ FINANCIAL_WORKER_ENABLED: "false" }), { analyze: "off", worker: false });
  assert.deepEqual(activeFinancialSurfaces(loadFinancialModes({ FINANCIAL_WORKER_ENABLED: "false" })), ["thesis"]);
  assert.deepEqual(loadFinancialModes(EVERY_FINANCE_FLAG), { analyze: "enforce", worker: true });
  assert.deepEqual(activeFinancialSurfaces(loadFinancialModes(EVERY_FINANCE_FLAG)), ["analyze", "thesis", "worker"]);
});

test("a malformed mode stops startup rather than falling back to legacy numbers", () => {
  assert.throws(() => loadFinancialModes({ ANALYZE_FINANCIAL_MODE: "on" }), /ANALYZE_FINANCIAL_MODE must be off or enforce/u);
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
