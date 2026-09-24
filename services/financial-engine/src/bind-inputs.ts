// Binds every reported-metric slot of a run's plan to immutable evidence in
// one consistent read (REPEATABLE READ) and persists the bindings — bound
// payloads or explicit gaps — with the authorized candidate-set digest. A
// retry reuses the persisted bindings; evidence that arrives later requires an
// explicit recalculation (a new run), never substitution.

import {
  canonicalDecimalString,
  hashCanonical,
  multiplyRationals,
  parseDerivedDecimalText,
  rationalFromDecimal,
  rationalToValue,
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
import type { FinancialEvidencePort, InputCandidate, SqlExecutor } from "./ports.ts";
import { SELECTION_POLICY_VERSION, selectInput, type SlotSelection } from "./select-inputs.ts";

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

export class FinancialBindingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FinancialBindingError";
  }
}

export async function bindPlanInputs(input: {
  client: SqlExecutor;
  run_id: string;
  plan: FinancialPlanV1;
  authority: FinancialRuntimeAuthority;
  evidence: (executor: SqlExecutor) => FinancialEvidencePort;
}): Promise<BindingResult> {
  const { client, plan, authority } = input;
  await client.query("begin isolation level repeatable read");
  try {
    const run = (await client.query<{ user_id: string; plan_id: string; knowledge_cutoff: string; execution_state: string }>(
      `select user_id::text, plan_id::text, to_char(knowledge_cutoff at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as knowledge_cutoff, execution_state
         from financial_runs where run_id = $1 for update`,
      [input.run_id],
    )).rows[0];
    if (!run || run.user_id !== authority.owner_user_id) throw new FinancialBindingError("run not found for this owner");
    if (run.plan_id !== plan.plan_id) throw new FinancialBindingError("plan does not belong to this run");
    if (["completed", "failed", "cancelled"].includes(run.execution_state)) throw new FinancialBindingError(`run is ${run.execution_state}`);
    if (Date.parse(run.knowledge_cutoff) !== Date.parse(plan.time.knowledge_cutoff)) throw new FinancialBindingError("run cutoff differs from its plan");

    const existing = await loadBindings(client, input.run_id);
    if (existing.size > 0) {
      await client.query("commit");
      return { run_id: input.run_id, reused: true, bindings: existing };
    }

    const evidence = input.evidence(client);
    const bindings = new Map<LocalId, InputBinding>();
    let candidateBudget = plan.limits.max_input_candidates;
    for (const node of plan.operations) {
      if (node.operation !== "reported_metric") continue;
      const slot = plan.subjects.members.find((member) => member.slot_id === node.subject_slot)!;
      let candidates: ReadonlyArray<InputCandidate> = [];
      let selection: SlotSelection;
      let truncated = false;
      if (candidateBudget <= 0) {
        selection = { status: "gap", reason_code: "scope_limit_exceeded" };
      } else {
        const page = await evidence.listInputCandidates({
          authority,
          subject: slot.subject_ref,
          metric_key: node.metric_key,
          fiscal_year: node.period.kind === "fiscal_period" ? node.period.fiscal_year : null,
          fiscal_period: node.period.kind === "fiscal_period" ? node.period.fiscal_period : null,
          limit: candidateBudget,
        });
        if (page.status === "error") throw new FinancialBindingError(`evidence unavailable (${page.reason_code})`);
        candidates = page.candidates;
        truncated = page.truncated;
        candidateBudget -= candidates.length;
        selection = selectInput(node, candidates, {
          knowledge_cutoff: plan.time.knowledge_cutoff,
          reporting_basis: plan.policies.reporting_basis,
          max_age_days: plan.policies.freshness.max_age_days,
        }, { truncated });
      }
      const digest = candidateSetDigest(node.node_id, candidates, truncated);
      const binding = selection.status === "selected"
        ? boundBinding(node, slot, plan, selection, digest)
        : { slot: node.node_id, status: "gap" as const, reason_code: selection.reason_code, candidate_set_digest: digest };
      await persistBinding(client, input.run_id, binding, candidates.length, truncated);
      bindings.set(node.node_id, binding);
    }
    await client.query(`update financial_runs set bound_at = now(), updated_at = now() where run_id = $1`, [input.run_id]);
    await client.query("commit");
    return { run_id: input.run_id, reused: false, bindings };
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
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
  selection: Extract<SlotSelection, { status: "selected" }>,
  digest: Sha256Hex,
): InputBinding {
  const { candidate, publication } = selection;
  const context = candidate.context!;
  const precision = candidate.precision!;
  const definition = plan.metric_definitions.find((entry) => entry.metric_key === node.metric_key)!;
  const value = canonical(candidate.value_text);
  const scale = canonical(candidate.scale_text);
  const payload = {
    schema_version: "financial_bound_input.v1",
    input_slot: node.node_id,
    fact_id: candidate.fact_id,
    subject_ref: slot.subject_ref,
    metric: { metric_key: node.metric_key, definition_version: definition.definition_version },
    source: { source_id: candidate.source_id, document_id: null, source_version_hash: candidate.source_version_hash, locator: precision.source_locator },
    numeric: { raw_token: precision.raw_token, token_proof_hash: precision.token_proof_hash, value, scale, native_value: nativeValue(value, scale) },
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
    throw new FinancialBindingError(`bound input for ${node.node_id} is invalid: ${validated.issues.map((issue) => `${issue.path} ${issue.message}`).join("; ")}`);
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

async function persistBinding(client: SqlExecutor, runId: string, binding: InputBinding, candidateCount: number, truncated: boolean): Promise<void> {
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
    if (!validated.ok) throw new FinancialBindingError(`persisted binding ${row.input_slot} is invalid`);
    if (hashCanonical("bound_input", validated.value) !== row.payload_hash) throw new FinancialBindingError(`persisted binding ${row.input_slot} does not match its hash`);
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

function canonical(text: string): string {
  const parsed = parseDerivedDecimalText(text);
  if (!parsed.ok) throw new FinancialBindingError(`stored numeric ${JSON.stringify(text)} is not a supported decimal`);
  return canonicalDecimalString(parsed.value);
}

function nativeValue(value: string, scale: string): string {
  const product = multiplyRationals(toRational(value), toRational(scale));
  const represented = product === null ? null : rationalToValue(product);
  if (represented === null || !represented.exact) throw new FinancialBindingError("value x scale exceeds numeric limits");
  return canonicalDecimalString(represented.value);
}

function toRational(text: string) {
  const parsed = parseDerivedDecimalText(text);
  const rational = parsed.ok ? rationalFromDecimal(parsed.value) : null;
  if (rational === null) throw new FinancialBindingError(`numeric ${JSON.stringify(text)} exceeds numeric limits`);
  return rational;
}
