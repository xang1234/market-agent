import type { QueryExecutor } from "../../agents/src/agent-repo.ts";
import type { Lease, StoredCandidate } from "./ports.ts";
import { DiscoveryError, type CandidateDecision, type CandidateState, type CompanyIdentity, type Coverage, type DiscoveredCandidate } from "./types.ts";
import { json, jsonValue, requireUuid, transaction } from "./repository-support.ts";
import { lockLiveLease } from "./worker-lock.ts";

type CandidateRow = { candidate_id: string; lead_key: string; name: string; issuer_id: string | null; listing_id: string | null; identity_display: unknown; origins: unknown; mechanism_ids: unknown; seed: boolean; primary_domain_lead: boolean; first_seen: unknown; lead_hit_ids: unknown; reason_codes: unknown; state: CandidateState; selection_ordinal: number | null; assessment: unknown; snapshot_id: string | null; rank: number | null };
const CANDIDATE_COLUMNS = "candidate_id::text as candidate_id,lead_key,name,issuer_id::text as issuer_id,listing_id::text as listing_id,identity_display,origins,mechanism_ids,seed,primary_domain_lead,first_seen,lead_hit_ids,reason_codes,state,selection_ordinal,assessment,snapshot_id::text as snapshot_id,rank";

export function createCandidateStore(db: QueryExecutor, clock: () => Date) {
  return {
    async candidates(userId: string, runId: string): Promise<StoredCandidate[]> {
      requireUuid(userId, "user_id"); requireUuid(runId, "run_id");
      const { rows } = await db.query<CandidateRow>(`select ${CANDIDATE_COLUMNS} from discovery_candidates c join discovery_runs r using(run_id) where c.run_id=$1::uuid and r.user_id=$2::uuid order by c.created_at,c.candidate_id`, [runId, userId]);
      return rows.map(candidateFromRow);
    },
    async admitCandidate(lease: Lease, candidate: DiscoveredCandidate): Promise<void> {
      assertCandidate(candidate);
      await transaction(db, async (tx) => {
        await lockLiveLease(tx, lease, clock());
        if (candidate.identity !== null) {
          const existing = await tx.query<CandidateRow>(`select ${CANDIDATE_COLUMNS} from discovery_candidates where run_id=$1::uuid and issuer_id=$2::uuid for update`, [lease.run_id, candidate.identity.issuer_id]);
          if (existing.rows[0]) {
            const merged = mergeCandidate(existing.rows[0], candidate);
            await tx.query(
              `update discovery_candidates set name=$2,origins=$3::jsonb,mechanism_ids=$4::jsonb,lead_hit_ids=$5::jsonb,reason_codes=$6::jsonb,seed=$7,primary_domain_lead=$8,updated_at=now() where candidate_id=$1::uuid`,
              [existing.rows[0].candidate_id, merged.name, json(merged.origins), json(merged.mechanism_ids), json(merged.lead_hit_ids), json(merged.reason_codes), merged.seed, merged.primary_domain_lead],
            );
            return;
          }
        }
        const count = await tx.query<{ count: number }>("select count(*)::int as count from discovery_candidates where run_id=$1::uuid", [lease.run_id]);
        if ((count.rows[0]?.count ?? 0) >= 100) throw new DiscoveryError("budget_exhausted", "candidate limit is exhausted");
        await tx.query(
          `insert into discovery_candidates (candidate_id,run_id,lead_key,issuer_id,listing_id,identity_display,origins,mechanism_ids,lead_hit_ids,reason_codes,first_seen,seed,primary_domain_lead,name,state)
           values ($1::uuid,$2::uuid,$3,$4::uuid,$5::uuid,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,$12,$13,$14,'discovered')`,
          [candidate.candidate_id, lease.run_id, candidate.lead_key, candidate.identity?.issuer_id ?? null, candidate.identity?.listing_id ?? null, candidate.identity === null ? null : json(candidate.identity), json(candidate.origins), json(candidate.mechanism_ids), json(candidate.lead_hit_ids), json(candidate.reason_codes), json(candidate.first_seen), candidate.seed, candidate.primary_domain_lead, candidate.name],
        );
      });
    },
    async commitCohort(lease: Lease, candidateIds: string[], coverage: Coverage): Promise<void> {
      if (candidateIds.length > 25 || new Set(candidateIds).size !== candidateIds.length) throw new DiscoveryError("validation", "cohort must contain up to 25 unique candidates");
      candidateIds.forEach((id) => requireUuid(id, "candidate_id"));
      await transaction(db, async (tx) => {
        await lockLiveLease(tx, lease, clock());
        const present = await tx.query<{ candidate_id: string }>("select candidate_id::text as candidate_id from discovery_candidates where run_id=$1::uuid and candidate_id=any($2::uuid[]) for update", [lease.run_id, candidateIds]);
        if (present.rows.length !== candidateIds.length) throw new DiscoveryError("not_found", "cohort candidate not found");
        for (const [index, candidateId] of candidateIds.entries()) await tx.query("update discovery_candidates set state='researching',selection_ordinal=$3,updated_at=now() where run_id=$1::uuid and candidate_id=$2::uuid", [lease.run_id, candidateId, index + 1]);
        await tx.query("update discovery_runs set coverage=$2::jsonb,stage='research' where run_id=$1::uuid", [lease.run_id, json(coverage)]);
      });
    },
    async failCandidate(lease: Lease, candidateId: string, code: string): Promise<void> {
      requireUuid(candidateId, "candidate_id");
      if (typeof code !== "string" || code.trim().length === 0 || code.length > 120) throw new DiscoveryError("validation", "failure code is invalid");
      await transaction(db, async (tx) => {
        await lockLiveLease(tx, lease, clock());
        const updated = await tx.query("update discovery_candidates set state='research_error',reason_codes=reason_codes || $3::jsonb,updated_at=now() where run_id=$1::uuid and candidate_id=$2::uuid", [lease.run_id, candidateId, json([code])]);
        if (updated.rowCount !== 1) throw new DiscoveryError("not_found", "candidate not found");
      });
    },
  };
}

