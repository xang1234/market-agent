// Binds every reported-metric slot of a run's plan to immutable evidence in
// one consistent read (REPEATABLE READ, under the run's lease fence) and
// persists the bindings — bound payloads or explicit gaps — with the
// authorized candidate-set digest. A retry reuses the persisted bindings;
// evidence that arrives later requires an explicit recalculation (a new run),
// never substitution.

import {
  BOUND_INPUT_SCHEMA_VERSION,
  BOUND_PRICE_INPUT_SCHEMA_VERSION,
  ExecutionIntegrityError,
  hashCanonical,
  resolveMetricDefinition,
  validateBoundInput,
  type BoundFactInputV1,
  type BoundPriceInputV1,
  type FinancialPlanV1,
  type FinancialRuntimeAuthority,
  type LocalId,
  type ReasonCode,
  type ReportedMetricNode,
  type Sha256Hex,
  type SubjectSlot,
} from "../../financial-core/src/index.ts";
import { appendRunEvent } from "./events-repo.ts";
import { fencedTransaction, type FencedTx, type RunLease } from "./lease.ts";
import type { FinancialEvidencePort, InputCandidate, PriceObservation, SplitHistory, SqlExecutor } from "./ports.ts";
import {
  boundBasis,
  isShareCount,
  SELECTION_POLICY_VERSION,
  selectInput,
  sharedLatestPeriods,
  type BoundBasis,
  type LatestPeriod,
  type SelectedInput,
  type SelectionPolicy,
} from "./select-inputs.ts";
import { PRICE_SELECTION_POLICY_VERSION, selectPrice, type PriceSelection } from "./select-price.ts";

export type InputBinding =
  | {
      slot: LocalId;
      status: "bound";
      input: BoundFactInputV1;
      payload_hash: Sha256Hex;
      precision_attestation_id: string;
      candidate_set_digest: Sha256Hex;
    }
  | { slot: LocalId; status: "bound"; input: BoundPriceInputV1; payload_hash: Sha256Hex; candidate_set_digest: Sha256Hex }
  | { slot: LocalId; status: "gap"; reason_code: ReasonCode; candidate_set_digest: Sha256Hex };

export type BindingResult = { run_id: string; reused: boolean; bindings: ReadonlyMap<LocalId, InputBinding> };

type SlotOutcome = { binding: InputBinding; candidate_count: number; truncated: boolean; selection_policy_version: string };

/** One slot's candidate page, or the gap its read already is. */
type SlotRead =
  | { node: ReportedMetricNode; status: "read"; candidates: ReadonlyArray<InputCandidate>; truncated: boolean }
  | { node: ReportedMetricNode; status: "gap"; reason_code: ReasonCode };

