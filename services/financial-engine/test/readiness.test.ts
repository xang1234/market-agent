import assert from "node:assert/strict";
import test from "node:test";
import { dockerAvailable } from "../../../db/test/docker-pg.ts";
import { FINANCIAL_PUBLICATION_SCHEMA_VERSION, FINANCIAL_VERIFIER_VERSION } from "../../snapshot/src/financial-verifier.ts";
import { checkFinancialReadiness, removedModeFlagWarnings, requireFinancialReadiness } from "../src/readiness.ts";
import { FINANCIAL_VERSION_REGISTRY, supportedPublication } from "../src/version-registry.ts";
import { engineDatabase } from "./db-fixtures.ts";

test("a removed mode flag that is still set gets one warning naming it", () => {
  const env = { CHAT_FINANCIAL_MODE: "off", GRID_FINANCIAL_MODE: "", THESIS_FINANCIAL_MODE: "enforce" };
  assert.deepEqual(removedModeFlagWarnings(env, ["CHAT_FINANCIAL_MODE", "ANALYZE_FINANCIAL_MODE", "GRID_FINANCIAL_MODE"]), [
    "CHAT_FINANCIAL_MODE is set but no longer read: the financial engine is always on",
    "GRID_FINANCIAL_MODE is set but no longer read: the financial engine is always on",
  ]);
  assert.deepEqual(removedModeFlagWarnings({}, ["CHAT_FINANCIAL_MODE", "ANALYZE_FINANCIAL_MODE", "GRID_FINANCIAL_MODE", "THESIS_FINANCIAL_MODE"]), []);
});

test("a publication presented as v1 or v2 is supported, and a presentation version never shipped is not", () => {
  const supported = (presentation_version: string) => supportedPublication({
    certificate_version: FINANCIAL_PUBLICATION_SCHEMA_VERSION, verifier_version: FINANCIAL_VERIFIER_VERSION, presentation_version, operation_version: null, numeric_policy_version: null,
  });
  assert.deepEqual(["financial-presentation.v1", "financial-presentation.v2", "financial-presentation.v3"].map(supported), [true, true, false]);
});

test("financial readiness", { skip: !dockerAvailable(), timeout: 300_000 }, async (t) => {
  const db = await engineDatabase(t, "financial-readiness");

  await t.test("a current schema and a registry covering this build are ready", async () => {
    assert.deepEqual(await checkFinancialReadiness(db), { ready: true, problems: [] });
    await requireFinancialReadiness(db, ["chat", "grid"]);
  });

  await t.test("a registry that does not cover what this build emits prevents startup", async () => {
    const registry = { ...FINANCIAL_VERSION_REGISTRY, catalog_versions: new Set<string>() };
    const readiness = await checkFinancialReadiness(db, registry);
    assert.equal(readiness.ready, false);
    assert.deepEqual(readiness.problems, ["versions: catalog.v1 is not in the reviewed registry"]);
    await assert.rejects(() => requireFinancialReadiness(db, ["analyze"], registry), /not ready for analyze: versions: catalog\.v1/u);
  });

  // Last: removes part of the schema.
  await t.test("a schema without the engine's pieces (here, the screener's tables, a run's grant and erasure) prevents startup", async () => {
    await db.query(`drop table screener_certified_valuations, screener_valuation_runs`);
    await db.query(`alter table financial_runs drop column allowed_source_classes cascade`);
    await db.query(`drop function erase_financial_runs_referencing() cascade`);
    const readiness = await checkFinancialReadiness(db);
    assert.deepEqual(readiness.problems, [
      "schema: relation screener_valuation_runs is missing",
      "schema: relation screener_certified_valuations is missing",
      "schema: column financial_runs.allowed_source_classes is missing",
      "schema: function erase_financial_runs_referencing is missing",
    ]);
    await assert.rejects(() => requireFinancialReadiness(db, ["chat"]), /not ready for chat: schema: relation screener_valuation_runs is missing; schema: relation screener_certified_valuations/u);
  });
});
