import assert from "node:assert/strict";
import test from "node:test";
import { dockerAvailable } from "../../../db/test/docker-pg.ts";
import { IDS } from "../../financial-engine/test/db-fixtures.ts";
import { validateColumnSpecs } from "../src/column-catalog.ts";
import { isFinancialColumn, parseFinancialColumnParams } from "../src/financial-column.ts";
import { cellsByPosition, CUTOFF, gridDatabase, REVENUE_COLUMNS, settled, startRun, waitForRun } from "./financial-fixtures.ts";

test("numerical columns take a period relative to the run's cutoff; anything else in params is rejected", () => {
  assert.ok(isFinancialColumn("latest_revenue") && isFinancialColumn("latest_market_cap") && !isFinancialColumn("reader_question"));
  assert.deepEqual(parseFinancialColumnParams("latest_revenue", undefined), { period_type: "annual", offset: 0 });
  assert.deepEqual(parseFinancialColumnParams("latest_revenue", { period_type: "quarterly", offset: 3 }), { period_type: "quarterly", offset: 3 });
  for (const params of [{ offset: -1 }, { offset: 1.5 }, { offset: 20 }, { period_type: "monthly" }, { metric_key: "net_income" }, [1], "latest"]) {
    assert.throws(() => validateColumnSpecs([{ column_key: "latest_revenue", params }]), /latest_revenue/u, JSON.stringify(params));
  }
});

test("grid financial columns", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for grid financial column coverage");
    return;
  }
  const { db, pool } = await gridDatabase(t, "grid-fin-column");

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

  await t.test("the lane off keeps the legacy producers and certifies nothing", async () => {
    const { runId } = await startRun(pool, { mode: "off", asOf: CUTOFF, columns: [{ column_key: "latest_revenue" }] });
    const detail = await waitForRun(pool, runId, settled);
    assert.ok(detail.cells.every((cell) => cell.financial_block === null));
    assert.equal(detail.run.financial_mode, null);
    assert.equal((await db.query(`select count(*)::int as n from financial_runs where parent_id = $1`, [runId])).rows[0].n, 0);
  });
});