export async function bindPlanInputs(input: {
  client: SqlExecutor;
  lease: RunLease;
  plan: FinancialPlanV1;
  authority: FinancialRuntimeAuthority;
  evidence: (executor: SqlExecutor) => FinancialEvidencePort;
}): Promise<BindingResult> {
  const { plan, authority } = input;
  // The fence locks the run row: a stale, superseded, or cancelled worker cannot bind.
  return fencedTransaction(input.client, input.lease, async (tx) => {
    const runId = tx.run.run_id;
    if (tx.run.user_id !== authority.owner_user_id) throw new ExecutionIntegrityError("run not found for this owner");
    if (tx.run.plan_id !== plan.plan_id) throw new ExecutionIntegrityError("plan does not belong to this run");
    if (Date.parse(tx.run.knowledge_cutoff) !== Date.parse(plan.time.knowledge_cutoff)) throw new ExecutionIntegrityError("run cutoff differs from its plan");

    const existing = await loadBindings(tx.client, runId);
    if (existing.size > 0) return { run_id: runId, reused: true, bindings: existing };

    const evidence = input.evidence(tx.client);
    // Every page is read before any slot is selected: "latest" is one period per
    // subject across the plan's latest nodes, so no node can resolve alone.
    const reads: SlotRead[] = [];
    const priceNodes: ReportedMetricNode[] = [];
    let candidateBudget = plan.limits.max_input_candidates;
    for (const node of plan.operations) {
      if (node.operation !== "reported_metric") continue;
      if (resolveMetricDefinition(node.metric_key)?.value_kind === "price") {
        priceNodes.push(node);
        continue;
      }
      const read = await readSlot(tx, node, { authority, evidence, plan, candidate_budget: candidateBudget });
      if (read.status === "read") candidateBudget -= read.candidates.length;
      reads.push(read);
    }
    const policy: SelectionPolicy = {
      knowledge_cutoff: plan.time.knowledge_cutoff,
      reporting_basis: plan.policies.reporting_basis,
      max_age_days: plan.policies.freshness.max_age_days,
      allowed_source_classes: authority.allowed_source_classes,
    };
    const latest = sharedLatestPeriods(reads.map((read) => read.status === "gap"
      ? { node: read.node, candidates: [], incomplete: read.reason_code }
      : { node: read.node, candidates: read.candidates, ...(read.truncated ? { incomplete: "scope_limit_exceeded" as const } : {}) }), policy);
    const histories = await readSplitHistories(tx, plan, reads, priceNodes, evidence);
    const bindings = new Map<LocalId, InputBinding>();
    for (const read of reads) {
      const outcome = selectSlot(read, plan, policy, latest.get(read.node.node_id) ?? null, histories.get(read.node.subject_slot));
      await persistBinding(tx.client, runId, outcome);
      bindings.set(read.node.node_id, outcome.binding);
    }
    for (const node of priceNodes) {
      const outcome = await bindPriceSlot(tx, node, plan, policy, histories.get(node.subject_slot), evidence);
      await persistBinding(tx.client, runId, outcome);
      bindings.set(node.node_id, outcome.binding);
    }
    await tx.client.query(`update financial_runs set bound_at = now(), updated_at = now() where run_id = $1`, [runId]);
    const boundCount = [...bindings.values()].filter((binding) => binding.status === "bound").length;
    await appendRunEvent(tx.client, runId, "inputs_bound", { payload: { bound_count: boundCount, gap_count: bindings.size - boundCount } });
    return { run_id: runId, reused: false, bindings };
  }, { isolation: "repeatable read" });
}

/**
 * Reads one slot's evidence. A failed read is an execution-error gap for this
 * slot, never absent evidence; the savepoint keeps the binding transaction
 * usable after a database error.
 */
async function readSlot(
  { client }: FencedTx,
  node: ReportedMetricNode,
  context: { plan: FinancialPlanV1; authority: FinancialRuntimeAuthority; evidence: FinancialEvidencePort; candidate_budget: number },
): Promise<SlotRead> {
  if (context.candidate_budget <= 0) return { node, status: "gap", reason_code: "scope_limit_exceeded" };
  const slot = subjectSlot(context.plan, node);
  // A share count is current only while it is the latest filing's, so every filing's is read.
  const period = node.period.kind === "fiscal_period" && !isShareCount(node.metric_key) ? node.period : null;
  await client.query("savepoint evidence_read");
  const page = await context.evidence.listInputCandidates({
    authority: context.authority,
    subject: slot.subject_ref,
    metric_key: node.metric_key,
    fiscal_year: period?.fiscal_year ?? null,
    fiscal_period: period?.fiscal_period ?? null,
    limit: context.candidate_budget,
  });
  if (page.status === "error") {
    await client.query("rollback to savepoint evidence_read");
    return { node, status: "gap", reason_code: page.reason_code };
  }
  await client.query("release savepoint evidence_read");
  return { node, status: "read", candidates: page.candidates, truncated: page.truncated };
}

/**
 * The split history of each subject with an as-filed candidate or a share
 * price, read once. Like a candidate read, a failed read is that subject's
 * execution-error gap.
 */
async function readSplitHistories(
  { client }: FencedTx,
  plan: FinancialPlanV1,
  reads: ReadonlyArray<SlotRead>,
  priceNodes: ReadonlyArray<ReportedMetricNode>,
  evidence: FinancialEvidencePort,
): Promise<ReadonlyMap<LocalId, SplitHistory>> {
  const restated = new Set([
    ...reads.flatMap((read) =>
      read.status === "read" && read.candidates.some((candidate) => candidate.context?.adjustment_basis === "as_filed") ? [read.node.subject_slot] : []),
    ...priceNodes.map((node) => node.subject_slot),
  ]);
  const histories = new Map<LocalId, SplitHistory>();
  for (const member of plan.subjects.members) {
    if (!restated.has(member.slot_id)) continue;
    await client.query("savepoint split_history_read");
    const history = await evidence.readSplitHistory({ subject: member.subject_ref, as_of: plan.time.knowledge_cutoff });
    const failed = history.status === "gap" && history.reason_code === "database_error";
    await client.query(failed ? "rollback to savepoint split_history_read" : "release savepoint split_history_read");
    histories.set(member.slot_id, history);
  }
  return histories;
}

