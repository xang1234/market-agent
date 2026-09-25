// Numerical grid columns through the verified financial engine.
//
// A grid run's numerical cells are one deterministic plan — the run's cutoff,
// its frozen rows as subjects, and its frozen column instances — with one
// publication unit per cell. No model is involved. Each cell is sealed under
// its own certificate, and the finalization transaction that seals it also
// writes the cell and counts it done, so a retry, a restart, or a second
// worker can neither duplicate a computation nor double-count progress.
//
// Every direct numerical column goes through the engine or an explicit
// unsupported outcome. Market capitalization needs market price, share count,
// and timing proof the engine does not certify yet, so it is unsupported rather
// than silently taken from the latest active fact. Reader-question prose stays
// on its own, non-certified path.

import { randomUUID } from "node:crypto";

import {
  createRuntimeAuthority,
  type FinancialRuntimeAuthority,
  type FinancialSubjectRef,
} from "../../financial-core/src/index.ts";
import type { PersistParentArtifact } from "../../financial-engine/src/finalize.ts";
import type { FinancialPool } from "../../financial-engine/src/http.ts";
import { buildDeterministicPlan, type DeterministicUnits, type PlanningContext, type RequestedSubject } from "../../financial-engine/src/planner.ts";
import type { FinancialEvidencePort, SqlExecutor } from "../../financial-engine/src/ports.ts";
import { reserveAndPublish, type PublishResult } from "../../financial-engine/src/publish.ts";
import type { ParentRecovery } from "../../financial-engine/src/recovery.ts";
import type { RunRecord } from "../../financial-engine/src/run-record.ts";
import { findRunForRequest } from "../../financial-engine/src/run-repo.ts";
import type { FinancialAnswerBlock } from "../../snapshot/src/financial-verifier.ts";
import { snapshotTransactionClient } from "../../snapshot/src/snapshot-sealer.ts";
import type { SubjectRef } from "../../shared/src/subject-ref.ts";
import { settleRunIfDone, writePendingCellOnce } from "./queries.ts";
import { EMPTY_DISPLAY, GridValidationError, type CellWrite, type ColumnInstance } from "./types.ts";

export type GridFinancialMode = "off" | "shadow" | "enforce";

export type GridFinancialDeps = Readonly<{
  mode: GridFinancialMode;
  pool: FinancialPool;
  evidence: (executor: SqlExecutor) => FinancialEvidencePort;
  workerId?: string;
}>;

type FinancialColumn = Readonly<{ metric_key: string }> | Readonly<{ unsupported: string }>;

const FINANCIAL_COLUMNS: Readonly<Record<string, FinancialColumn>> = {
  latest_revenue: { metric_key: "revenue" },
  latest_eps_diluted: { metric_key: "eps_diluted" },
  latest_market_cap: { unsupported: "market_cap_needs_price_share_timing_proof" },
};

export type FinancialColumnParams = Readonly<{ period_type: "annual" | "quarterly"; offset: number }>;

const MAX_PERIOD_OFFSET = 19;
const LEASE_TTL_MS = 120_000;
const PARENT_VERSION = "grid-run.v1";

/** Whether a column is numerical and so answered by the engine (or declared unsupported) when the lane is enforced. */
export function isFinancialColumn(columnKey: string): boolean {
  return Object.hasOwn(FINANCIAL_COLUMNS, columnKey);
}

/**
 * Validates a numerical column's params: which period, relative to the latest
 * one public at the run's cutoff. Defaults to the latest annual period. Unknown
 * keys are rejected so two differently configured instances never look alike.
 */
