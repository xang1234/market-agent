import assert from "node:assert/strict";
import test from "node:test";
import { dockerAvailable } from "../../../db/test/docker-pg.ts";
import { IDS, seedCashResilience } from "../../financial-engine/test/db-fixtures.ts";
import { validateColumnSpecs } from "../src/column-catalog.ts";
import { parseFinancialColumnParams } from "../src/financial-column.ts";
import { cellsByPosition, CUTOFF, gridDatabase, REVENUE_COLUMNS, settled, startRun, waitForRun } from "./financial-fixtures.ts";

test("numerical columns take a period relative to the run's cutoff; anything else in params is rejected", () => {
  assert.deepEqual(parseFinancialColumnParams("latest_revenue", undefined), { period_type: "annual", offset: 0 });
  assert.deepEqual(parseFinancialColumnParams("latest_revenue", { period_type: "quarterly", offset: 3 }), { period_type: "quarterly", offset: 3 });
  for (const params of [{ offset: -1 }, { offset: 1.5 }, { offset: 20 }, { period_type: "monthly" }, { metric_key: "net_income" }, [1], "latest"]) {
    assert.throws(() => validateColumnSpecs([{ column_key: "latest_revenue", params }]), /latest_revenue/u, JSON.stringify(params));
  }
});

const CASH_RESILIENCE_COLUMNS = [
  "latest_operating_cash_flow", "latest_net_income", "latest_total_liabilities", "latest_total_assets", "latest_total_equity",
  "latest_cash_conversion", "latest_liabilities_to_assets", "latest_liabilities_to_equity",
];

test("cash-resilience columns are annual only (#210)", () => {
  for (const column_key of CASH_RESILIENCE_COLUMNS) {
    assert.deepEqual(parseFinancialColumnParams(column_key, { offset: 1 }), { period_type: "annual", offset: 1 });
    assert.throws(() => validateColumnSpecs([{ column_key, params: { period_type: "quarterly" } }]), /annual only/u, column_key);
  }
});