function selectSlot(read: SlotRead, plan: FinancialPlanV1, policy: SelectionPolicy, latestPeriod: LatestPeriod, history: SplitHistory | undefined): SlotOutcome {
  const { node } = read;
  if (read.status === "gap") {
    return {
      binding: { slot: node.node_id, status: "gap", reason_code: read.reason_code, candidate_set_digest: candidateSetDigest(node.node_id, [], false) },
      candidate_count: 0,
      truncated: false,
      selection_policy_version: SELECTION_POLICY_VERSION,
    };
  }
  const selection = selectInput(node, read.candidates, policy, { truncated: read.truncated }, latestPeriod);
  const digest = candidateSetDigest(node.node_id, read.candidates, read.truncated);
  const outcome = (binding: InputBinding): SlotOutcome =>
    ({ binding, candidate_count: read.candidates.length, truncated: read.truncated, selection_policy_version: SELECTION_POLICY_VERSION });
  const gap = (reason_code: ReasonCode): InputBinding => ({ slot: node.node_id, status: "gap", reason_code, candidate_set_digest: digest });
  if (selection.status === "gap") return outcome(gap(selection.reason_code));
  const basis = boundBasis(selection.input, history, plan.time.knowledge_cutoff);
  return outcome(basis.status === "gap" ? gap(basis.reason_code) : boundBinding(node, subjectSlot(plan, node), plan, selection.input, basis, digest));
}

/**
 * A share price slot binds its subject's one common-stock listing's latest
 * price known by the cutoff, restated to the listing's reference date. The
 * split history resolved that listing; a failed price read is an
 * execution-error gap, like a candidate read.
 */
async function bindPriceSlot(
  { client }: FencedTx,
  node: ReportedMetricNode,
  plan: FinancialPlanV1,
  policy: SelectionPolicy,
  history: SplitHistory | undefined,
  evidence: FinancialEvidencePort,
): Promise<SlotOutcome> {
  const outcome = (binding: InputBinding, observations: ReadonlyArray<PriceObservation>): SlotOutcome =>
    ({ binding, candidate_count: observations.length, truncated: false, selection_policy_version: PRICE_SELECTION_POLICY_VERSION });
  const gap = (reason_code: ReasonCode, observations: ReadonlyArray<PriceObservation> = []) =>
    outcome({ slot: node.node_id, status: "gap", reason_code, candidate_set_digest: priceCandidateSetDigest(node.node_id, observations) }, observations);
  // A price has no fiscal period: it is the latest known at the cutoff.
  if (node.period.kind !== "at_cutoff") return gap("unsupported_period");
  if (history === undefined || history.status === "gap") return gap(history?.reason_code ?? "split_history_missing");
  await client.query("savepoint price_read");
  const page = await evidence.readPriceObservations({ listing_id: history.listing_id, as_of: plan.time.knowledge_cutoff });
  await client.query(page.status === "error" ? "rollback to savepoint price_read" : "release savepoint price_read");
  if (page.status === "error") return gap(page.reason_code);
  const selection = selectPrice(page, history, policy);
  const digest = priceCandidateSetDigest(node.node_id, page.latest);
  if (selection.status === "gap") return gap(selection.reason_code, page.latest);
  return outcome(boundPriceBinding(node, subjectSlot(plan, node), plan, selection, digest), page.latest);
}

/** Digest of the price observations seen for a slot. */
function priceCandidateSetDigest(slot: LocalId, observations: ReadonlyArray<PriceObservation>): Sha256Hex {
  return hashCanonical("candidate_set", {
    slot,
    truncated: false,
    candidates: observations.map((observation) => ({ observation_id: observation.observation_id })).sort((left, right) => left.observation_id.localeCompare(right.observation_id)),
  });
}

