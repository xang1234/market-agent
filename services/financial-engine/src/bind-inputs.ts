// Binds every reported-metric slot of a run's plan to immutable evidence in
// one consistent read (REPEATABLE READ, under the run's lease fence) and
// persists the bindings — bound payloads or explicit gaps — with the
// authorized candidate-set digest. A retry reuses the persisted bindings;
// evidence that arrives later requires an explicit recalculation (a new run),
// never substitution.

import {
  hashCanonical,
  validateBoundInput,
  type BoundFinancialInputV1,
  type FinancialPlanV1,
  type FinancialRuntimeAuthority,
  type LocalId,
  type ReasonCode,
  type ReportedMetricNode,
  type Sha256Hex,
  type SubjectSlot,
} from "../../financial-core/src/index.ts";
import { ExecutionIntegrityError } from "./errors.ts";
import { appendRunEvent } from "./events-repo.ts";
import { fencedTransaction, type FencedTx, type RunLease } from "./lease.ts";
import type { FinancialEvidencePort, InputCandidate, SqlExecutor } from "./ports.ts";
import { SELECTION_POLICY_VERSION, selectInput, type SelectedInput } from "./select-inputs.ts";

export type InputBinding =
  | {
      slot: LocalId;
      status: "bound";
      input: BoundFinancialInputV1;
      payload_hash: Sha256Hex;
      precision_attestation_id: string;
      candidate_set_digest: Sha256Hex;
    }
  | { slot: LocalId; status: "gap"; reason_code: ReasonCode; candidate_set_digest: Sha256Hex };

export type BindingResult = { run_id: string; reused: boolean; bindings: ReadonlyMap<LocalId, InputBinding> };

type SlotOutcome = { binding: InputBinding; candidate_count: number; truncated: boolean };

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
    const bindings = new Map<LocalId, InputBinding>();
    let candidateBudget = plan.limits.max_input_candidates;
    for (const node of plan.operations) {
      if (node.operation !== "reported_metric") continue;
      const outcome = await bindSlot(tx, node, { plan, authority, evidence, candidate_budget: candidateBudget });
      candidateBudget -= outcome.candidate_count;
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
 * Reads and selects one slot's evidence. A failed read is an execution-error
 * gap for this slot, never absent evidence; the savepoint keeps the binding
 * transaction usable after a database error.
 */
async function bindSlot(
  { client }: FencedTx,
  node: ReportedMetricNode,
  context: { plan: FinancialPlanV1; authority: FinancialRuntimeAuthority; evidence: FinancialEvidencePort; candidate_budget: number },
): Promise<SlotOutcome> {
  const { plan } = context;
  const gapOutcome = (reason: ReasonCode): SlotOutcome => ({
    binding: { slot: node.node_id, status: "gap", reason_code: reason, candidate_set_digest: candidateSetDigest(node.node_id, [], false) },
    candidate_count: 0,
    truncated: false,
  });
  if (context.candidate_budget <= 0) return gapOutcome("scope_limit_exceeded");

  const slot = plan.subjects.members.find((member) => member.slot_id === node.subject_slot)!;
  await client.query("savepoint evidence_read");
  const page = await context.evidence.listInputCandidates({
    authority: context.authority,
    subject: slot.subject_ref,
    metric_key: node.metric_key,
    fiscal_year: node.period.kind === "fiscal_period" ? node.period.fiscal_year : null,
    fiscal_period: node.period.kind === "fiscal_period" ? node.period.fiscal_period : null,
    limit: context.candidate_budget,
  });
  if (page.status === "error") {
    await client.query("rollback to savepoint evidence_read");
    return gapOutcome(page.reason_code);
  }
  await client.query("release savepoint evidence_read");

  const selection = selectInput(node, page.candidates, {
    knowledge_cutoff: plan.time.knowledge_cutoff,
    reporting_basis: plan.policies.reporting_basis,
    max_age_days: plan.policies.freshness.max_age_days,
  }, { truncated: page.truncated });
  const digest = candidateSetDigest(node.node_id, page.candidates, page.truncated);
  return {
    binding: selection.status === "selected"
      ? boundBinding(node, slot, plan, selection.input, digest)
      : { slot: node.node_id, status: "gap", reason_code: selection.reason_code, candidate_set_digest: digest },
    candidate_count: page.candidates.length,
    truncated: page.truncated,
  };
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

function boundBinding(node: ReportedMetricNode, slot: SubjectSlot, plan: FinancialPlanV1, selected: SelectedInput, digest: Sha256Hex): InputBinding {
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
    basis: { reporting: plan.policies.reporting_basis, adjustment: context.adjustment_basis, share_basis: context.share_basis },
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
  return {
    slot: node.node_id,
    status: "bound",
    input: validated.value,
    payload_hash: hashCanonical("bound_input", validated.value),
    precision_attestation_id: precision.precision_attestation_id,
    candidate_set_digest: digest,
  };
}

async function persistBinding(client: SqlExecutor, runId: string, { binding, candidate_count: candidateCount, truncated }: SlotOutcome): Promise<void> {
  if (binding.status === "bound") {
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
        SELECTION_POLICY_VERSION,
        binding.candidate_set_digest,
        candidateCount,
        truncated,
      ],
    );
    return;
  }
  await client.query(
    `insert into financial_run_inputs (run_id, input_slot, binding_status, gap_reason, selection_policy_version, candidate_set_digest, candidate_count, truncated)
     values ($1, $2, 'gap', $3, $4, $5, $6, $7)`,
    [runId, binding.slot, binding.reason_code, SELECTION_POLICY_VERSION, binding.candidate_set_digest, candidateCount, truncated],
  );
}

export async function loadBindings(client: SqlExecutor, runId: string): Promise<Map<LocalId, InputBinding>> {
  const rows = (await client.query<{
    input_slot: string;
    binding_status: "bound" | "gap";
    bound_payload: unknown;
    payload_hash: string | null;
    precision_attestation_id: string | null;
    gap_reason: ReasonCode | null;
    candidate_set_digest: string;
  }>(
    `select input_slot, binding_status, bound_payload, payload_hash, precision_attestation_id::text, gap_reason, candidate_set_digest
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
    bindings.set(row.input_slot, {
      slot: row.input_slot,
      status: "bound",
      input: validated.value,
      payload_hash: row.payload_hash!,
      precision_attestation_id: row.precision_attestation_id!,
      candidate_set_digest: row.candidate_set_digest,
    });
  }
  return bindings;
}
