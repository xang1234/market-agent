import assert from "node:assert/strict";
import test from "node:test";

import { runDiscoveryWorkerFromEnvironment } from "../../discovery/src/worker-cli.ts";
import { activeFinancialSurfaces, loadFinancialModes } from "../src/financial-env.ts";

const EVERY_FINANCE_FLAG = {
  CHAT_FINANCIAL_MODE: "enforce",
  ANALYZE_FINANCIAL_MODE: "enforce",
  GRID_FINANCIAL_MODE: "enforce",
  THESIS_FINANCIAL_MODE: "enforce",
  FINANCIAL_WORKER_ENABLED: "true",
};

test("every surface is off unless the server's environment says otherwise", () => {
  assert.deepEqual(loadFinancialModes({}), { analyze: "off", grid: "off", thesis: "off", worker: false });
  assert.deepEqual(activeFinancialSurfaces(loadFinancialModes({})), []);
  assert.deepEqual(loadFinancialModes(EVERY_FINANCE_FLAG), { analyze: "enforce", grid: "enforce", thesis: "enforce", worker: true });
  assert.deepEqual(activeFinancialSurfaces(loadFinancialModes(EVERY_FINANCE_FLAG)), ["analyze", "grid", "thesis", "worker"]);
  assert.equal(loadFinancialModes({ ANALYZE_FINANCIAL_MODE: "shadow" }).analyze, "shadow");
});

test("a malformed mode stops startup rather than falling back to legacy numbers", () => {
  assert.throws(() => loadFinancialModes({ ANALYZE_FINANCIAL_MODE: "on" }), /ANALYZE_FINANCIAL_MODE must be off, shadow, or enforce/u);
  assert.throws(() => loadFinancialModes({ THESIS_FINANCIAL_MODE: "shadow" }), /THESIS_FINANCIAL_MODE must be off or enforce/u);
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