export function parseFinancialColumnParams(columnKey: string, params: unknown): FinancialColumnParams {
  if (params === undefined || params === null) return { period_type: "annual", offset: 0 };
  if (typeof params !== "object" || Array.isArray(params)) throw new GridValidationError(`${columnKey} params must be an object`);
  const record = params as Record<string, unknown>;
  const unknown = Object.keys(record).filter((key) => key !== "period_type" && key !== "offset");
  if (unknown.length > 0) throw new GridValidationError(`${columnKey} params do not allow: ${unknown.join(", ")}`);
  const periodType = record.period_type ?? "annual";
  if (periodType !== "annual" && periodType !== "quarterly") throw new GridValidationError(`${columnKey} period_type must be annual or quarterly`);
  const offset = record.offset ?? 0;
  if (typeof offset !== "number" || !Number.isInteger(offset) || offset < 0 || offset > MAX_PERIOD_OFFSET) {
    throw new GridValidationError(`${columnKey} offset must be an integer from 0 to ${MAX_PERIOD_OFFSET}`);
  }
  return { period_type: periodType, offset };
}

export type GridFinancialRun = Readonly<{
  user_id: string;
  grid_run_id: string;
  /** The run's pinned cutoff (grid_runs.as_of). */
  knowledge_cutoff: string;
  mode: "shadow" | "enforce";
  rows: ReadonlyArray<Readonly<{ rowNumber: number; subject: SubjectRef }>>;
  /** The run's frozen numerical column instances. */
  instances: ReadonlyArray<ColumnInstance>;
}>;

export type GridFinancialOutcome =
  | "published"
  | "shadow"
  | "configuration_needed"
  | "unsupported"
  | "request_conflict"
  | "run_in_progress"
  | "run_cancelled"
  | "run_failed"
  | "publication_failed";

/**
 * Computes and publishes a run's numerical cells. Unsupported columns and
 * non-issuer rows are written as explicit unsupported cells. Cells the engine
 * will not publish are written as gaps with their reason; cells still owed by
 * another worker or by recovery stay pending. Idempotent across retries.
 */
export async function publishGridFinancialCells(deps: GridFinancialDeps, run: GridFinancialRun): Promise<GridFinancialOutcome> {
  const db = deps.pool;
  const write = (rowNumber: number, instance: ColumnInstance, cell: CellWrite) =>
    writePendingCellOnce(db, { ...cell, gridRunId: run.grid_run_id, ownerId: run.user_id, rowNumber, columnInstanceId: instance.column_instance_id });

  const computed: Array<{ rowNumber: number; subject: FinancialSubjectRef; instance: ColumnInstance; metric_key: string; params: FinancialColumnParams }> = [];
  for (const instance of run.instances) {
    const column = FINANCIAL_COLUMNS[instance.column_key];
    if (!column) continue;
    for (const row of run.rows) {
      if ("unsupported" in column || row.subject.kind !== "issuer") {
        if (run.mode === "enforce") await write(row.rowNumber, instance, unsupportedCell("unsupported" in column ? column.unsupported : "subject_not_an_issuer"));
        continue;
      }
      computed.push({ rowNumber: row.rowNumber, subject: { kind: "issuer", id: row.subject.id }, instance, metric_key: column.metric_key, params: parseFinancialColumnParams(instance.column_key, instance.params) });
    }
  }
  if (computed.length === 0) {
    if (run.mode === "enforce") await settleRunIfDone(db, run.grid_run_id);
    return "published";
  }

  const authority = gridAuthority(run.user_id, run.grid_run_id, run.mode);
  const client = snapshotTransactionClient(await deps.pool.connect());
  let outcome: GridFinancialOutcome;
  try {
    const earlier = await findRunForRequest(client, { authority, request_key: run.grid_run_id });
    let plan = earlier?.plan;
    if (!plan) {
      const planned = buildDeterministicPlan(await planningContext(client, run, authority, computed), cellDraft(computed), cellUnits(computed));
      if (planned.outcome !== "ready") {
        outcome = planned.outcome === "unsupported" ? "unsupported" : "configuration_needed";
        if (run.mode === "enforce") for (const cell of computed) await write(cell.rowNumber, cell.instance, gapCell(outcome));
        return outcome;
      }
      plan = planned.plan;
    }
    if (run.mode === "shadow") return "shadow";
    try {
      outcome = outcomeOf(await reserveAndPublish(client, {
        plan,
        authority,
        request_key: run.grid_run_id,
        worker_id: deps.workerId ?? `grid-${process.pid}`,
        ttl_ms: LEASE_TTL_MS,
        evidence: deps.evidence,
        parent_limits: {},
        persistParent: persistGridCell(run.grid_run_id),
      }));
    } catch {
      // Cells committed before the failure stay committed; the run keeps its checkpoints.
      outcome = "publication_failed";
    }
  } finally {
    client.release();
  }
  // Whatever the engine will not publish is a declared gap. A run another worker holds, or one whose
  // publication failed part-way, keeps its cells pending: that worker or the recovery worker finishes them.
  if (outcome !== "run_in_progress" && outcome !== "publication_failed") {
    for (const cell of computed) await write(cell.rowNumber, cell.instance, gapCell(outcome === "published" ? "verification_failed" : outcome));
  }
  await settleRunIfDone(db, run.grid_run_id);
  return outcome;
}

