import { buildClaimBackedSealInput, buildFactBackedSealInput, toSealFactRow, type SealToolCallRef } from "../../snapshot/src/seal-input.ts";
import { sealSnapshotInTransaction, snapshotTransactionClient, type SnapshotTransactionClient } from "../../snapshot/src/snapshot-sealer.ts";
import { mergeSealInputs } from "../../analyze/src/seal-input-merge.ts";
import type { EvidencePacket } from "./ports.ts";
import type { CandidateDecision, Citation } from "./types.ts";

export async function sealCandidateAssessment(
  tx: SnapshotTransactionClient,
  input: {
    snapshot_id: string;
    packet: EvidencePacket;
    decision: CandidateDecision;
    as_of: string;
    tool_calls: ReadonlyArray<SealToolCallRef>;
    model_version?: string | null;
  },
): Promise<string> {
  if (input.decision.candidate_id !== input.packet.candidate_id || input.decision.identity.issuer_id !== input.packet.identity.issuer_id) {
    throw new Error("assessment decision does not match the evidence packet identity");
  }
  const citations = decisionCitations(input.decision);
  const claimsById = new Map(input.packet.claims.map((claim) => [claim.claim_id, claim]));
  const factsById = new Map(input.packet.facts.map((fact) => [fact.fact_id, fact]));
  const claims = citations.filter((citation) => citation.kind === "claim").map((citation) => {
    const claim = claimsById.get(citation.id);
    if (claim === undefined) throw new Error(`assessment cites a claim missing from the packet: ${citation.id}`);
    return claim;
  });
  const facts = citations.filter((citation) => citation.kind === "fact").map((citation) => {
    const fact = factsById.get(citation.id);
    if (fact === undefined) throw new Error(`assessment cites a fact missing from the packet: ${citation.id}`);
    return fact;
  });
  const sourceRefs = unique([...claims.map((claim) => claim.source_id), ...facts.map((fact) => fact.source_id)]);
  const claimSeal = buildClaimBackedSealInput({
    block: {
      id: `campaign-assessment-${input.packet.candidate_id}`,
      kind: "rich_text",
      snapshot_id: input.snapshot_id,
      as_of: input.as_of,
      data_ref: { kind: "rich_text", id: input.packet.candidate_id },
      source_refs: sourceRefs,
      claim_refs: claims.map((claim) => claim.claim_id),
      document_refs: unique(claims.map((claim) => claim.document_id)),
      subject_refs: [{ kind: "issuer", id: input.packet.identity.issuer_id }],
      segments: [{ type: "decision", candidate_id: input.decision.candidate_id, state: input.decision.state, reason_codes: input.decision.reason_codes }],
    } as never,
    claims: claims.map((claim) => ({ claim_id: claim.claim_id, source_id: claim.source_id })),
    documents: uniqueBy(claims, (claim) => claim.document_id).map((claim) => ({ document_id: claim.document_id, source_id: claim.source_id })),
    subjectRefs: [{ kind: "issuer", id: input.packet.identity.issuer_id }],
    toolCalls: input.tool_calls,
    modelVersion: input.model_version,
  });
  const factSeals = facts.length === 0 ? [] : [buildFactBackedSealInput({
    block: {
      id: `campaign-assessment-facts-${input.packet.candidate_id}`,
      kind: "metric_row",
      snapshot_id: input.snapshot_id,
      as_of: input.as_of,
      data_ref: { kind: "metric_row", id: input.packet.candidate_id },
      source_refs: unique(facts.map((fact) => fact.source_id)),
      items: facts.map((fact) => ({ value_ref: fact.fact_id })),
    } as never,
    factRefs: facts.map((fact) => fact.fact_id),
    subjectRefs: [{ kind: "issuer", id: input.packet.identity.issuer_id }],
    facts: facts.map((fact) => toSealFactRow(fact)),
  })];
  const sealed = await sealSnapshotInTransaction(snapshotTransactionClient(tx), mergeSealInputs(claimSeal, factSeals));
  if (!sealed.ok) throw new Error(`assessment snapshot verification failed: ${JSON.stringify(sealed.verification.failures)}`);
  return sealed.snapshot.snapshot_id;
}

function decisionCitations(decision: CandidateDecision): Citation[] {
  const citations = [
    ...Object.values(decision.dimensions).flatMap((dimension) => dimension.citations),
    ...decision.criteria.flatMap((criterion) => criterion.citations),
    ...decision.counterarguments.flatMap((counterargument) => counterargument.citations),
  ];
  return uniqueBy(citations, (citation) => `${citation.kind}:${citation.id}`);
}

function unique(values: string[]): string[] { return [...new Set(values)]; }
function uniqueBy<T>(values: ReadonlyArray<T>, key: (value: T) => string): T[] {
  const result = new Map<string, T>();
  for (const value of values) result.set(key(value), value);
  return [...result.values()];
}
