// Numerical Analyze sections through the verified financial engine.
//
// A memo's numerical sections (revenue trend, peer table, financial health)
// are one deterministic engine plan — one cutoff, basis, definition catalog,
// and subject set for the whole memo — with one publication unit per section.
// Each unit is sealed alone under its own certificate, and the finalization
// transaction that seals it also records the section against the memo run.
// Narrative sections stay in the memo's own snapshot; a certified number is
// never merged into it (see seal-input-merge.ts).
//
// The memo's run metadata declares which sections were requested. A declared
// section without a committed row reads as a gap with its reason, so a failed
// section can leave partial results but never a memo that implies complete
// coverage.

import { randomUUID } from "node:crypto";

import { createRuntimeAuthority, type FinancialRuntimeAuthority, type ReportingBasis } from "../../financial-core/src/index.ts";
import type { PersistParentArtifact } from "../../financial-engine/src/finalize.ts";
import { buildDeterministicPlan, type DeterministicUnits, type PlanningContext, type RequestedSubject } from "../../financial-engine/src/planner.ts";
import type { FinancialEvidencePort, FinancialPool, SqlExecutor } from "../../financial-engine/src/ports.ts";
import type { ParentRecovery } from "../../financial-engine/src/recovery.ts";
import { issuerLabels, publishRequest, type RequestGap } from "../../financial-engine/src/request.ts";
import type { RunRecord } from "../../financial-engine/src/run-record.ts";
import type { FinancialAnswerBlock } from "../../snapshot/src/financial-verifier.ts";
import type { AnalyzePlaybook } from "./playbook.ts";
import { AnalyzeRunMetadataError, parseAnalyzeRunMetadata, type AnalyzeRunFinancialMetadata } from "./runMetadata.ts";

export type AnalyzeFinancialMode = "off" | "shadow" | "enforce";

/** Why a declared section has no committed row: the engine's reason, or what committed state shows. */
export type AnalyzeFinancialGapReason = RequestGap | "verification_failed" | "not_started";

export type AnalyzeFinancialSection =
  | Readonly<{ section_id: string; status: "published"; run_id: string; snapshot_id: string; block: FinancialAnswerBlock }>
  | Readonly<{ section_id: string; status: "gap"; reason_code: AnalyzeFinancialGapReason }>;

export type AnalyzeFinancialSections = Readonly<{
  coverage: "complete" | "partial" | "none";
  sections: ReadonlyArray<AnalyzeFinancialSection>;
}>;

export type AnalyzeFinancialDeps = Readonly<{
  pool: FinancialPool;
  evidence: (executor: SqlExecutor) => FinancialEvidencePort;
  workerId?: string;
}>;

const CATALOG_VERSION = "catalog.v1";
const PRIMARY_SLOT = "s0";

type Operation = Record<string, unknown> & { node_id: string };
type SectionDraft = Readonly<{ operations: ReadonlyArray<Operation>; outputs: ReadonlyArray<Readonly<{ output_id: string; node_id: string }>> }>;

const latest = (slot: string, metric: string, offset: number): Operation => ({
  node_id: `${metric}_${slot}_${offset}`,
  operation: "reported_metric",
  subject_slot: slot,
  metric_key: metric,
  period: { kind: "latest", period_type: "annual", offset },
});

// Numerical sections by section id, shared across playbooks. Node ids are
// shared too, so two sections reading one fact compute it once.
const FINANCIAL_SECTIONS: Readonly<Record<string, (slots: ReadonlyArray<string>) => SectionDraft>> = {
  revenue_trend: () => {
    const current = latest(PRIMARY_SLOT, "revenue", 0);
    const prior = latest(PRIMARY_SLOT, "revenue", 1);
    const growth = { node_id: "revenue_growth", operation: "percent_change_positive_base", current: current.node_id, prior: prior.node_id };
    return {
      operations: [current, prior, growth],
      outputs: [
        { output_id: "revenue_trend_current", node_id: current.node_id },
        { output_id: "revenue_trend_prior", node_id: prior.node_id },
        { output_id: "revenue_trend_growth", node_id: growth.node_id },
      ],
    };
  },
  peer_table: (slots) => {
    const revenues = slots.map((slot) => latest(slot, "revenue", 0));
    const rank = { node_id: "peer_revenue_rank", operation: "peer_compare", members: revenues.map((node) => node.node_id), direction: "highest" };
    return {
      operations: [...revenues, rank],
      outputs: [
        ...revenues.map((node, index) => ({ output_id: `peer_table_${slots[index]}`, node_id: node.node_id })),
        { output_id: "peer_table_rank", node_id: rank.node_id },
      ],
    };
  },
  financial_health: () => {
    const revenue = latest(PRIMARY_SLOT, "revenue", 0);
    const grossProfit = latest(PRIMARY_SLOT, "gross_profit", 0);
    const margin = { node_id: "gross_margin_s0", operation: "gross_margin", numerator: grossProfit.node_id, revenue: revenue.node_id };
    return {
      operations: [revenue, grossProfit, margin],
      outputs: [{ output_id: "financial_health_gross_margin", node_id: margin.node_id }],
    };
  },
};