/** Lets the supervised worker finish a grid run's interrupted numerical cells under the run's owner. */
export function gridFinancialRecovery(db: SqlExecutor): ParentRecovery {
  return {
    async authority(run: RunRecord) {
      const grid = (await db.query<{ user_id: string; financial_mode: string | null }>(
        `select user_id::text, financial_mode from grid_runs where grid_run_id = $1::uuid`,
        [run.parent_id],
      )).rows[0];
      if (!grid || grid.user_id !== run.user_id || grid.financial_mode !== "enforce") return null;
      return gridAuthority(grid.user_id, run.parent_id, "enforce");
    },
    persistParent: persistGridCell(null),
  };
}

// ---------------------------------------------------------------------------

function gridAuthority(userId: string, gridRunId: string, mode: "shadow" | "enforce"): FinancialRuntimeAuthority {
  return createRuntimeAuthority({
    owner_user_id: userId,
    egress_channel: "analyst_grid",
    // The run is the parent; its columns and rows were frozen when it started.
    parent: { kind: "analyst_grid_run", id: gridRunId, version: PARENT_VERSION },
    allowed_source_classes: ["sec_filing"],
    feature: { surface: "analyst_grid", capability: "financial-column", mode },
    approval_state: "not_required",
    lease: null,
  });
}

type ComputedCell = Readonly<{ rowNumber: number; subject: FinancialSubjectRef; instance: ColumnInstance; metric_key: string; params: FinancialColumnParams }>;

const slotOf = (rowNumber: number) => `r${rowNumber}`;
const unitOf = (cell: ComputedCell) => `${cell.instance.column_instance_id}_r${cell.rowNumber}`;
const UNIT_ID = /^(c\d+)_r(\d+)$/u;

function cellDraft(cells: ReadonlyArray<ComputedCell>) {
  const subjects = new Map(cells.map((cell) => [cell.rowNumber, cell.subject]));
  return {
    subjects: [...subjects.keys()].sort((left, right) => left - right).map((rowNumber) => ({ slot_id: slotOf(rowNumber), mention: `row ${rowNumber}` })),
    operations: cells.map((cell) => ({
      node_id: unitOf(cell),
      operation: "reported_metric",
      subject_slot: slotOf(cell.rowNumber),
      metric_key: cell.metric_key,
      period: { kind: "latest", period_type: cell.params.period_type, offset: cell.params.offset },
    })),
    outputs: cells.map((cell) => ({ output_id: `o_${unitOf(cell)}`, node_id: unitOf(cell) })),
    thresholds: [],
  };
}

function cellUnits(cells: ReadonlyArray<ComputedCell>): DeterministicUnits {
  return cells.map((cell) => ({ unit_id: unitOf(cell), output_ids: [`o_${unitOf(cell)}`] }));
}

