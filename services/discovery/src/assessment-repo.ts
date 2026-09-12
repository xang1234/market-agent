import { randomUUID } from "node:crypto";

import type { QueryExecutor } from "../../agents/src/agent-repo.ts";
import type { SealToolCallRef } from "../../snapshot/src/seal-input.ts";
import type { Lease, ValidatedRoleCheckpoint } from "./ports.ts";
import { json, requireUuid, transaction } from "./repository-support.ts";
import { requestHash } from "./scout-support.ts";
import { sealCandidateAssessment } from "./seal.ts";
import { lockLiveLease } from "./worker-lock.ts";
import type { AssessedCandidate, CandidateDecision, Id } from "./types.ts";
import type { EvidencePacket } from "./ports.ts";
import { DiscoveryError } from "./types.ts";

type CandidateForAssessment = { candidate_id: string; issuer_id: string | null; state: string; assessment: unknown; snapshot_id: string | null };

export function createAssessmentCommitter(options: {
  db: QueryExecutor;
  clock: () => Date;
  newSnapshotId?: () => string;
}): (lease: Lease, packet: EvidencePacket, decision: CandidateDecision) => Promise<AssessedCandidate> {
  const newSnapshotId = options.newSnapshotId ?? randomUUID;
  return async (lease, packet, decision) => transaction(options.db, async (tx) => {
    await lockLiveLease(tx, lease, options.clock());
    const candidate = await lockCandidate(tx, lease, packet.candidate_id, packet.identity.issuer_id);
    if (candidate.state !== "researching" || candidate.assessment !== null || candidate.snapshot_id !== null) {
      if (candidate.assessment !== null && candidate.snapshot_id !== null && requestHash(candidate.assessment) === requestHash(decision)) {
        return { decision, snapshot_id: candidate.snapshot_id };
      }
      throw new DiscoveryError("request_conflict", "candidate is not available for assessment");
    }
    const citations = decisionCitations(decision);
    await requirePacketVisible(tx, lease.user_id, packet, citations);
    const tool_calls = await loadToolCalls(tx, lease, packet.candidate_id);
    const snapshot_id = await sealCandidateAssessment(tx as never, {
      snapshot_id: newSnapshotId(),
      packet,
      decision,
      as_of: packetAsOf(packet),
      tool_calls,
    });
    const updated = await tx.query(
      `update discovery_candidates
          set state=$3, assessment=$4::jsonb, snapshot_id=$5::uuid, rank=null, updated_at=now()
        where run_id=$1::uuid and candidate_id=$2::uuid and state='researching'`,
      [lease.run_id, packet.candidate_id, decision.state, json(decision), snapshot_id],
    );
    if (updated.rowCount !== 1) throw new DiscoveryError("request_conflict", "candidate assessment could not be committed");
    return { decision, snapshot_id };
  });
}

export async function saveValidatedRoleCheckpoint(
  db: QueryExecutor,
  lease: Lease,
  candidate_id: Id,
  checkpoint: ValidatedRoleCheckpoint,
  clock: () => Date,
): Promise<void> {
  requireUuid(candidate_id, "candidate_id");
  if (!/^sha256:[0-9a-f]{64}$/u.test(checkpoint.request_hash) || !/^sha256:[0-9a-f]{64}$/u.test(checkpoint.packet_hash)) {
    throw new DiscoveryError("validation", "validated role checkpoint hashes are invalid");
  }
  await transaction(db, async (tx) => {
    await lockLiveLease(tx, lease, clock());
    const candidate = await lockCandidate(tx, lease, candidate_id, undefined);
    if (candidate.state !== "researching" || candidate.assessment !== null || candidate.snapshot_id !== null) {
      throw new DiscoveryError("request_conflict", "candidate is not available for assessment");
    }
    const column = checkpoint.role === "analyst" ? "analyst_output" : "skeptic_output";
    const updated = await tx.query(
      `update discovery_candidates set ${column}=$3::jsonb,updated_at=now() where run_id=$1::uuid and candidate_id=$2::uuid and state='researching'`,
      [lease.run_id, candidate_id, json(checkpoint)],
    );
    if (updated.rowCount !== 1) throw new DiscoveryError("request_conflict", "candidate role checkpoint could not be saved");
  });
}

async function lockCandidate(tx: QueryExecutor, lease: Lease, candidateId: string, issuerId: string | undefined): Promise<CandidateForAssessment> {
  const { rows } = await tx.query<CandidateForAssessment>(
    `select candidate_id::text as candidate_id,issuer_id::text as issuer_id,state,assessment,snapshot_id::text as snapshot_id
       from discovery_candidates where run_id=$1::uuid and candidate_id=$2::uuid for update`,
    [lease.run_id, candidateId],
  );
  const candidate = rows[0];
  if (!candidate) throw new DiscoveryError("request_conflict", "candidate is not available for assessment");
  if (issuerId !== undefined && candidate.issuer_id !== issuerId) throw new DiscoveryError("request_conflict", "candidate issuer no longer matches the evidence packet");
  return candidate;
}