function boundPriceBinding(
  node: ReportedMetricNode,
  slot: SubjectSlot,
  plan: FinancialPlanV1,
  selection: Extract<PriceSelection, { status: "selected" }>,
  digest: Sha256Hex,
): InputBinding {
  const { observation } = selection;
  const definition = plan.metric_definitions.find((entry) => entry.metric_key === node.metric_key)!;
  const validated = validateBoundInput({
    schema_version: BOUND_PRICE_INPUT_SCHEMA_VERSION,
    input_slot: node.node_id,
    observation_id: observation.observation_id,
    subject_ref: slot.subject_ref,
    metric: { metric_key: node.metric_key, definition_version: definition.definition_version },
    listing_id: observation.listing_id,
    source: { source_id: observation.source_id, body_sha256: observation.body_sha256 },
    observation_kind: observation.kind,
    numeric: { raw_token: observation.price_text, value: selection.value },
    unit: { kind: "currency_per_share", currency: observation.currency },
    observed_at: observation.observed_at,
    known_at: observation.known_at,
    split_adjustment: selection.split_adjustment,
    eligibility: { selection_policy_version: PRICE_SELECTION_POLICY_VERSION, candidate_set_digest: digest },
  });
  if (!validated.ok || validated.value.schema_version !== BOUND_PRICE_INPUT_SCHEMA_VERSION) {
    throw new ExecutionIntegrityError(`bound price for ${node.node_id} is invalid${validated.ok ? "" : `: ${validated.issues.map((issue) => `${issue.path} ${issue.message}`).join("; ")}`}`);
  }
  return { slot: node.node_id, status: "bound", input: validated.value, payload_hash: hashCanonical("bound_input", validated.value), candidate_set_digest: digest };
}

function subjectSlot(plan: FinancialPlanV1, node: ReportedMetricNode): SubjectSlot {
  return plan.subjects.members.find((member) => member.slot_id === node.subject_slot)!;
}

/** Digest of the authorized candidates seen for a slot: facts and the proofs attached to them. */
export function candidateSetDigest(slot: LocalId, candidates: ReadonlyArray<InputCandidate>, truncated: boolean): Sha256Hex {
  return hashCanonical("candidate_set", {
    slot,
    truncated,
    candidates: [...candidates]
      .sort((left, right) => left.fact_id.localeCompare(right.fact_id))
      .map((candidate) => ({
        fact_id: candidate.fact_id,
        precision_attestation_id: candidate.precision?.precision_attestation_id ?? null,
        publication_attestation_ids: candidate.publication.map((proof) => proof.attestation_id).sort(),
      })),
  });
}

function boundBinding(
  node: ReportedMetricNode,
  slot: SubjectSlot,
  plan: FinancialPlanV1,
  selected: SelectedInput,
  basis: Exclude<BoundBasis, { status: "gap" }>,
  digest: Sha256Hex,
): InputBinding {
  const { candidate, publication, numeric } = selected;
  const { context, precision } = candidate;
  const definition = plan.metric_definitions.find((entry) => entry.metric_key === node.metric_key)!;
  const payload = {
    schema_version: "financial_bound_input.v1",
    input_slot: node.node_id,
    fact_id: candidate.fact_id,
    subject_ref: slot.subject_ref,
    metric: { metric_key: node.metric_key, definition_version: definition.definition_version },
    source: { source_id: candidate.source_id, document_id: null, source_version_hash: candidate.source_version_hash, locator: precision.source_locator },
    numeric: { raw_token: precision.raw_token, token_proof_hash: precision.token_proof_hash, value: numeric.value, scale: numeric.scale, native_value: numeric.native_value },
    unit: candidate.unit,
    period: {
      kind: context.period_type,
      start: context.period_type === "instant" ? null : candidate.period.start,
      end: candidate.period.end,
      fiscal_year: candidate.period.fiscal_year,
      fiscal_period: candidate.period.fiscal_period,
      calendar_version: context.fiscal_calendar_version,
    },
    dimensions: { scope: context.dimension_scope, members: context.dimension_members.map((member) => ({ ...member })) },
    basis: {
      reporting: plan.policies.reporting_basis,
      adjustment: basis.status === "unadjusted" ? "unadjusted" : "split_adjusted",
      share_basis: context.share_basis,
    },
    ...(basis.status === "restated" ? { split_adjustment: basis.split_adjustment } : {}),
    publication: {
      attestation_id: publication.attestation_id,
      available_no_later_than: publication.available_no_later_than,
      precision: publication.timing_precision,
      source_timezone: publication.source_timezone,
    },
    observed_at: candidate.observed_at,
    precision_status: precision.precision_class,
    eligibility: {
      selection_policy_version: SELECTION_POLICY_VERSION,
      promotion_status: candidate.method === "extracted" ? "reviewed_extraction" : candidate.verification_status,
      candidate_set_digest: digest,
    },
  };
  const validated = validateBoundInput(payload);
  if (!validated.ok) {
    throw new ExecutionIntegrityError(`bound input for ${node.node_id} is invalid: ${validated.issues.map((issue) => `${issue.path} ${issue.message}`).join("; ")}`);
  }
  if (validated.value.schema_version === BOUND_PRICE_INPUT_SCHEMA_VERSION) throw new ExecutionIntegrityError(`bound input for ${node.node_id} is not a fact`);
  return {
    slot: node.node_id,
    status: "bound",
    input: validated.value,
    payload_hash: hashCanonical("bound_input", validated.value),
    precision_attestation_id: precision.precision_attestation_id,
    candidate_set_digest: digest,
  };
}

