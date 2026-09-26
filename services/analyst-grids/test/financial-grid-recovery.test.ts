// A grid cell's snapshot, certificate, cell write, and progress count commit
// together. After a failure part-way through, the committed cells stay, the
// rest stay pending, and the recovery worker (or a retry) finishes them
// without recomputing or counting any cell twice.

import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import { dockerAvailable } from "../../../db/test/docker-pg.ts";
import { createEvidenceFinancialPort } from "../../financial-engine/src/evidence-adapter.ts";
import { listRecoverableRuns, recoverRun } from "../../financial-engine/src/recovery.ts";
import { requestCancellation } from "../../financial-engine/src/run-repo.ts";
import { IDS } from "../../financial-engine/test/db-fixtures.ts";
import { snapshotTransactionClient } from "../../snapshot/src/snapshot-sealer.ts";
import { gridFinancialRecovery, publishGridFinancialCells } from "../src/financial-column.ts";
import { getRunDetail, type GridRunDetail } from "../src/queries.ts";
import type { QueryExecutor } from "../src/types.ts";
import { cellsByPosition, CUTOFF, gridDatabase, settled, startRun, waitForRun } from "./financial-fixtures.ts";

test("grid financial recovery", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for grid recovery coverage");
    return;
  }
  const { db, pool } = await gridDatabase(t, "grid-fin-recovery");
  /** Fails the certified write of row 0's second column, after its snapshot and certificate were staged. */
  const failCell = () => db.query(`
    create function fail_grid_cell() returns trigger language plpgsql as $$
    begin
      if new.financial_run_id is not null and new.column_instance_id = 'c1'
         and (select row_number from grid_rows where grid_row_id = new.grid_row_id) = 0 then
        raise exception 'cell store unavailable';
      end if;
      return new;
    end $$;
    create trigger fail_grid_cell before update on grid_cells for each row execute function fail_grid_cell();`);
  const restore = () => db.query(`drop trigger fail_grid_cell on grid_cells; drop function fail_grid_cell();`);
  const financialRun = async (gridRunId: string) =>
    (await db.query(`select run_id::text, lease_expires_at <= now() as released from financial_runs where parent_id = $1`, [gridRunId])).rows[0] as { run_id: string; released: boolean } | undefined;
  const certificates = async (gridRunId: string) =>
    Number((await db.query(`select count(*)::int as n from snapshot_financial_runs c join financial_runs r on r.run_id = c.run_id where r.parent_id = $1`, [gridRunId])).rows[0].n);
  const computations = async (gridRunId: string) =>
    Number((await db.query(`select count(*)::int as n from computations c join financial_runs r on r.run_id = c.financial_run_id where r.parent_id = $1`, [gridRunId])).rows[0].n);

  /** Starts a run whose finalization fails at row 0 / c1, and waits until the worker has let go of it. */
  async function interruptedRun(): Promise<{ runId: string; detail: GridRunDetail }> {
    await failCell();
    try {
      const { runId } = await startRun(pool);
      await waitForRun(pool, runId, (detail) => detail.run.cell_done >= 4);
      for (;;) {
        const run = await financialRun(runId);
        if (run?.released) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      return { runId, detail: await getRunDetail(pool as unknown as QueryExecutor, runId) };
    } finally {
      await restore();
    }
  }

  async function recover(runId: string) {
    const [run] = (await listRecoverableRuns(db, { parent_kinds: ["analyst_grid_run"], limit: 50 })).filter((candidate) => candidate.parent_id === runId);
    assert.ok(run, "the interrupted run is recoverable");
    const client = snapshotTransactionClient(await (pool as Pool).connect());
    try {
      return await recoverRun(client, run, {
        worker_id: "grid-recovery-test",
        ttl_ms: 60_000,
        evidence: createEvidenceFinancialPort,
        parents: { analyst_grid_run: gridFinancialRecovery(pool) },
      });
    } finally {
      client.release();
    }
  }

  const retry = (runId: string, detail: GridRunDetail) =>
    publishGridFinancialCells({ mode: "enforce", pool, evidence: createEvidenceFinancialPort }, {
      user_id: IDS.owner,
      grid_run_id: runId,
      knowledge_cutoff: CUTOFF,
      mode: "enforce",
      rows: detail.rows.map((row) => ({ rowNumber: row.row_number, subject: row.subject_ref })),
      instances: detail.run.column_instances!,
    });

  await t.test("committed cells stay; the rest stay pending and the run is not settled", async () => {
    const { runId, detail } = await interruptedRun();
    const cells = cellsByPosition(detail);
    assert.equal(detail.run.status, "running");
    assert.equal(detail.run.cell_done, 4, "two certified cells and two unsupported cells");
    assert.deepEqual(["0:c0", "1:c0", "0:c1", "1:c1"].map((key) => cells[key]!.status), ["ok", "missing_data", "pending", "pending"]);
    assert.equal(await certificates(runId), 2, "the failed cell left no certificate");
  });

  await t.test("the recovery worker finishes the run without recomputing or double counting", async () => {
    const { runId } = await interruptedRun();
    const computed = await computations(runId);
    const outcome = await recover(runId);
    assert.deepEqual([outcome.status, outcome.status === "resumed" && outcome.execution, outcome.status === "resumed" && outcome.published], ["resumed", "skipped", 2]);
    const detail = await waitForRun(pool, runId, settled);
    assert.equal(detail.run.status, "partial");
    assert.equal(detail.run.cell_done, 6);
    assert.deepEqual(detail.counts, { requested: 6, verified: 2, ok: 2, gap: 4, error: 0, pending: 0 });
    assert.equal(await certificates(runId), 4);
    assert.equal(await computations(runId), computed, "no calculation ran twice");
  });

  await t.test("a retry in the same process is idempotent too", async () => {
    const { runId, detail } = await interruptedRun();
    assert.equal(await retry(runId, detail), "published");
    assert.equal(await retry(runId, detail), "published");
    const done = await getRunDetail(pool as unknown as QueryExecutor, runId);
    assert.deepEqual([done.run.status, done.run.cell_done, await certificates(runId)], ["partial", 6, 4]);
  });

  await t.test("a cancelled calculation writes its unpublished cells as declared gaps", async () => {
    const { runId, detail } = await interruptedRun();
    await requestCancellation(db, IDS.owner, (await financialRun(runId))!.run_id);
    assert.equal(await retry(runId, detail), "run_cancelled");
    const cells = cellsByPosition(await getRunDetail(pool as unknown as QueryExecutor, runId));
    assert.deepEqual(["0:c1", "1:c1"].map((key) => [cells[key]!.status, cells[key]!.coverage_flag]), [["error", "run_cancelled"], ["error", "run_cancelled"]]);
    const done = await getRunDetail(pool as unknown as QueryExecutor, runId);
    assert.deepEqual([done.run.status, done.run.cell_done, await certificates(runId)], ["partial", 6, 2]);
  });

  await t.test("recovery stands down when the run no longer belongs to the calculation's owner", async () => {
    const { runId } = await interruptedRun();
    await db.query(`update grid_runs set user_id = $2 where grid_run_id = $1`, [runId, IDS.other]);
    const outcome = await recover(runId);
    assert.deepEqual([outcome.status, outcome.status === "skipped" && outcome.reason], ["skipped", "parent_withdrew"]);
    assert.equal(await certificates(runId), 2);
  });
});
