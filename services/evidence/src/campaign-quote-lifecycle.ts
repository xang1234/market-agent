import type { QueryExecutor } from "./types.ts";

/**
 * Deletes campaign-generated quote claims only after every surviving durable
 * evidence reference has been checked. Child claim rows intentionally cascade.
 */
export async function deleteUnreferencedCampaignExactQuoteClaims(db: QueryExecutor, claimIds: readonly string[]): Promise<void> {
  if (claimIds.length === 0) return;
  await db.query(
    `delete from claims c
      where c.claim_id=any($1::uuid[])
        and c.predicate='campaign_exact_quote'
        and not exists (select 1 from discovery_quote_claims q where q.claim_id=c.claim_id)
        and not exists (select 1 from snapshots s where s.claim_refs ? c.claim_id::text)
        and not exists (select 1 from events e where e.source_claim_ids ? c.claim_id::text)
        and not exists (select 1 from theme_memberships tm where tm.rationale_claim_ids ? c.claim_id::text)`,
    [claimIds],
  );
}