/** The playbook's sections the engine computes; narrative sections are not listed. */
export function financialSectionIds(playbook: AnalyzePlaybook): string[] {
  return playbook.sections.map((section) => section.section_id).filter((id) => Object.hasOwn(FINANCIAL_SECTIONS, id));
}

/** Freezes the memo's financial context, or null when the lane is off or the memo has nothing numerical to compute. */
export function prepareAnalyzeFinancialContext(input: {
  mode: AnalyzeFinancialMode;
  playbook: AnalyzePlaybook;
  primary: Readonly<{ kind: "issuer"; id: string }> | null;
  peers: ReadonlyArray<Readonly<{ kind: "issuer"; id: string }>>;
  knowledge_cutoff: string;
  reporting_basis?: ReportingBasis;
}): AnalyzeRunFinancialMetadata | null {
  if (input.mode === "off" || input.primary === null) return null;
  const sections = financialSectionIds(input.playbook);
  if (sections.length === 0) return null;
  const peers = sections.includes("peer_table")
    ? input.peers.filter((peer, index, all) => peer.id !== input.primary!.id && all.findIndex((other) => other.id === peer.id) === index)
    : [];
  return Object.freeze({
    mode: input.mode,
    knowledge_cutoff: new Date(input.knowledge_cutoff).toISOString(),
    reporting_basis: input.reporting_basis ?? "as_reported",
    catalog_version: CATALOG_VERSION,
    primary: Object.freeze({ kind: "issuer", id: input.primary.id }),
    requested_peers: Object.freeze(peers.map((peer) => Object.freeze({ kind: "issuer" as const, id: peer.id }))),
    sections: Object.freeze(sections),
  });
}

/** Sections the engine answers for this memo; legacy producers must not also emit them. */
export function sectionsServedByEngine(context: AnalyzeRunFinancialMetadata | null): ReadonlySet<string> {
  return new Set(context?.mode === "enforce" ? context.sections : []);
}

export type AnalyzeFinancialRun = Readonly<{
  user_id: string;
  analyze_run_id: string;
  template_id: string;
  template_version: number;
  context: AnalyzeRunFinancialMetadata;
}>;

/**
 * Plans, executes, and publishes the memo's numerical sections. Idempotent: a
 * retry resumes the saved plan and run; sections already sealed are reported
 * from their committed rows and never published twice. In shadow mode the plan
 * is only validated. The result is always read back from committed state.
 */
export async function publishAnalyzeFinancialSections(deps: AnalyzeFinancialDeps, run: AnalyzeFinancialRun): Promise<AnalyzeFinancialSections> {
  const authority = analyzeAuthority(run.user_id, run.analyze_run_id, run.template_id, run.template_version, run.context.mode);
  const outcome = await publishRequest(deps.pool, {
    authority,
    request_key: run.analyze_run_id,
    mode: run.context.mode,
    plan: async (db) => {
      const shape = planShape(run.context);
      return buildDeterministicPlan(await planningContext(db, run, authority), shape.draft, shape.units);
    },
    evidence: deps.evidence,
    persistParent: persistMemoSection(run.analyze_run_id),
    worker_id: deps.workerId ?? `analyze-${process.pid}`,
  });
  switch (outcome.status) {
    case "planned":
      return { coverage: "none", sections: [] };
    case "driven":
      return readSections(deps.pool, run.user_id, run.analyze_run_id, run.context, null);
    case "gap":
      // This call's reason is more precise than committed state for every section it left unpublished.
      return readSections(deps.pool, run.user_id, run.analyze_run_id, run.context, outcome.reason);
    case "clarification":
      return readSections(deps.pool, run.user_id, run.analyze_run_id, run.context, "configuration_needed");
  }
}