function assertCandidate(candidate: DiscoveredCandidate): void {
  requireUuid(candidate.candidate_id, "candidate_id");
  if (typeof candidate.lead_key !== "string" || candidate.lead_key.trim().length === 0 || candidate.lead_key.length > 500) throw new DiscoveryError("validation", "lead_key is invalid");
  if (candidate.identity !== null) { requireUuid(candidate.identity.issuer_id, "issuer_id"); requireUuid(candidate.identity.listing_id, "listing_id"); }
  if (!Array.isArray(candidate.origins) || candidate.origins.length === 0 || !Array.isArray(candidate.mechanism_ids) || candidate.mechanism_ids.length === 0) throw new DiscoveryError("validation", "candidate origins and mechanisms are required");
}

function candidateFromRow(row: CandidateRow): StoredCandidate {
  const identity: CompanyIdentity | null = row.issuer_id === null || row.listing_id === null ? null : jsonValue<CompanyIdentity>(row.identity_display, "identity_display");
  return { candidate_id: row.candidate_id, lead_key: row.lead_key, name: row.name, identity, origins: jsonValue(row.origins, "origins"), mechanism_ids: jsonValue(row.mechanism_ids, "mechanism_ids"), seed: row.seed, primary_domain_lead: row.primary_domain_lead, first_seen: jsonValue(row.first_seen, "first_seen"), lead_hit_ids: jsonValue(row.lead_hit_ids, "lead_hit_ids"), reason_codes: jsonValue(row.reason_codes, "reason_codes"), state: row.state, ordinal: row.selection_ordinal, assessment: row.assessment === null ? null : jsonValue<CandidateDecision>(row.assessment, "assessment"), snapshot_id: row.snapshot_id, rank: row.rank };
}

function mergeCandidate(existing: CandidateRow, incoming: DiscoveredCandidate) {
  const union = <T>(left: T[], right: T[]) => [...new Set([...left, ...right])];
  return { name: existing.name, origins: union(jsonValue<string[]>(existing.origins, "origins"), incoming.origins), mechanism_ids: union(jsonValue<string[]>(existing.mechanism_ids, "mechanism_ids"), incoming.mechanism_ids), lead_hit_ids: union(jsonValue<string[]>(existing.lead_hit_ids, "lead_hit_ids"), incoming.lead_hit_ids), reason_codes: union(jsonValue<string[]>(existing.reason_codes, "reason_codes"), incoming.reason_codes), seed: existing.seed || incoming.seed, primary_domain_lead: existing.primary_domain_lead || incoming.primary_domain_lead };
}
