import { assessCompany } from "./assessment.ts";
import { LlmProviderError, LlmRouterError } from "../../llm/src/router.ts";
import { chooseResearchCohort } from "./cohort.ts";
import { createOperationRunner } from "./operations.ts";
import { rankShortlist } from "./selection.ts";
import { addGap, requestHash } from "./scout-support.ts";
import { discoverCandidates } from "./scout.ts";
import { ProviderRequestError } from "./providers/errors.ts";
import type { Checkpoint, EvidencePacket, Lease, StoredCandidate, WorkerDeps } from "./ports.ts";
import type { Coverage, RunStatus } from "./types.ts";
import { DiscoveryError } from "./types.ts";

export type StageOutcome = Readonly<{ coverage: Coverage; status: Extract<RunStatus, "completed" | "partial" | "failed"> }>;

/** Executes only fenced repository mutations; providers are always outside repository transactions. */
export async function executeStages(deps: WorkerDeps, lease: Lease, signal: AbortSignal): Promise<StageOutcome> {
  const run = await assertRunnable(deps, lease, signal);
  const brief = await deps.repo.getBrief(lease.user_id, run.brief_id);
  const providers = deps.providers(lease);
  const operations = createOperationRunner(deps.repo, lease, signal);
  let checkpoint = await deps.repo.checkpoint(lease);
  let coverage = structuredClone(run.coverage);

  if (run.stage === "discovery") {
    const existingWithEvidence = await deps.loadExisting(lease, brief.brief);
    const authorizedExisting = await deps.repo.authorizeExistingCandidates(lease, existingWithEvidence);
    const existing = existingWithEvidence.map(({ evidence_refs: _evidenceRefs, ...candidate }) => candidate);
    await assertRunnable(deps, lease, signal);
    const pool = await discoverCandidates({
      run_id: lease.run_id,
      brief: brief.brief,
      providers,
      model: deps.model(lease, operations),
      operations,
      existing,
      canUseExisting: async (candidate) => authorizedExisting.has(candidate.candidate_id),
      admit: async (candidate) => { await assertRunnable(deps, lease, signal); await deps.repo.admitCandidate(lease, candidate); },
    });
    const cohort = chooseResearchCohort(brief.brief, pool.candidates);
    pool.coverage.selected = cohort.length;
    pool.coverage.not_selected = pool.candidates.filter((candidate) => candidate.identity !== null && !cohort.includes(candidate.candidate_id)).length;
    for (const mechanism of pool.coverage.mechanisms) {
      mechanism.selected = pool.candidates.filter((candidate) => cohort.includes(candidate.candidate_id) && candidate.mechanism_ids.includes(mechanism.mechanism_id)).length;
    }
    await assertRunnable(deps, lease, signal);
    await deps.repo.commitCohort(lease, cohort, pool.coverage);
    checkpoint = { version: 1, stage: "research", cohort, next_company: 0, completed_operation_keys: checkpoint.completed_operation_keys };
    await deps.repo.saveCheckpoint(lease, checkpoint);
    coverage = pool.coverage;
  }

  // A crash after commitCohort can leave the checkpoint in discovery. The
  // persisted ordinal is the authority and prevents re-running Scout.
  const selected = await selectedCandidates(deps, lease);
  if (checkpoint.stage !== "research" || !sameOrder(checkpoint.cohort, selected.map((candidate) => candidate.candidate_id))) {
    checkpoint = { version: 1, stage: "research", cohort: selected.map((candidate) => candidate.candidate_id), next_company: 0, completed_operation_keys: checkpoint.completed_operation_keys };
    await deps.repo.saveCheckpoint(lease, checkpoint);
  }

  let incomplete = false;
  for (let index = checkpoint.next_company; index < selected.length; index += 1) {
    const candidate = selected[index]!;
    if (candidate.assessment === null && candidate.state === "researching") {
      try {
        await researchCompany(deps, lease, candidate, brief.brief, providers, operations, signal);
      } catch (error) {
        if (isControl(error)) throw error;
        incomplete = true;
        const code = failureCode(error);
        await assertRunnable(deps, lease, signal);
        await deps.repo.failCandidate(lease, candidate.candidate_id, code);
        addGap(coverage, code, candidate.candidate_id, errorMessage(error));
      }
    }
    checkpoint = { ...checkpoint, next_company: index + 1 };
    await assertRunnable(deps, lease, signal);
    await deps.repo.saveCheckpoint(lease, checkpoint);
  }

  const finalCandidates = await deps.repo.candidates(lease.user_id, lease.run_id);
  reconcileCoverage(coverage, finalCandidates, selected.map((candidate) => candidate.candidate_id));
  incomplete ||= coverage.gaps.length > 0 || finalCandidates.some((candidate) => candidate.state === "research_error");
  const assessed = finalCandidates.filter((candidate) => candidate.assessment !== null).length;
  const systemicFailures = finalCandidates.filter((candidate) => candidate.ordinal !== null && candidate.state === "research_error" && candidate.reason_codes.some((code) => code.startsWith("systemic:"))).length;
  const status: StageOutcome["status"] = selected.length > 0 && assessed === 0 && systemicFailures === selected.length
    ? "failed"
    : incomplete ? "partial" : "completed";
  return Object.freeze({ coverage, status });
}