async function planningContext(db: SqlExecutor, run: GridFinancialRun, authority: FinancialRuntimeAuthority, cells: ReadonlyArray<ComputedCell>): Promise<PlanningContext> {
  const subjects = new Map(cells.map((cell) => [cell.rowNumber, cell.subject]));
  const names = new Map((await db.query<{ issuer_id: string; legal_name: string }>(
    `select issuer_id::text, legal_name from issuers where issuer_id = any($1::uuid[])`,
    [[...subjects.values()].map((subject) => subject.id)],
  )).rows.map((row) => [row.issuer_id, row.legal_name]));
  // Rows are canonical identities resolved when the run started; a row whose issuer has no name is labelled by its id.
  const requested: RequestedSubject[] = [...subjects.entries()].sort(([left], [right]) => left - right).map(([rowNumber, subject]) => ({
    mention: `row ${rowNumber}`,
    resolution: { status: "resolved", subject_ref: subject, label: names.get(subject.id) ?? subject.id },
  }));
  return {
    plan_id: randomUUID(),
    origin: { kind: "grid_run", ref: `grid:${run.grid_run_id}` },
    knowledge_cutoff: new Date(run.knowledge_cutoff).toISOString(),
    cutoff_timezone: "UTC",
    reporting_basis: "as_reported",
    freshness_max_age_days: null,
    authority,
    parent_limits: {},
    max_model_calls: 0,
    requested_subjects: requested,
    publication_unit_kind: "grid_cell",
  };
}

/** Writes the cell and counts it done inside the finalization transaction, under the run's owner. */
function persistGridCell(expectedRunId: string | null): PersistParentArtifact {
  return async (tx, publication) => {
    if (expectedRunId !== null && tx.run.parent_id !== expectedRunId) throw new Error("the financial run belongs to another grid run");
    const match = UNIT_ID.exec(publication.unit_id);
    if (!match) throw new Error(`unit ${publication.unit_id} is not a grid cell`);
    const written = await writePendingCellOnce(tx.client, {
      ...certifiedCell(publication.block),
      gridRunId: tx.run.parent_id,
      ownerId: tx.run.user_id,
      rowNumber: Number(match[2]),
      columnInstanceId: match[1]!,
      snapshotId: publication.snapshot_id,
      certified: { financialRunId: publication.run_id, financialUnitId: publication.unit_id, certificateDigest: publication.certificate_digest, block: publication.block },
    });
    if (!written) throw new Error("the grid cell is no longer pending under the run's owner");
    await settleRunIfDone(tx.client, tx.run.parent_id);
  };
}

function certifiedCell(block: FinancialAnswerBlock): CellWrite {
  const [result] = block.financial.results;
  const verified = result?.disposition === "verified";
  return {
    status: verified ? "ok" : "missing_data",
    display: { value: verified ? result!.presented.text : EMPTY_DISPLAY.value, tone: null },
    snapshotId: block.snapshot_id,
    primaryRef: null,
    coverageFlag: verified ? null : result?.presented.kind === "gap" ? result.presented.reason_code : "no_result",
  };
}

function unsupportedCell(reason: string): CellWrite {
  return { status: "no_coverage", display: EMPTY_DISPLAY, snapshotId: null, primaryRef: null, coverageFlag: reason };
}

function gapCell(reason: string): CellWrite {
  return { status: "error", display: EMPTY_DISPLAY, snapshotId: null, primaryRef: null, coverageFlag: reason };
}

function outcomeOf(result: PublishResult): GridFinancialOutcome {
  switch (result.status) {
    case "conflict":
      return "request_conflict";
    case "unavailable":
      return result.reason === "busy" ? "run_in_progress" : result.reason === "cancel_requested" ? "run_cancelled" : "run_failed";
    case "cancelled":
      return "run_cancelled";
    case "failed":
      return "run_failed";
    case "completed":
    case "driven":
      return "published";
  }
}
