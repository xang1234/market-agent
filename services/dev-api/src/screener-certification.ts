// The screener's market cap and P/E as certified engine figures (#444).
//
//   DATABASE_URL=... npm run certify:screener-universe -- [--as-of <iso>]
//
// Values every issuer the screener can show (an active common-stock listing,
// and a domicile, sector and industry) at one cutoff, now unless pinned.
// Issuers go 25 to an engine run, the engine's subject limit, each run under
// its own screener_valuation_runs row and owned by the screener's service
// user. The finalization transaction that seals a figure, or the gap sealed
// instead, also writes it to screener_certified_valuations, which every screen
// request reads. Rerunning a cutoff resumes its runs and publishes nothing
// twice, and the supervised worker resumes an interrupted run on its own.

import { randomUUID } from "node:crypto";
import { Pool } from "pg";

import { createRuntimeAuthority, DEFAULT_EXECUTION_LIMITS, type FinancialRuntimeAuthority } from "../../financial-core/src/index.ts";
import { createEvidenceFinancialPort } from "../../financial-engine/src/evidence-adapter.ts";
import { ParentRefusedError, type PersistParentArtifact } from "../../financial-engine/src/finalize.ts";
import { buildDeterministicPlan, type DeterministicUnits, type PlanningContext } from "../../financial-engine/src/planner.ts";
import type { FinancialEvidencePort, FinancialPool, SqlExecutor } from "../../financial-engine/src/ports.ts";
import { requireFinancialReadiness } from "../../financial-engine/src/readiness.ts";
import type { ParentRecovery } from "../../financial-engine/src/recovery.ts";
import { issuerLabels, publishRequest, type RequestGap } from "../../financial-engine/src/request.ts";
import { withPinnedClient, withTransaction } from "../../financial-engine/src/transaction.ts";
import { valuationOperations, valuationOutputs, type Valuation } from "../../financial-engine/src/valuation-plan.ts";
import { lastRegularSessionDate } from "../../market/src/ytd-window.ts";
import type { FinancialAnswerBlock } from "../../snapshot/src/financial-verifier.ts";

/** Seeded by migration 0071. */
export const SCREENER_SERVICE_USER_ID = "00000000-0000-4000-8000-0000000005ee";
const PARENT_VERSION = "screener-valuation.v1";
const VALUATIONS: ReadonlyArray<Valuation> = ["market_cap", "pe_ratio"];
const UNIT_ID = /^(market_cap|pe_ratio)_r(\d+)$/u;

/** A plan row: the issuer it values, its one active common-stock listing (null when it has several), and their zone. */
type Subject = Readonly<{ row: number; issuer_id: string; listing_id: string | null; timezone: string }>;
type Chunk = Readonly<{ screener_valuation_run_id: string; subjects: ReadonlyArray<Subject> }>;

export type ScreenerCertificationDeps = Readonly<{
  pool: FinancialPool;
  evidence: (executor: SqlExecutor) => FinancialEvidencePort;
}>;

/** One run's outcome: published, or the engine's reason it did not publish; and how many of its units finalization rejected. */
export type ChunkOutcome = Readonly<{ screener_valuation_run_id: string; issuers: number; outcome: "published" | RequestGap; rejected_units: number }>;

export async function certifyScreenerUniverse(deps: ScreenerCertificationDeps, asOf: string): Promise<ChunkOutcome[]> {
  const outcomes: ChunkOutcome[] = [];
  for (const chunk of await chunksFor(deps.pool, asOf)) outcomes.push(await certifyChunk(deps, asOf, chunk));
  return outcomes;
}

/** Lets the supervised worker finish an interrupted certification run. */
export function screenerUniverseRecovery(db: SqlExecutor): ParentRecovery {
  return {
    async authority(run) {
      const { rows } = await db.query(`select 1 from screener_valuation_runs where screener_valuation_run_id = $1::uuid`, [run.parent_id]);
      return rows.length > 0 && run.user_id === SCREENER_SERVICE_USER_ID ? screenerAuthority(run.parent_id) : null;
    },
    persistParent: persistScreenerValuation,
  };
}

// ---------------------------------------------------------------------------

/** The cutoff's runs: those an earlier attempt created, then new ones for every issuer they leave out. */
async function chunksFor(pool: FinancialPool, asOf: string): Promise<Chunk[]> {
  return withPinnedClient(pool, (client) => withTransaction(client, async () => {
    // One planner at a time, so two attempts at a cutoff never value an issuer twice.
    await client.query(`select pg_advisory_xact_lock(hashtext('screener_valuation_runs'))`);
    const existing = (await client.query<Chunk>(
      `select screener_valuation_run_id::text, subjects from screener_valuation_runs where as_of = $1 order by created_at, screener_valuation_run_id`,
      [asOf],
    )).rows;
    const covered = new Set(existing.flatMap((chunk) => chunk.subjects.map((subject) => subject.issuer_id)));
    const uncovered = (await universe(client, asOf)).filter((issuer) => !covered.has(issuer.issuer_id));
    const created: Chunk[] = [];
    for (let start = 0; start < uncovered.length; start += DEFAULT_EXECUTION_LIMITS.max_subjects) {
      const subjects = uncovered.slice(start, start + DEFAULT_EXECUTION_LIMITS.max_subjects).map((issuer, row) => ({ row, ...issuer }));
      const { rows } = await client.query<{ id: string }>(
        `insert into screener_valuation_runs (as_of, subjects) values ($1, $2::jsonb) returning screener_valuation_run_id::text as id`,
        [asOf, JSON.stringify(subjects)],
      );
      created.push({ screener_valuation_run_id: rows[0]!.id, subjects });
    }
    return [...existing, ...created];
  }));
}