async function researchCompany(
  deps: WorkerDeps,
  lease: Lease,
  candidate: StoredCandidate,
  brief: Parameters<typeof assessCompany>[0]["brief"],
  providers: ReturnType<WorkerDeps["providers"]>,
  operations: ReturnType<typeof createOperationRunner>,
  signal: AbortSignal,
): Promise<void> {
  if (candidate.identity === null) throw new Error("selected candidate is unresolved");
  const stored = await deps.repo.loadResearchPacket(lease, candidate.candidate_id);
  const packet = stored?.packet ?? await acquirePacket(deps, lease, candidate, brief, providers, operations, signal);
  if (stored === null) await deps.repo.saveResearchPacket(lease, packet);
  // Postgres jsonb normalizes object ordering. Reload before the first model
  // call so its exact serialized prompt is the same one used after restart.
  const original = (await deps.repo.loadResearchPacket(lease, candidate.candidate_id))?.packet;
  if (original === undefined) throw new Error("durable research packet was not saved");
  await assertRunnable(deps, lease, signal);
  const decision = await assessCompany({
    run_id: lease.run_id,
    brief,
    packet: original,
    model: deps.model(lease, operations),
    as_of: immutablePacketAsOf(original),
    persistQuotes: (raw, visiblePacket, request) => deps.persistQuotes(lease, visiblePacket, raw, request),
    reloadPacket: () => deps.repo.refreshResearchPacket(lease, original),
    saveValidatedRole: (role) => deps.repo.saveValidatedRole(lease, candidate.candidate_id, role),
    loadValidatedRoles: () => deps.repo.loadValidatedRoles(lease, candidate.candidate_id),
  });
  await assertRunnable(deps, lease, signal);
  // The original packet remains the immutable model request. A fresh packet
  // supplies current source visibility plus quote claims minted after that
  // request for the fenced seal transaction.
  const sealPacket = await deps.repo.refreshResearchPacket(lease, original);
  await deps.commitAssessment(lease, sealPacket, decision);
}

async function acquirePacket(
  deps: WorkerDeps,
  lease: Lease,
  candidate: StoredCandidate,
  brief: Parameters<typeof assessCompany>[0]["brief"],
  providers: ReturnType<WorkerDeps["providers"]>,
  operations: ReturnType<typeof createOperationRunner>,
  signal: AbortSignal,
): Promise<EvidencePacket> {
  if (candidate.identity === null) throw new Error("cannot acquire an unresolved candidate");
  const identity = candidate.identity;
  await assertRunnable(deps, lease, signal);
  const base = `${lease.run_id}/research/${candidate.candidate_id}`;
  const as_of = deps.clock().toISOString();
  const evidence = await providers.evidence.acquire({
    operation_key: `${base}/evidence`,
    request_hash: requestHash({ kind: "research-evidence-v1", run_id: lease.run_id, candidate_id: candidate.candidate_id, identity, brief }),
    phase: "research", candidate_id: candidate.candidate_id, brief, candidate, as_of,
  }, operations);
  await assertRunnable(deps, lease, signal);
  const financial = await operations.run({
    key: `${base}/financial`,
    request_hash: requestHash({ kind: "research-financial-v1", run_id: lease.run_id, candidate_id: candidate.candidate_id, identity, as_of }),
    resource: "financial", phase: "research", candidate_id: candidate.candidate_id,
    execute: () => providers.financials.read({
      operation_key: `${base}/financial`,
      request_hash: requestHash({ kind: "financial-provider-v1", run_id: lease.run_id, candidate_id: candidate.candidate_id, identity, as_of }),
      phase: "research", candidate_id: candidate.candidate_id, identity, as_of,
    }, operations),
  });
  let counterSearchCompleted = false;
  const gaps = [...evidence.coverage_gaps, ...financial.coverage_gaps, ...financial.missing_fields.map((field) => `financial_missing:${field}`)];
  try {
    await assertRunnable(deps, lease, signal);
    await providers.search.search({
      operation_key: `${base}/counter-search`,
      request_hash: requestHash({ kind: "research-counter-search-v1", run_id: lease.run_id, candidate_id: candidate.candidate_id, issuer_id: identity.issuer_id }),
      phase: "research", candidate_id: candidate.candidate_id,
      query: `${identity.legal_name} risks competition customer delay`, query_index: 0,
    }, operations);
    counterSearchCompleted = true;
  } catch (error) {
    if (isControl(error)) throw error;
    gaps.push("counter_search_unavailable");
  }
  return Object.freeze({
    ...evidence,
    facts: [...evidence.facts, ...financial.facts],
    counter_search_completed: counterSearchCompleted,
    coverage_gaps: [...new Set(gaps)],
  });
}