async function persistBinding(client: SqlExecutor, runId: string, outcome: SlotOutcome): Promise<void> {
  const { binding, candidate_count: candidateCount, truncated, selection_policy_version: policyVersion } = outcome;
  if (binding.status === "gap") {
    await client.query(
      `insert into financial_run_inputs (run_id, input_slot, binding_status, gap_reason, selection_policy_version, candidate_set_digest, candidate_count, truncated)
       values ($1, $2, 'gap', $3, $4, $5, $6, $7)`,
      [runId, binding.slot, binding.reason_code, policyVersion, binding.candidate_set_digest, candidateCount, truncated],
    );
    return;
  }
  if ("precision_attestation_id" in binding) {
    await client.query(
      `insert into financial_run_inputs (run_id, input_slot, binding_status, fact_id, publication_attestation_id, precision_attestation_id,
                                         bound_payload, payload_hash, selection_policy_version, candidate_set_digest, candidate_count, truncated)
       values ($1, $2, 'bound', $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11)`,
      [
        runId,
        binding.slot,
        binding.input.fact_id,
        binding.input.publication.attestation_id,
        binding.precision_attestation_id,
        JSON.stringify(binding.input),
        binding.payload_hash,
        policyVersion,
        binding.candidate_set_digest,
        candidateCount,
        truncated,
      ],
    );
    return;
  }
  await client.query(
    `insert into financial_run_inputs (run_id, input_slot, binding_status, price_observation_id, bound_payload, payload_hash,
                                       selection_policy_version, candidate_set_digest, candidate_count, truncated)
     values ($1, $2, 'bound', $3, $4::jsonb, $5, $6, $7, $8, $9)`,
    [runId, binding.slot, binding.input.observation_id, JSON.stringify(binding.input), binding.payload_hash, policyVersion, binding.candidate_set_digest, candidateCount, truncated],
  );
}

export async function loadBindings(client: SqlExecutor, runId: string): Promise<Map<LocalId, InputBinding>> {
  const rows = (await client.query<{
    input_slot: string;
    binding_status: "bound" | "gap";
    bound_payload: unknown;
    payload_hash: string | null;
    precision_attestation_id: string | null;
    price_observation_id: string | null;
    gap_reason: ReasonCode | null;
    candidate_set_digest: string;
  }>(
    `select input_slot, binding_status, bound_payload, payload_hash, precision_attestation_id::text, price_observation_id::text, gap_reason, candidate_set_digest
       from financial_run_inputs where run_id = $1 order by input_slot`,
    [runId],
  )).rows;
  const bindings = new Map<LocalId, InputBinding>();
  for (const row of rows) {
    if (row.binding_status === "gap") {
      bindings.set(row.input_slot, { slot: row.input_slot, status: "gap", reason_code: row.gap_reason!, candidate_set_digest: row.candidate_set_digest });
      continue;
    }
    const validated = validateBoundInput(row.bound_payload);
    if (!validated.ok) throw new ExecutionIntegrityError(`persisted binding ${row.input_slot} is invalid`);
    if (hashCanonical("bound_input", validated.value) !== row.payload_hash) throw new ExecutionIntegrityError(`persisted binding ${row.input_slot} does not match its hash`);
    const { value: input } = validated;
    const base = { slot: row.input_slot, status: "bound" as const, payload_hash: row.payload_hash!, candidate_set_digest: row.candidate_set_digest };
    if (input.schema_version === BOUND_INPUT_SCHEMA_VERSION && row.precision_attestation_id !== null) {
      bindings.set(row.input_slot, { ...base, input, precision_attestation_id: row.precision_attestation_id });
    } else if (input.schema_version === BOUND_PRICE_INPUT_SCHEMA_VERSION && row.price_observation_id === input.observation_id) {
      bindings.set(row.input_slot, { ...base, input });
    } else {
      throw new ExecutionIntegrityError(`persisted binding ${row.input_slot} does not match its evidence`);
    }
  }
  return bindings;
}