/**
 * Issuers with an active common-stock listing at the cutoff and the
 * classification the screener requires. The listing test is the engine's
 * (loadSubjectSplitHistory), so a recorded listing is the one it prices.
 */
async function universe(db: SqlExecutor, asOf: string): Promise<Array<Omit<Subject, "row">>> {
  return (await db.query<Omit<Subject, "row">>(
    `select i.issuer_id::text as issuer_id,
            case when count(*) = 1 then min(l.listing_id::text) end as listing_id,
            min(l.timezone) as timezone
       from listings l
       join instruments i on i.instrument_id = l.instrument_id
       join issuers iss on iss.issuer_id = i.issuer_id
      where i.asset_type = 'common_stock'
        and (l.active_from is null or l.active_from <= $1::timestamptz)
        and (l.active_to is null or l.active_to > $1::timestamptz)
        and iss.domicile is not null and iss.sector is not null and iss.industry is not null
      group by i.issuer_id
      order by i.issuer_id`,
    [asOf],
  )).rows;
}

async function certifyChunk(deps: ScreenerCertificationDeps, asOf: string, chunk: Chunk): Promise<ChunkOutcome> {
  const authority = screenerAuthority(chunk.screener_valuation_run_id);
  const request = await publishRequest(deps.pool, {
    authority,
    request_key: chunk.screener_valuation_run_id,
    plan: async (planDb) => {
      const shape = planShape(chunk);
      return buildDeterministicPlan(await planningContext(planDb, asOf, chunk, authority), shape.draft, shape.units);
    },
    evidence: deps.evidence,
    persistParent: persistScreenerValuation,
  });
  const rejected = request.status === "driven" ? request.report?.finalized.filter((unit) => unit.result.status === "rejected").length ?? 0 : 0;
  // A deterministic plan never asks; treat a question as a configuration the run cannot compute.
  const outcome = request.status === "driven" ? "published" : request.status === "gap" ? request.reason : "configuration_needed";
  return { screener_valuation_run_id: chunk.screener_valuation_run_id, issuers: chunk.subjects.length, outcome, rejected_units: rejected };
}

function screenerAuthority(chunkId: string): FinancialRuntimeAuthority {
  return createRuntimeAuthority({
    owner_user_id: SCREENER_SERVICE_USER_ID,
    egress_channel: "screener",
    parent: { kind: "screener_valuation_run", id: chunkId, version: PARENT_VERSION },
    // Market data is Polygon's prices only (sourceClassOf).
    allowed_source_classes: ["sec_filing", "market_data"],
    feature: { surface: "screener", capability: "screener-valuation", mode: "enforce" },
    approval_state: "not_required",
    lease: null,
  });
}

const slotOf = (row: number) => `r${row}`;
const unitOf = (valuation: Valuation, row: number) => `${valuation}_r${row}`;

/** One unit per issuer and valuation, each over its own price and operand. */
function planShape(chunk: Chunk): { draft: object; units: DeterministicUnits } {
  const cells = chunk.subjects.flatMap((subject) => VALUATIONS.map((valuation) => ({ subject, valuation, unit: unitOf(valuation, subject.row) })));
  const outputs = (cell: (typeof cells)[number]) => valuationOutputs(cell.unit, cell.valuation).map((nodeId) => ({ output_id: `o_${nodeId}`, node_id: nodeId }));
  return {
    draft: {
      subjects: chunk.subjects.map((subject) => ({ slot_id: slotOf(subject.row), mention: `row ${subject.row}` })),
      operations: cells.flatMap((cell) => valuationOperations(cell.unit, slotOf(cell.subject.row), cell.valuation)),
      outputs: cells.flatMap(outputs),
      thresholds: [],
    },
    units: cells.map((cell) => ({ unit_id: cell.unit, output_ids: outputs(cell).map((output) => output.output_id) })),
  };
}

