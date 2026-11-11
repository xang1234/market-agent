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
import { loadUnitBoundFacts, type FinancialSealClaim } from "../src/financial-verifier-loader.ts";
import { verifyFinancialSeal, type FinancialSealContext } from "../src/financial-verifier.ts";
import { buildFinancialSealInput } from "../src/seal-input.ts";
import { verifySnapshotSeal } from "../src/snapshot-verifier.ts";
import type { QueryExecutor } from "../../shared/src/http.ts";

const SNAPSHOT = "6f000000-0000-4000-8000-0000000000f2";
const AAPL = randomUUID();
const CASH = ["cash_and_equivalents", "marketable_securities_current", "marketable_securities_noncurrent", "short_term_investments", "debt_securities_current"];
const DEBT = ["long_term_debt_current", "long_term_debt_noncurrent", "commercial_paper", "short_term_borrowings"];

type PeriodSelector = Readonly<{ kind: "latest"; period_type: "annual"; offset: 0 } | { kind: "fiscal_period"; fiscal_year: number; fiscal_period: "FY" }>;
const LATEST: PeriodSelector = { kind: "latest", period_type: "annual", offset: 0 };

function aaplBalancePlan(period: PeriodSelector = LATEST, maxCandidates?: number): FinancialPlan {
  const validated = validateFinancialPlan({
    ...revenuePlan({ cutoff: "2026-11-09T23:59:59.999-05:00", maxCandidates }),
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
        period,
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

  const seal = async <T = Awaited<ReturnType<typeof verifyFinancialSeal>>>(
    evidence: (executor: SqlExecutor) => FinancialEvidencePort,
    plan = aaplBalancePlan(),
    sealDb: QueryExecutor = db,
    verify: (sealDb: QueryExecutor, claim: FinancialSealClaim, context: FinancialSealContext) => Promise<T> = verifyFinancialSeal as never,
  ) => {
    const { runId, lease } = await leasedRun(db, plan);
    const report = await executeRun({ client: db, lease, plan, authority: authorityFor(), evidence, parent_limits: {} });
    assert.equal(report.outcome, "ready_to_seal");
    const gaps = (await db.query<{ input_slot: string; gap_reason: string }>(
      `select input_slot, gap_reason from financial_run_inputs where run_id = $1 and binding_status = 'gap' order by input_slot`, [runId])).rows;
    const facts = await loadUnitBoundFacts(db, runId, "aapl");
    await db.query("begin");
    try {
      const outcome = await verify(sealDb, { owner_user_id: IDS.owner, run_id: runId, unit_id: "aapl" }, {
        snapshot_id: SNAPSHOT,
        manifest: { fact_refs: facts.map((fact) => fact.fact_id), source_ids: [...new Set(facts.map((fact) => fact.source_id))], as_of: new Date(plan.time.knowledge_cutoff).toISOString() },
      });
      return { gaps: gaps.map((gap) => `${gap.input_slot}:${gap.gap_reason}`), outcome };
    } finally {
      await db.query("rollback");
    }
  };

  /** Runs `body` with short-term borrowings, which AAPL's 10-K leaves out, stored for each period: a copy of its commercial paper fact. */
  const withBorrowings = async <T>(periods: ReadonlyArray<readonly [fiscalYear: number, fiscalPeriod: string, periodEnd: string]>, body: () => Promise<T>) => {
    const ids: string[] = [];
    try {
      for (const [fiscalYear, fiscalPeriod, periodEnd] of periods) {
        ids.push((await db.query<{ fact_id: string }>(
          `insert into facts (subject_kind, subject_id, metric_id, period_kind, period_start, period_end, fiscal_year, fiscal_period,
                              value_num, value_text, unit, currency, scale, as_of, reported_at, observed_at, source_id, method,
                              adjustment_basis, definition_version, verification_status, freshness_class, coverage_level,
                              quality_flags, entitlement_channels, confidence)
           select f.subject_kind, f.subject_id, (select metric_id from metrics where metric_key = 'short_term_borrowings'), f.period_kind,
                  ($1::date - interval '1 year' + interval '1 day')::date, $1::date, $2, $3, f.value_num, f.value_text, f.unit, f.currency, f.scale, f.as_of, f.reported_at,
                  f.observed_at, f.source_id, f.method, f.adjustment_basis, f.definition_version, f.verification_status,
                  f.freshness_class, f.coverage_level, f.quality_flags, f.entitlement_channels, f.confidence
             from facts f join metrics m on m.metric_id = f.metric_id
            where m.metric_key = 'commercial_paper' and f.subject_id = $4
           returning fact_id::text`, [periodEnd, fiscalYear, fiscalPeriod, AAPL])).rows[0]!.fact_id);
      }
      return await body();
    } finally {
      await db.query(`delete from facts where fact_id = any($1::uuid[])`, [ids]);
    }
  };
  const TOLERATED = ["debt_securities_current:missing_input", "short_term_borrowings:missing_input", "short_term_investments:missing_input"];

  await t.test("AAPL's 10-K reports no short-term borrowings, investments or current debt securities: those gaps verify", async () => {
    const { gaps, outcome } = await seal(createEvidenceFinancialPort);
    assert.deepEqual(gaps, TOLERATED);
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

  await t.test("short-term borrowings stored for FY2025 leave FY2026's gap proven", async () => {
    const { gaps, outcome } = await withBorrowings([[2025, "FY", "2025-09-27"]], () => seal(createEvidenceFinancialPort));
    assert.deepEqual(gaps, TOLERATED);
    assert.ok(outcome.ok, JSON.stringify(!outcome.ok && outcome.failures));
  });

  await t.test("short-term borrowings stored for FY2026 Q1 leave the FY2026 gap proven", async () => {
    const { gaps, outcome } = await withBorrowings([[2026, "Q1", "2025-12-27"]], () => seal(createEvidenceFinancialPort));
    assert.deepEqual(gaps, TOLERATED);
    assert.ok(outcome.ok, JSON.stringify(!outcome.ok && outcome.failures));
  });

  const FY2026: PeriodSelector = { kind: "fiscal_period", fiscal_year: 2026, fiscal_period: "FY" };

  await t.test("a plan that names FY2026 verifies the same gaps", async () => {
    const { gaps, outcome } = await seal(createEvidenceFinancialPort, aaplBalancePlan(FY2026));
    assert.deepEqual(gaps, TOLERATED);
    assert.ok(outcome.ok, JSON.stringify(!outcome.ok && outcome.failures));
  });

  await t.test("a plan that names FY2026 rejects a missing_input row for commercial paper the store holds", async () => {
    const { gaps, outcome } = await seal(blindTo("commercial_paper"), aaplBalancePlan(FY2026));
    assert.ok(gaps.includes("commercial_paper:missing_input"), JSON.stringify(gaps));
    assert.deepEqual(!outcome.ok && outcome.failures.map((failure) => [failure.reason_code, failure.details.input_slot, failure.details.field]), [
      ["financial_binding_mismatch", "commercial_paper", "gap_reason"],
    ]);
  });

  await t.test("a reread longer than the candidate limit leaves the gap unproven, though no candidate it saw is FY2026", async () => {
    // Binding spends one budget across the slots: the six balances the 10-K reports, plus one.
    const olderYears = Array.from({ length: 8 }, (_, index) => [2017 + index, "FY", `${2017 + index}-09-30`] as const);
    const { gaps, outcome } = await withBorrowings(olderYears, () => seal(blindTo("short_term_borrowings"), aaplBalancePlan(LATEST, 7)));
    assert.deepEqual(gaps, TOLERATED);
    assert.deepEqual(!outcome.ok && outcome.failures.map((failure) => [failure.reason_code, failure.details.input_slot, failure.details.field]), [
      ["financial_binding_mismatch", "short_term_borrowings", "gap_reason"],
    ]);
  });

  await t.test("the seal rereads only the gaps a sum in its unit leaves out", async () => {
    const base = aaplBalancePlan();
    const validated = validateFinancialPlan({
      ...base,
      operations: [...base.operations, { node_id: "borrowings_alone", operation: "reported_metric", operation_version: "reported_metric.v1", subject_slot: "aapl", metric_key: "short_term_borrowings", period: LATEST }],
      outputs: [...base.outputs, { output_id: "borrowings_alone", node_id: "borrowings_alone", unit_id: "other" }],
      publication_units: [...base.publication_units, { unit_id: "other", kind: "chat_section" }],
    });
    assert.ok(validated.ok, JSON.stringify(!validated.ok && validated.issues));
    let rereads = 0;
    const counting = {
      query: (text: string, values?: unknown[]) => {
        if (/order by f\.period_end nulls first/u.test(text)) rereads += 1;
        return db.query(text, values);
      },
    } as QueryExecutor;
    const { gaps, outcome } = await seal(createEvidenceFinancialPort, validated.value, counting);
    assert.deepEqual(gaps, ["borrowings_alone:missing_input", ...TOLERATED]);
    assert.ok(outcome.ok, JSON.stringify(!outcome.ok && outcome.failures));
    assert.equal(rereads, 3, "only net cash's and total debt's three gaps are reread");
  });

  /** `db`, with the gap reread's candidate query replaced by `replacement`. */
  const rereadFails = (replacement: () => Promise<never>): QueryExecutor => ({
    query: (text: string, values?: unknown[]) => /order by f\.period_end nulls first/u.test(text) ? replacement() : db.query(text, values),
  }) as QueryExecutor;

  await t.test("a reread the database fails leaves the seal unavailable, and its failure is logged", async () => {
    const divideByZero = rereadFails(() => db.query("select 1/0") as Promise<never>);
    const { gaps, outcome } = await seal(createEvidenceFinancialPort, aaplBalancePlan(), divideByZero, async (sealDb, claim, context) => {
      const verification = await verifySnapshotSeal(buildFinancialSealInput({
        snapshot_id: SNAPSHOT,
        claim,
        knowledgeCutoff: context.manifest.as_of,
        subjectRefs: [{ kind: "issuer", id: AAPL }],
        boundFacts: await loadUnitBoundFacts(db, claim.run_id, claim.unit_id),
        citedSources: [],
      }), sealDb);
      const logged = (await db.query<{ reason_code: string; reason: string }>(
        `select reason_code, details->>'reason' as reason from verifier_fail_logs where snapshot_id = $1`, [SNAPSHOT])).rows;
      return { verification, logged };
    });
    assert.deepEqual(gaps, TOLERATED);
    assert.deepEqual(outcome.verification.failures.map((failure) => [failure.reason_code, failure.details.reason, failure.details.error]), [
      ["financial_verification_unavailable", "gap_reread_failed", "division by zero"],
    ]);
    assert.deepEqual(outcome.logged, [{ reason_code: "financial_verification_unavailable", reason: "gap_reread_failed" }]);
  });

  await t.test("a reread that hits a programming error throws, not an unavailable seal", async () => {
    const broken = rereadFails(() => Promise.reject(new TypeError("rows is not iterable")));
    await assert.rejects(seal(createEvidenceFinancialPort, aaplBalancePlan(), broken), { name: "TypeError", message: "rows is not iterable" });
  });
});
