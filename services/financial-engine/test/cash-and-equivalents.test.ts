import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { connectedPool, dockerAvailable } from "../../../db/test/docker-pg.ts";
import { validateFinancialPlan } from "../../financial-core/src/index.ts";
import { createSecBackedStatementRepository } from "../../fundamentals/src/sec-facts-repository.ts";
import { secCompanyFetcher } from "../../fundamentals/test/fakes.ts";
import { inspectCommittedResult } from "../src/inspection.ts";
import { completedRun, databaseUrl, engineDatabase, IDS, pinnedClients, revenuePlan } from "./db-fixtures.ts";

const USD = { kind: "currency", currency: "USD" };
const FILERS = [
  { slot: "cash", issuerId: randomUUID(), cik: 320193, balances: { Assets: "364980000000", CashAndCashEquivalentsAtCarryingValue: "29943000000" } },
  { slot: "none", issuerId: randomUUID(), cik: 320194, balances: { Assets: "600" } },
] as const;

function companyFacts(filer: (typeof FILERS)[number]) {
  const k24 = { accn: `0000${filer.cik}-25-000010`, fy: 2024, fp: "FY", form: "10-K", filed: "2025-02-01" };
  const concept = (token: string, start?: string) =>
    ({ label: "", description: "", units: { USD: [{ ...(start === undefined ? {} : { start }), end: "2024-12-31", val: Number(token), val_token: token, ...k24 }] } });
  const balances = Object.entries(filer.balances).map(([name, token]) => [name, concept(token)]);
  return {
    cik: filer.cik,
    entityName: `Filer ${filer.cik}`,
    facts: { "us-gaap": { Revenues: concept("500", "2024-01-01"), ...Object.fromEntries(balances) } },
  };
}

function cashPlan() {
  const base = revenuePlan({ cutoff: "2025-07-01T23:59:59.999-04:00" });
  const validated = validateFinancialPlan({
    ...base,
    subjects: {
      membership: "explicit",
      requested_count: FILERS.length,
      resolved_count: FILERS.length,
      omitted_count: 0,
      members: FILERS.map((filer, index) => ({ slot_id: filer.slot, subject_ref: { kind: "issuer", id: filer.issuerId }, display_order: index, role: index === 0 ? "primary" : "peer" })),
    },
    metric_definitions: [
      { metric_key: "cash_and_equivalents", definition_version: "cash_and_equivalents.v1" },
      { metric_key: "total_assets", definition_version: "total_assets.v1" },
    ],
    operations: FILERS.flatMap((filer) => [[filer.slot, "cash_and_equivalents"], [`${filer.slot}_assets`, "total_assets"]].map(([nodeId, metricKey]) => ({
      node_id: nodeId,
      operation: "reported_metric",
      operation_version: "reported_metric.v1",
      subject_slot: filer.slot,
      metric_key: metricKey,
      period: { kind: "fiscal_period", fiscal_year: 2024, fiscal_period: "FY" },
    }))),
    outputs: FILERS.flatMap((filer) => [filer.slot, `${filer.slot}_assets`].map((nodeId) => ({ output_id: nodeId, node_id: nodeId, unit_id: filer.slot }))),
    publication_units: FILERS.map((filer) => ({ unit_id: filer.slot, kind: "chat_section" })),
  });
  assert.ok(validated.ok, JSON.stringify(!validated.ok && validated.issues));
  return validated.value;
}

test("cash and equivalents certifies from a 10-K that tags it, and is a missing_input gap from a 10-K that does not", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for engine coverage");
    return;
  }
  const db = await engineDatabase(t, "fin-cash");
  const pool = await connectedPool(t, databaseUrl(db));
  for (const metricKey of ["total_assets", "cash_and_equivalents"]) {
    await db.query(
      `insert into metrics (metric_id, metric_key, display_name, unit_class, aggregation, interpretation, canonical_source_class)
       values ($1, $2, $2, 'currency', 'point_in_time', 'neutral', 'gaap')`,
      [randomUUID(), metricKey],
    );
  }
  for (const filer of FILERS) {
    await db.query(`insert into issuers (issuer_id, legal_name, cik) values ($1, $2, $3)`, [filer.issuerId, `Filer ${filer.cik}`, String(filer.cik)]);
    const statements = createSecBackedStatementRepository(pool, {
      fetcher: secCompanyFetcher(() => companyFacts(filer), { completed_at: "2025-06-01T15:05:00.000Z" }),
      sourceId: randomUUID(),
      logger: { warn: () => {} },
    });
    assert.ok(await statements.find({ issuer_id: filer.issuerId, family: "income", basis: "as_reported", fiscal_year: 2024, fiscal_period: "FY" }));
  }

  const [client] = await pinnedClients(t, db, 1);
  const { results } = await completedRun(db, client!, cashPlan());
  const inspect = async (outputId: string) => (await inspectCommittedResult(db, IDS.owner, results[outputId]!))!;

  const cash = await inspect("cash");
  assert.ok(cash.availability === "available");
  assert.deepEqual([cash.disposition, cash.payload, cash.coverage_state], ["verified", { kind: "value", unit: USD, exact: true, value: "29943000000", rounding: null }, "complete"]);
  assert.deepEqual(cash.definitions, [{ metric_key: "cash_and_equivalents", definition_version: "cash_and_equivalents.v1" }]);
  const [input] = cash.inputs;
  assert.ok(input?.status === "bound");
  assert.deepEqual(
    [input.value, input.unit, input.period, input.precision_status, input.publication.available_no_later_than, input.source.locator],
    [
      "29943000000",
      USD,
      { kind: "instant", start: null, end: "2024-12-31", fiscal_year: 2024, fiscal_period: "FY" },
      "source_token_preserved",
      "2025-06-01T15:05:00.000Z",
      "sec_edgar:companyfacts:CIK0000320193#CashAndCashEquivalentsAtCarryingValue|USD|0000320193-25-000010|..2024-12-31",
    ],
  );

  for (const [outputId, value] of [["cash_assets", "364980000000"], ["none_assets", "600"]]) {
    const assets = await inspect(outputId!);
    assert.ok(assets.availability === "available");
    assert.deepEqual([assets.disposition, assets.payload], ["verified", { kind: "value", unit: USD, exact: true, value, rounding: null }], `${outputId}: both balance sheets certify`);
  }

  const none = await inspect("none");
  assert.ok(none.availability === "available");
  assert.deepEqual([none.disposition, none.payload, none.coverage_state], ["missing", { kind: "gap", explanation: "No eligible input was public before the knowledge cutoff.", reason_code: "missing_input" }, "partial"]);
  assert.deepEqual(none.inputs, [{ input_slot: "none", status: "gap", reason_code: "missing_input" }]);
});
