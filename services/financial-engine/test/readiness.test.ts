import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { dockerAvailable } from "../../../db/test/docker-pg.ts";
import type { SqlExecutor } from "../src/ports.ts";
import { checkFinancialReadiness, requireFinancialReadiness } from "../src/readiness.ts";
import { parseFinancialMode } from "../src/request.ts";
import { reserveRun } from "../src/run-repo.ts";
import { FINANCIAL_VERSION_REGISTRY } from "../src/version-registry.ts";
import { authorityFor, engineDatabase, marginPlan } from "./db-fixtures.ts";

test("a mode flag is off, shadow, or enforce; anything else stops startup instead of meaning legacy", () => {
  assert.equal(parseFinancialMode(undefined), "off");
  assert.equal(parseFinancialMode(""), "off");
  assert.equal(parseFinancialMode(" enforce "), "enforce");
  assert.equal(parseFinancialMode("shadow"), "shadow");
  for (const value of ["on", "true", "ENFORCE", "enforced"]) {
    assert.throws(() => parseFinancialMode(value, "CHAT_FINANCIAL_MODE"), /CHAT_FINANCIAL_MODE must be off, shadow, or enforce/u, value);
  }
});

test("with every surface off, readiness is never consulted", async () => {
  const untouched = { query: async () => assert.fail("no check runs while everything is off") } as unknown as SqlExecutor;
  await requireFinancialReadiness(untouched, { chat: "off", analyze: "off" });
});

test("financial readiness", { skip: !dockerAvailable(), timeout: 300_000 }, async (t) => {
  const db = await engineDatabase(t, "financial-readiness");

  await t.test("a current schema and a registry covering this build are ready", async () => {
    assert.deepEqual(await checkFinancialReadiness(db), { ready: true, problems: [] });
    await requireFinancialReadiness(db, { chat: "enforce", grid: "shadow" });
  });

  await t.test("a registry that does not cover what this build emits prevents enforcement", async () => {
    const registry = { ...FINANCIAL_VERSION_REGISTRY, catalog_versions: new Set<string>() };
    const readiness = await checkFinancialReadiness(db, registry);
    assert.equal(readiness.ready, false);
    assert.deepEqual(readiness.problems, ["versions: catalog.v1 is not in the reviewed registry"]);
    await assert.rejects(() => requireFinancialReadiness(db, { analyze: "enforce" }, registry), /not ready for analyze: versions: catalog\.v1/u);
  });

  await t.test("each run records the mode it ran under, so a later mode change never reinterprets it", async () => {
    for (const mode of ["shadow", "enforce"] as const) {
      const reserved = await reserveRun(db, { authority: authorityFor(undefined, { mode }), request_key: randomUUID(), plan: marginPlan() });
      assert.ok(reserved.status === "created");
      const stored = (await db.query(`select feature_mode from financial_runs where run_id = $1`, [reserved.run.run_id])).rows[0].feature_mode;
      assert.equal(stored, mode);
    }
  });

  // Last: removes part of the schema.
  await t.test("a schema without the engine's pieces (here, erasure) prevents enforcement", async () => {
    await db.query(`drop function erase_financial_runs_binding_evidence() cascade`);
    const readiness = await checkFinancialReadiness(db);
    assert.deepEqual(readiness.problems, ["schema: function erase_financial_runs_binding_evidence is missing"]);
    await assert.rejects(() => requireFinancialReadiness(db, { chat: "enforce", thesis: "off" }), /not ready for chat: schema: function/u);
  });
});