async function requirePacketVisible(
  tx: QueryExecutor,
  userId: string,
  packet: EvidencePacket,
  citations: ReadonlyArray<{ kind: "claim" | "fact"; id: string }>,
): Promise<void> {
  const claimIds = citations.filter((citation) => citation.kind === "claim").map((citation) => citation.id);
  const claims = new Map(packet.claims.map((claim) => [claim.claim_id, claim]));
  const citedClaims = claimIds.map((claimId) => claims.get(claimId)).filter((claim): claim is NonNullable<typeof claim> => claim !== undefined);
  if (citedClaims.length !== claimIds.length) throw new DiscoveryError("validation", "assessment cites a claim outside its evidence packet");
  const documentIds = unique(citedClaims.map((claim) => claim.document_id));
  if (documentIds.length > 0) {
    const { rows } = await tx.query<{ document_id: string; source_id: string }>(
      `select d.document_id::text as document_id,d.source_id::text as source_id
         from documents d join sources s on s.source_id=d.source_id
        where d.document_id=any($1::uuid[]) and d.deleted_at is null and (s.user_id is null or s.user_id=$2::uuid)`,
      [documentIds, userId],
    );
    const accessible = new Map(rows.map((row) => [row.document_id, row.source_id]));
    for (const claim of citedClaims) if (accessible.get(claim.document_id) !== claim.source_id) {
      throw new DiscoveryError("not_found", "cited evidence is no longer visible");
    }
  }
  const factIds = citations.filter((citation) => citation.kind === "fact").map((citation) => citation.id);
  const facts = new Map(packet.facts.map((fact) => [fact.fact_id, fact]));
  const citedFacts = factIds.map((factId) => facts.get(factId)).filter((fact): fact is NonNullable<typeof fact> => fact !== undefined);
  if (citedFacts.length !== factIds.length) throw new DiscoveryError("validation", "assessment cites a fact outside its evidence packet");
  const sourceIds = unique([...citedClaims.map((claim) => claim.source_id), ...citedFacts.map((fact) => fact.source_id)]);
  if (sourceIds.length === 0) return;
  const { rows } = await tx.query<{ source_id: string }>(
    "select source_id::text as source_id from sources where source_id=any($1::uuid[]) and (user_id is null or user_id=$2::uuid)",
    [sourceIds, userId],
  );
  if (new Set(rows.map((row) => row.source_id)).size !== sourceIds.length) throw new DiscoveryError("not_found", "assessment evidence source is no longer visible");
}

async function loadToolCalls(tx: QueryExecutor, lease: Lease, candidateId: string): Promise<SealToolCallRef[]> {
  const { rows } = await tx.query<{ tool_call_id: string | null; result_hash: string | null }>(
    `select tool_call_id::text as tool_call_id,result_hash from discovery_attempts
      where run_id=$1::uuid and candidate_id=$2::uuid and resource='model' and outcome='success'
        and tool_call_id is not null and result_hash is not null
      order by completed_at,attempt_id`,
    [lease.run_id, candidateId],
  );
  const toolCalls = rows.filter((row): row is { tool_call_id: string; result_hash: string } => row.tool_call_id !== null && row.result_hash !== null)
    .map((row) => ({ tool_call_id: row.tool_call_id, result_hash: row.result_hash }));
  if (toolCalls.length === 0) throw new DiscoveryError("unavailable", "assessment model provenance is unavailable for sealing");
  return toolCalls;
}

function packetAsOf(packet: EvidencePacket): string {
  const observations = [...packet.facts.map((fact) => fact.as_of), ...packet.excerpts.map((excerpt) => excerpt.retrieved_at)]
    .filter((value) => Number.isFinite(Date.parse(value))).sort();
  const as_of = observations.at(-1);
  if (as_of === undefined) throw new DiscoveryError("validation", "evidence packet has no valid observation time");
  return new Date(as_of).toISOString();
}

function decisionCitations(decision: CandidateDecision): { kind: "claim" | "fact"; id: string }[] {
  const citations = [...Object.values(decision.dimensions).flatMap((dimension) => dimension.citations), ...decision.criteria.flatMap((criterion) => criterion.citations), ...decision.counterarguments.flatMap((counterargument) => counterargument.citations)];
  const result = new Map<string, { kind: "claim" | "fact"; id: string }>();
  for (const citation of citations) result.set(`${citation.kind}:${citation.id}`, citation);
  return [...result.values()];
}

function unique(values: string[]): string[] { return [...new Set(values)]; }