async function selectedCandidates(deps: WorkerDeps, lease: Lease): Promise<StoredCandidate[]> {
  return (await deps.repo.candidates(lease.user_id, lease.run_id))
    .filter((candidate) => candidate.ordinal !== null)
    .sort((left, right) => left.ordinal! - right.ordinal!);
}

async function assertRunnable(deps: WorkerDeps, lease: Lease, signal: AbortSignal) {
  if (signal.aborted) throw signal.reason ?? new DOMException("Discovery worker stopped", "AbortError");
  const run = await deps.repo.readRun(lease.user_id, lease.run_id);
  if (run.cancel_requested_at !== null) throw new DiscoveryError("cancelled", "run cancellation was requested");
  if (run.status !== "running") throw new DiscoveryError("lease_lost", "run is no longer running");
  if (run.started_at !== null && deps.clock().getTime() >= Date.parse(run.started_at) + run.limits.run_timeout_ms) {
    throw new DiscoveryError("deadline_exceeded", "run deadline has elapsed");
  }
  return run;
}

function reconcileCoverage(coverage: Coverage, candidates: StoredCandidate[], cohort: string[]): void {
  coverage.selected = cohort.length;
  coverage.assessed = candidates.filter((candidate) => candidate.assessment !== null).length;
  coverage.not_selected = candidates.filter((candidate) => candidate.state === "not_selected").length;
  coverage.mechanisms = coverage.mechanisms.map((mechanism) => ({
    ...mechanism,
    selected: candidates.filter((candidate) => cohort.includes(candidate.candidate_id) && candidate.mechanism_ids.includes(mechanism.mechanism_id)).length,
    assessed: candidates.filter((candidate) => candidate.assessment !== null && candidate.mechanism_ids.includes(mechanism.mechanism_id)).length,
  }));
}

function sameOrder(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isControl(error: unknown): boolean {
  return error instanceof DiscoveryError && ["operation_in_progress", "lease_lost", "cancelled", "budget_exhausted", "deadline_exceeded"].includes(error.code);
}
function failureCode(error: unknown): string {
  const systemic = systemicFailureCode(error);
  if (systemic !== null) return `systemic:${systemic}`;
  return "company_research_failed";
}
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }

/** Persist only errors whose provider or router family can disable every company. */
function systemicFailureCode(error: unknown): string | null {
  if (error instanceof DiscoveryError && error.code === "unavailable") return "discovery_unavailable";
  if (error instanceof ProviderRequestError) return `provider_${error.code}`;
  if (error instanceof LlmProviderError) return `model_${error.code}`;
  if (error instanceof LlmRouterError) return `model_router_${error.code}`;
  return null;
}

function immutablePacketAsOf(packet: EvidencePacket): string {
  const observations = [...packet.excerpts.map((excerpt) => excerpt.retrieved_at), ...packet.facts.map((fact) => fact.as_of)]
    .filter((value) => Number.isFinite(Date.parse(value)))
    .sort();
  const asOf = observations.at(-1);
  if (asOf === undefined) throw new Error("immutable research packet has no valid observation time");
  return new Date(asOf).toISOString();
}

export function rankedDecisions(candidates: StoredCandidate[]) {
  return rankShortlist(candidates.flatMap((candidate) => candidate.assessment === null ? [] : [candidate.assessment]));
}

/** Reconciles persisted candidate work into terminal coverage after an interrupted stage. */
export function reconciledCoverage(coverage: Coverage, candidates: StoredCandidate[]): Coverage {
  const reconciled = structuredClone(coverage);
  reconcileCoverage(reconciled, candidates, candidates
    .filter((candidate) => candidate.ordinal !== null)
    .sort((left, right) => left.ordinal! - right.ordinal!)
    .map((candidate) => candidate.candidate_id));
  return reconciled;
}
