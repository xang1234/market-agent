// Net cash and total debt leave out a balance the 10-K does not report
// (#602), so a missing_input gap row changes a certified sum. The seal must
// prove each such gap from the evidence store, not take the row's word (#607).

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { connectedPool, dockerAvailable, workspaceRoot } from "../../../db/test/docker-pg.ts";
import { validateFinancialPlan, type FinancialPlan } from "../../financial-core/src/index.ts";
import { createEvidenceFinancialPort } from "../../financial-engine/src/evidence-adapter.ts";
import { executeRun } from "../../financial-engine/src/execute.ts";
import type { FinancialEvidencePort, SqlExecutor } from "../../financial-engine/src/ports.ts";
import { authorityFor, engineDatabase, databaseUrl, IDS, leasedRun, revenuePlan } from "../../financial-engine/test/db-fixtures.ts";
import { createSecBackedStatementRepository } from "../../fundamentals/src/sec-facts-repository.ts";
import { secCompanyFetcher } from "../../fundamentals/test/fakes.ts";
import { aaplWithCash } from "../../fundamentals/test/sec-call-inputs-fixture.ts";
import { loadUnitBoundFacts } from "../src/financial-verifier-loader.ts";
import { verifyFinancialSeal } from "../src/financial-verifier.ts";

const SNAPSHOT = "6f000000-0000-4000-8000-0000000000f2";
const AAPL = randomUUID();
const CASH = ["cash_and_equivalents", "marketable_securities_current", "marketable_securities_noncurrent", "short_term_investments", "debt_securities_current"];
const DEBT = ["long_term_debt_current", "long_term_debt_noncurrent", "commercial_paper", "short_term_borrowings"];

function aaplBalancePlan(): FinancialPlan {
  const validated = validateFinancialPlan({
    ...revenuePlan({ cutoff: "2026-11-09T23:59:59.999-05:00" }),
    subjects: {
      membership: "explicit",
      requested_count: 1,
      resolved_count: 1,
      omitted_count: 0,
      members: [{ slot_id: "aapl", subject_ref: { kind: "issuer", id: AAPL }, display_order: 0, role: "primary" }],
    },
    metric_definitions: [...CASH, ...DEBT].map((key) => ({ metric_key: key, definition_version: `${key}.v1` })),
    operations: [
      ...[...CASH, ...DEBT].map((key) => ({
        node_id: key, operation: "reported_metric", operation_version: "reported_metric.v1", subject_slot: "aapl", metric_key: key,
        period: { kind: "latest", period_type: "annual", offset: 0 },
      })),
      { node_id: "net_cash", operation: "net_cash", operation_version: "net_cash.v1", ...Object.fromEntries([...CASH, ...DEBT].map((key) => [key, key])) },
      { node_id: "total_debt", operation: "total_debt", operation_version: "total_debt.v1", ...Object.fromEntries(DEBT.map((key) => [key, key])) },
    ],
    outputs: ["net_cash", "total_debt"].map((figure) => ({ output_id: figure, node_id: figure, unit_id: "aapl" })),
    publication_units: [{ unit_id: "aapl", kind: "chat_section" }],
  });
  assert.ok(validated.ok, JSON.stringify(!validated.ok && validated.issues));
  return validated.value;
}

/** The engine's evidence port, blind to `hidden`: its binder records a missing_input gap for a balance the store holds. */
function blindTo(hidden: string) {
  return (executor: SqlExecutor): FinancialEvidencePort => {
    const port = createEvidenceFinancialPort(executor);
    return {
      ...port,
      listInputCandidates: async (request) =>
        request.metric_key === hidden ? { status: "ok", candidates: [], truncated: false } : port.listInputCandidates(request),
    };
  };
}

test("a missing_input gap a sum leaves out is proven at the seal", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for financial verifier coverage");
    return;
  }
  const db = await engineDatabase(t, "snap-fin-gaps");
  const pool = await connectedPool(t, databaseUrl(db));
  await db.query(await readFile(join(workspaceRoot, "db", "seed", "metrics.sql"), "utf8"));
  await db.query(`insert into issuers (issuer_id, legal_name, cik) values ($1, 'Apple Inc.', '320193')`, [AAPL]);
  const statements = createSecBackedStatementRepository(pool, {
    fetcher: secCompanyFetcher(() => aaplWithCash(), { completed_at: "2026-11-09T15:00:00.000Z" }),
    sourceId: randomUUID(),
    logger: { warn: () => {} },
  });
  assert.ok(await statements.find({ issuer_id: AAPL, family: "income", basis: "as_reported", fiscal_year: 2026, fiscal_period: "FY" }));

  const plan = aaplBalancePlan();
  const seal = async (evidence: (executor: SqlExecutor) => FinancialEvidencePort) => {
    const { runId, lease } = await leasedRun(db, plan);
    const report = await executeRun({ client: db, lease, plan, authority: authorityFor(), evidence, parent_limits: {} });
    assert.equal(report.outcome, "ready_to_seal");
    const gaps = (await db.query<{ input_slot: string; gap_reason: string }>(
      `select input_slot, gap_reason from financial_run_inputs where run_id = $1 and binding_status = 'gap' order by input_slot`, [runId])).rows;
    const facts = await loadUnitBoundFacts(db, runId, "aapl");
    await db.query("begin");
    try {
      const outcome = await verifyFinancialSeal(db, { owner_user_id: IDS.owner, run_id: runId, unit_id: "aapl" }, {
        snapshot_id: SNAPSHOT,
        manifest: { fact_refs: facts.map((fact) => fact.fact_id), source_ids: [...new Set(facts.map((fact) => fact.source_id))], as_of: new Date(plan.time.knowledge_cutoff).toISOString() },
      });
      return { gaps: gaps.map((gap) => `${gap.input_slot}:${gap.gap_reason}`), outcome };
    } finally {
      await db.query("rollback");
    }
  };

  await t.test("AAPL's 10-K reports no short-term borrowings, investments or current debt securities: those gaps verify", async () => {
    const { gaps, outcome } = await seal(createEvidenceFinancialPort);
    assert.deepEqual(gaps, ["debt_securities_current:missing_input", "short_term_borrowings:missing_input", "short_term_investments:missing_input"]);
    assert.ok(outcome.ok, JSON.stringify(!outcome.ok && outcome.failures));
  });

  await t.test("a missing_input row for commercial paper the store holds is rejected, so net cash cannot overstate by 1.997B", async () => {
    const { gaps, outcome } = await seal(blindTo("commercial_paper"));
    assert.ok(gaps.includes("commercial_paper:missing_input"), JSON.stringify(gaps));
    assert.equal(outcome.ok, false, "the seal certified net cash without AAPL's commercial paper");
    assert.deepEqual(!outcome.ok && outcome.failures.map((failure) => [failure.reason_code, failure.details.input_slot, failure.details.field]), [
      ["financial_binding_mismatch", "commercial_paper", "gap_reason"],
    ]);
  });
});