test("grid financial columns", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for grid financial column coverage");
    return;
  }
  const { db, pool } = await gridDatabase(t, "grid-fin-column");
  await seedCashResilience(db);

  await t.test("each cell is its own certified unit; two instances of one column never share a result", async () => {
    const { runId } = await startRun(pool);
    const detail = await waitForRun(pool, runId, settled);
    const cells = cellsByPosition(detail);

    assert.deepEqual(detail.run.column_instances, [
      { column_instance_id: "c0", column_key: "latest_revenue", params: null, position: 0 },
      { column_instance_id: "c1", column_key: "latest_revenue", params: { period_type: "annual", offset: 1 }, position: 1 },
      { column_instance_id: "c2", column_key: "latest_market_cap", params: null, position: 2 },
    ]);
    const latest = cells["0:c0"]!;
    const prior = cells["0:c1"]!;
    for (const cell of [latest, prior]) {
      assert.equal(cell.status, "ok");
      assert.equal(cell.financial_block?.kind, "financial_answer");
      assert.equal((cell.financial_block as { snapshot_id: string }).snapshot_id, cell.snapshot_id);
    }
    assert.notEqual(latest.snapshot_id, prior.snapshot_id);
    const value = (cell: typeof latest) => (cell.financial_block as { financial: { results: Array<{ presented: { value?: string } }> } }).financial.results[0]!.presented.value;
    assert.equal(value(latest), "383285000000.123456789012345678", "FY2023 as reported, public by the cutoff");
    assert.equal(value(prior), "365817000000", "the prior year is a different result, not the same cell twice");

    for (const key of ["1:c0", "1:c1"]) {
      assert.equal(cells[key]!.status, "missing_data", "a company without eligible data is an explicit gap");
      assert.ok(cells[key]!.financial_block, "the gap is certified like a value");
    }
    for (const key of ["0:c2", "1:c2"]) {
      assert.deepEqual([cells[key]!.status, cells[key]!.coverage_flag, cells[key]!.snapshot_id], ["no_coverage", "market_cap_needs_price_share_timing_proof", null]);
    }
    assert.equal(detail.run.status, "partial", "gaps make the run partial, not only thrown errors");
    assert.deepEqual(detail.counts, { requested: 6, verified: 2, ok: 2, gap: 4, error: 0, pending: 0 });
    assert.equal(detail.run.cell_done, 6);
    const plans = (await db.query(`select count(*)::int as n from financial_runs where parent_kind = 'analyst_grid_run' and parent_id = $1`, [runId])).rows[0].n;
    assert.equal(plans, 1, "one plan fixes the cutoff for every cell");
  });

  await t.test("cash-resilience columns certify the five inputs and three ratios per row; a row without them is a gap (#210)", async () => {
    const { runId } = await startRun(pool, { columns: CASH_RESILIENCE_COLUMNS.map((column_key) => ({ column_key })) });
    const cells = cellsByPosition(await waitForRun(pool, runId, settled));
    const row = (index: number) => CASH_RESILIENCE_COLUMNS.map((_, column) => cells[`${index}:c${column}`]!);
    const presented = (cell: ReturnType<typeof row>[number]) => (cell.financial_block as { financial: { results: Array<{ presented: { value?: string } }> } }).financial.results[0]!.presented.value;
    assert.deepEqual(row(0).map((cell) => [cell.status, cell.display?.value, presented(cell)]), [
      ["ok", "USD 120.00", "120"], ["ok", "USD 100.00", "100"], ["ok", "USD 300.00", "300"], ["ok", "USD 600.00", "600"], ["ok", "USD 200.00", "200"],
      ["ok", "1.20x", "1.2"], ["ok", "0.50x", "0.5"], ["ok", "1.50x", "1.5"],
    ]);
    assert.deepEqual(row(1).map((cell) => cell.coverage_flag), [...Array(5).fill("missing_input"), ...Array(3).fill("blocked_by_dependency")]);
    assert.ok(row(0).every((cell) => cell.financial_block && cell.snapshot_id === (cell.financial_block as { snapshot_id: string }).snapshot_id), "each cell is sealed and reloadable");
  });

  await t.test("latest-period columns honor the pinned cutoff", async () => {
    const { runId } = await startRun(pool, { asOf: "2024-01-05T00:00:00.000Z", columns: [{ column_key: "latest_revenue" }] });
    const cells = cellsByPosition(await waitForRun(pool, runId, settled));
    assert.equal(cells["0:c0"]!.status, "missing_data", "no filing was public on the cutoff, so nothing is shown");
    assert.equal(cells["0:c0"]!.display?.value, "—");
  });

  await t.test("editing the grid while a run executes cannot change its columns or cohort", async () => {
    const { gridId, runId } = await startRun(pool);
    await db.query(
      `update research_grids set column_specs = $2::jsonb, universe_spec = $3::jsonb where grid_id = $1`,
      [gridId, JSON.stringify([{ column_key: "latest_eps_diluted" }]), JSON.stringify({ source: "manual", subject_refs: [{ kind: "issuer", id: IDS.issuerB }] })],
    );
    const detail = await waitForRun(pool, runId, settled);
    assert.deepEqual(detail.run.column_instances?.map((instance) => instance.column_key), ["latest_revenue", "latest_revenue", "latest_market_cap"]);
    assert.deepEqual(detail.rows.map((row) => row.subject_ref.id), [IDS.issuerA, IDS.issuerB]);
    assert.equal(detail.cells.length, 6);
    assert.ok(detail.cells.every((cell) => cell.column_key !== "latest_eps_diluted"));
  });

  await t.test("numerical cells publish before question cells, so recovery covers them while the reader runs", async () => {
    const reader = { llm: { complete: async () => assert.fail("no documents, so no model call") }, loadDocumentText: async () => null };
    const { runId } = await startRun(pool, { columns: [{ column_key: "reader_question", params: { prompt: "Any tariff exposure?" } }, { column_key: "latest_revenue" }], reader });
    const detail = await waitForRun(pool, runId, settled);
    assert.deepEqual([detail.run.status, detail.run.cell_done, detail.run.cell_total], ["partial", 4, 4]);
    const written = await db.query(`select column_key, status, coverage_flag from grid_cells where grid_run_id = $1 order by computed_at, column_key`, [runId]);
    assert.deepEqual(written.rows.map((cell) => [cell.column_key, cell.status, cell.coverage_flag]), [
      ["latest_revenue", "ok", null], ["latest_revenue", "missing_data", "missing_input"],
      ["reader_question", "no_coverage", "no_documents"], ["reader_question", "no_coverage", "no_documents"],
    ]);
  });

  await t.test("a run started in the deleted shadow mode reads as a run without the lane", async () => {
    const { runId } = await startRun(pool, { asOf: CUTOFF, columns: [{ column_key: "latest_revenue" }] });
    assert.equal((await waitForRun(pool, runId, settled)).run.financial_mode, "enforce");
    await db.query(`update grid_runs set financial_mode = 'shadow' where grid_run_id = $1`, [runId]);
    assert.equal((await waitForRun(pool, runId, settled)).run.financial_mode, null);
  });

  await t.test("an erased run leaves its cells as explicit gaps with no value, and deleting the grid run erases its runs", async () => {
    const { runId } = await startRun(pool, { columns: [{ column_key: "latest_revenue" }] });
    await waitForRun(pool, runId, settled);
    // What the deletion of evidence the run bound does (db/migrations/0051).
    await db.query(`delete from financial_runs where parent_kind = 'analyst_grid_run' and parent_id = $1`, [runId]);
    const cell = cellsByPosition(await waitForRun(pool, runId, settled))["0:c0"]!;
    assert.deepEqual(
      [cell.status, cell.coverage_flag, cell.display?.value, cell.snapshot_id, cell.financial_block],
      ["error", "financial_result_erased", "—", null, null],
    );

    const kept = await startRun(pool, { columns: [{ column_key: "latest_revenue" }] });
    await waitForRun(pool, kept.runId, settled);
    await db.query(`delete from grid_runs where grid_run_id = $1`, [kept.runId]);
    assert.equal((await db.query(`select count(*)::int as n from financial_runs where parent_id = $1`, [kept.runId])).rows[0].n, 0);
  });
});