/** The committed financial sections of a memo run, for its owner. Unknown or foreign runs read as null. */
export async function loadAnalyzeFinancialSections(db: SqlExecutor, input: { userId: string; analyzeRunId: string }): Promise<AnalyzeFinancialSections | null> {
  const memo = await loadMemoRun(db, input.analyzeRunId);
  if (!memo || memo.user_id !== input.userId) return null;
  if (!memo.context || memo.context.mode !== "enforce") return { coverage: "none", sections: [] };
  return readSections(db, input.userId, input.analyzeRunId, memo.context, null);
}

/** Lets the supervised worker resume a memo's interrupted financial run under the memo's current owner and version. */
export function analyzeFinancialRecovery(db: SqlExecutor): ParentRecovery {
  return {
    async authority(run: RunRecord) {
      const memo = await loadMemoRun(db, run.parent_id);
      if (!memo || memo.user_id !== run.user_id || memo.context?.mode !== "enforce") return null;
      return analyzeAuthority(memo.user_id, run.parent_id, memo.template_id, memo.template_version, "enforce");
    },
    persistParent: persistMemoSection(null),
  };
}

// ---------------------------------------------------------------------------

function analyzeAuthority(userId: string, analyzeRunId: string, templateId: string, templateVersion: number, mode: "shadow" | "enforce"): FinancialRuntimeAuthority {
  return createRuntimeAuthority({
    owner_user_id: userId,
    egress_channel: "analyze",
    // The memo run is the parent; its template version is pinned for the run's life.
    parent: { kind: "analyze_memo_run", id: analyzeRunId, version: `template:${templateId}:v${templateVersion}` },
    allowed_source_classes: ["sec_filing"],
    feature: { surface: "analyze", capability: "financial-section", mode },
    approval_state: "not_required",
    lease: null,
  });
}

/** The memo's plan draft and its units (one per section), built in one pass over the requested sections. */
function planShape(context: AnalyzeRunFinancialMetadata): { draft: object; units: DeterministicUnits } {
  const slots = [PRIMARY_SLOT, ...context.requested_peers.map((_peer, index) => `s${index + 1}`)];
  const subjects = [context.primary, ...context.requested_peers];
  const operations = new Map<string, Operation>();
  const outputs: Array<{ output_id: string; node_id: string }> = [];
  const units: Array<{ unit_id: string; output_ids: string[] }> = [];
  for (const sectionId of context.sections) {
    const section = FINANCIAL_SECTIONS[sectionId]!(slots);
    for (const operation of section.operations) operations.set(operation.node_id, operation);
    outputs.push(...section.outputs);
    units.push({ unit_id: sectionId, output_ids: section.outputs.map((output) => output.output_id) });
  }
  return {
    draft: {
      subjects: slots.map((slot, index) => ({ slot_id: slot, mention: subjects[index]!.id })),
      operations: [...operations.values()],
      outputs,
      thresholds: [],
    },
    units,
  };
}

async function planningContext(db: SqlExecutor, run: AnalyzeFinancialRun, authority: FinancialRuntimeAuthority): Promise<PlanningContext> {
  const subjects = [run.context.primary, ...run.context.requested_peers];
  const labels = await issuerLabels(db, subjects.map((subject) => subject.id));
  const requested: RequestedSubject[] = subjects.map((subject) => {
    const label = labels.get(subject.id);
    return { mention: subject.id, resolution: label === undefined ? { status: "not_found" } : { status: "resolved", subject_ref: subject, label } };
  });
  return {
    plan_id: randomUUID(),
    origin: { kind: "analyze_section", ref: `analyze:${run.analyze_run_id}` },
    knowledge_cutoff: run.context.knowledge_cutoff,
    cutoff_timezone: "UTC",
    reporting_basis: run.context.reporting_basis,
    freshness_max_age_days: null,
    authority,
    parent_limits: {},
    max_model_calls: 0,
    requested_subjects: requested,
    publication_unit_kind: "analyze_section",
  };
}