async function planningContext(db: SqlExecutor, asOf: string, chunk: Chunk, authority: FinancialRuntimeAuthority): Promise<PlanningContext> {
  const names = await issuerLabels(db, chunk.subjects.map((subject) => subject.issuer_id));
  return {
    plan_id: randomUUID(),
    origin: { kind: "api_request", ref: `screener:${chunk.screener_valuation_run_id}` },
    knowledge_cutoff: asOf,
    cutoff_timezone: "UTC",
    reporting_basis: "as_reported",
    freshness_max_age_days: null,
    authority,
    parent_limits: {},
    max_model_calls: 0,
    requested_subjects: chunk.subjects.map((subject) => ({
      mention: `row ${subject.row}`,
      resolution: { status: "resolved", subject_ref: { kind: "issuer", id: subject.issuer_id }, label: names.get(subject.issuer_id) ?? subject.issuer_id },
    })),
    publication_unit_kind: "screener_valuation",
  };
}

/** Writes the issuer's figure, or its gap, inside the finalization transaction. */
const persistScreenerValuation: PersistParentArtifact = async (tx, publication) => {
  const match = UNIT_ID.exec(publication.unit_id);
  if (!match) throw new Error(`unit ${publication.unit_id} is not a screener valuation`);
  const chunk = (await tx.client.query<{ subjects: Subject[] }>(
    `select subjects from screener_valuation_runs where screener_valuation_run_id = $1::uuid`,
    [tx.run.parent_id],
  )).rows[0];
  if (!chunk) throw new ParentRefusedError("the screener valuation run was deleted");
  const subject = chunk.subjects.find((candidate) => candidate.row === Number(match[2]));
  if (!subject) throw new Error(`screener valuation run ${tx.run.parent_id} has no row ${match[2]}`);
  const figure = sealedFigure(publication.block, publication.unit_id);
  await tx.client.query(
    `insert into screener_certified_valuations
       (issuer_id, valuation, knowledge_cutoff, session_date, value, currency, reason_code, listing_id, snapshot_id, financial_run_id, financial_unit_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     on conflict (issuer_id, valuation) do update set
       knowledge_cutoff = excluded.knowledge_cutoff, session_date = excluded.session_date, value = excluded.value,
       currency = excluded.currency, reason_code = excluded.reason_code, listing_id = excluded.listing_id,
       snapshot_id = excluded.snapshot_id, financial_run_id = excluded.financial_run_id, financial_unit_id = excluded.financial_unit_id
       -- A run that finishes late, a recovered one say, never replaces a figure certified at a later cutoff.
       where screener_certified_valuations.knowledge_cutoff <= excluded.knowledge_cutoff`,
    [subject.issuer_id, match[1], tx.run.knowledge_cutoff, lastRegularSessionDate(tx.run.knowledge_cutoff, subject.timezone),
      figure.value, figure.currency, figure.reason_code, subject.listing_id, publication.snapshot_id, publication.run_id, publication.unit_id],
  );
};

/** The unit's figure, or why it has none: an input's own reason when the figure was blocked by it. */
function sealedFigure(block: FinancialAnswerBlock, unitId: string): { value: string | null; currency: string | null; reason_code: string | null } {
  const { results } = block.financial;
  const presented = results.find((result) => result.output_id === `o_${unitId}`)?.presented;
  if (presented?.kind === "value") return { value: presented.value, currency: presented.unit.kind === "currency" ? presented.unit.currency : null, reason_code: null };
  const reasons = results.flatMap((result) => (result.presented.kind === "gap" ? [result.presented.reason_code] : []));
  return { value: null, currency: null, reason_code: reasons.find((reason) => reason !== "blocked_by_dependency") ?? reasons[0] ?? "no_result" };
}

/** The cutoff the operator pinned with `--as-of`, else now. A cutoff in the future is refused. */
export function parseAsOf(args: ReadonlyArray<string>, now: Date): string {
  if (args.length === 0) return now.toISOString();
  const pinned = args[0] === "--as-of" && args.length === 2 ? Date.parse(args[1]!) : Number.NaN;
  if (Number.isNaN(pinned)) throw new Error("usage: npm run certify:screener-universe -- [--as-of <ISO timestamp>]");
  if (pinned > now.getTime()) throw new Error(`--as-of ${args[1]} is in the future`);
  return new Date(pinned).toISOString();
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const asOf = parseAsOf(process.argv.slice(2), new Date());
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await requireFinancialReadiness(pool, ["screener"]);
    console.log(`certifying the screener universe as of ${asOf}`);
    const outcomes = await certifyScreenerUniverse({ pool, evidence: createEvidenceFinancialPort }, asOf);
    for (const chunk of outcomes) {
      const rejected = chunk.rejected_units > 0 ? `, ${chunk.rejected_units} unit(s) rejected` : "";
      console.log(`${chunk.screener_valuation_run_id}: ${chunk.issuers} issuer(s), ${chunk.outcome}${rejected}`);
    }
    const unfinished = outcomes.filter((chunk) => chunk.outcome !== "published" || chunk.rejected_units > 0).length;
    console.log(`${outcomes.reduce((total, chunk) => total + chunk.issuers, 0)} issuer(s) in ${outcomes.length} run(s)`);
    if (unfinished > 0) {
      console.error(`${unfinished} run(s) did not publish every figure; rerun with --as-of ${asOf} to resume them`);
      process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