/** Records the section against the memo run inside the finalization transaction, under the memo's owner. */
function persistMemoSection(expectedRunId: string | null): PersistParentArtifact {
  return async (tx, publication) => {
    if (expectedRunId !== null && tx.run.parent_id !== expectedRunId) throw new Error("the financial run belongs to another memo");
    const inserted = await tx.client.query(
      `insert into analyze_run_financial_sections (analyze_run_id, section_id, financial_run_id, unit_id, snapshot_id, certificate_digest, block)
       select r.run_id, $2, $3::uuid, $2, $4::uuid, $5, $6::jsonb
         from analyze_template_runs r
         join analyze_templates t on t.template_id = r.template_id
        where r.run_id = $1::uuid and t.user_id = $7::uuid
       returning section_id`,
      [tx.run.parent_id, publication.unit_id, publication.run_id, publication.snapshot_id, publication.certificate_digest, JSON.stringify(publication.block), tx.run.user_id],
    );
    if (inserted.rows.length === 0) throw new Error("the memo run no longer belongs to the financial run's owner");
  };
}

type MemoRun = { user_id: string; template_id: string; template_version: number; context: AnalyzeRunFinancialMetadata | null };

async function loadMemoRun(db: SqlExecutor, analyzeRunId: string): Promise<MemoRun | null> {
  const row = (await db.query<{ user_id: string; template_id: string; template_version: number; run_metadata: unknown }>(
    `select t.user_id::text, r.template_id::text, r.template_version, r.run_metadata
       from analyze_template_runs r join analyze_templates t on t.template_id = r.template_id
      where r.run_id = $1::uuid`,
    [analyzeRunId],
  )).rows[0];
  if (!row) return null;
  return { user_id: row.user_id, template_id: row.template_id, template_version: Number(row.template_version), context: financialContextOf(row.run_metadata) };
}

/** The saved financial context, validated; metadata from before the lane existed has none. */
function financialContextOf(metadata: unknown): AnalyzeRunFinancialMetadata | null {
  try {
    return parseAnalyzeRunMetadata(metadata).financial ?? null;
  } catch (error) {
    if (error instanceof AnalyzeRunMetadataError) return null;
    throw error;
  }
}

async function readSections(
  db: SqlExecutor,
  userId: string,
  analyzeRunId: string,
  context: AnalyzeRunFinancialMetadata,
  override: AnalyzeFinancialGapReason | null,
): Promise<AnalyzeFinancialSections> {
  const published = new Map((await db.query<{ section_id: string; financial_run_id: string; snapshot_id: string; block: FinancialAnswerBlock }>(
    `select s.section_id, s.financial_run_id::text, s.snapshot_id::text, s.block
       from analyze_run_financial_sections s
       join analyze_template_runs r on r.run_id = s.analyze_run_id
       join analyze_templates t on t.template_id = r.template_id
      where s.analyze_run_id = $1::uuid and t.user_id = $2::uuid`,
    [analyzeRunId, userId],
  )).rows.map((row) => [row.section_id, row]));
  const units = new Map((await db.query<{ unit_id: string; unit_state: string; execution_state: string }>(
    `select u.unit_id, u.state as unit_state, f.execution_state
       from financial_runs f join financial_run_units u on u.run_id = f.run_id
      where f.user_id = $1::uuid and f.parent_kind = 'analyze_memo_run' and f.parent_id = $2::uuid and f.request_key = $2::text`,
    [userId, analyzeRunId],
  )).rows.map((row) => [row.unit_id, row]));

  const sections = context.sections.map((sectionId): AnalyzeFinancialSection => {
    const row = published.get(sectionId);
    if (row) return { section_id: sectionId, status: "published", run_id: row.financial_run_id, snapshot_id: row.snapshot_id, block: row.block };
    return { section_id: sectionId, status: "gap", reason_code: override ?? gapReason(units.get(sectionId)) };
  });
  return { coverage: coverageOf(sections), sections };
}

function gapReason(unit: { unit_state: string; execution_state: string } | undefined): AnalyzeFinancialGapReason {
  if (!unit) return "not_started";
  if (unit.execution_state === "cancelled") return "run_cancelled";
  if (unit.execution_state === "failed") return "run_failed";
  // Computed but not sealed once the run is ready to seal: finalization refused it.
  if (unit.unit_state === "rejected" || (unit.unit_state === "computed" && unit.execution_state === "ready_to_seal")) return "verification_failed";
  return "run_in_progress";
}

/** Complete only when every requested section is published and covers everything it was asked; none when nothing verified. */
function coverageOf(sections: ReadonlyArray<AnalyzeFinancialSection>): AnalyzeFinancialSections["coverage"] {
  const states = sections.map((section) => (section.status === "published" ? section.block.financial.coverage.state : "none"));
  if (states.every((state) => state === "complete")) return "complete";
  return states.every((state) => state === "none") ? "none" : "partial";
}
