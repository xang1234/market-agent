import type { QueryExecutor } from "../../agents/src/agent-repo.ts";
import { deleteUnreferencedCampaignExactQuoteClaims } from "../../evidence/src/campaign-quote-lifecycle.ts";
import { deleteSnapshotIfUnreachable } from "../../evidence/src/snapshot-reachability.ts";
import { DiscoveryError } from "./types.ts";
import { requireUuid, transaction } from "./repository-support.ts";

/** Deletes only campaign-owned derived state; evidence sources and shared snapshots survive. */
export async function deleteCampaignWithLifecycle(
  db: QueryExecutor,
  input: { user_id: string; campaign_id: string; now: Date },
): Promise<void> {
  requireUuid(input.user_id, "user_id"); requireUuid(input.campaign_id, "campaign_id");
  await transaction(db, async (tx) => {
    const user = await tx.query("select user_id from users where user_id=$1::uuid for update", [input.user_id]);
    if (!user.rows[0]) throw new DiscoveryError("not_found", "campaign not found");
    const campaign = await tx.query("select campaign_id from discovery_campaigns where campaign_id=$1::uuid and user_id=$2::uuid for update", [input.campaign_id, input.user_id]);
    if (!campaign.rows[0]) throw new DiscoveryError("not_found", "campaign not found");
    const active = await tx.query(
      "select 1 from discovery_runs where campaign_id=$1::uuid and status='running' and lease_expires_at>$2::timestamptz for update",
      [input.campaign_id, input.now.toISOString()],
    );
    if (active.rows[0]) throw new DiscoveryError("active_run", "campaign has a live worker lease");
    const snapshots = await tx.query<{ snapshot_id: string }>(
      `select c.snapshot_id::text as snapshot_id
         from discovery_candidates c join discovery_runs r using(run_id)
        where r.campaign_id=$1::uuid and c.snapshot_id is not null for update of c`,
      [input.campaign_id],
    );
    const toolCalls = await tx.query<{ tool_call_id: string }>(
      `select distinct tool_call_id::text as tool_call_id from discovery_attempts
        where campaign_id=$1::uuid and tool_call_id is not null`,
      [input.campaign_id],
    );
    const quoteClaims = await tx.query<{ claim_id: string }>(
      `select q.claim_id::text as claim_id
         from discovery_quote_claims q
         join discovery_runs r on q.operation_key like r.run_id::text || '/%'
         join claims c on c.claim_id=q.claim_id and c.predicate='campaign_exact_quote'
        where r.campaign_id=$1::uuid
        for update of q,c`,
      [input.campaign_id],
    );
    await tx.query(
      `update discovery_runs
          set cancel_requested_at=coalesce(cancel_requested_at, $2::timestamptz),
              status=case when status='queued' then 'cancelled' else status end
        where campaign_id=$1::uuid
          and (status='queued' or (status='running' and lease_expires_at <= $2::timestamptz))`,
      [input.campaign_id, input.now.toISOString()],
    );
    // The operation ledger and quote map retain source-derived request/result data.
    await tx.query("delete from discovery_attempts where campaign_id=$1::uuid", [input.campaign_id]);
    await tx.query(
      `delete from discovery_quote_claims q
        using discovery_runs r
        where r.campaign_id=$1::uuid and q.operation_key like r.run_id::text || '/%'`,
      [input.campaign_id],
    );
    await tx.query("delete from discovery_campaigns where campaign_id=$1::uuid and user_id=$2::uuid", [input.campaign_id, input.user_id]);
    for (const snapshotId of new Set(snapshots.rows.map((snapshot) => snapshot.snapshot_id))) {
      await deleteSnapshotIfUnreachable(tx, snapshotId);
    }
    await deleteUnreferencedCampaignExactQuoteClaims(tx, quoteClaims.rows.map((row) => row.claim_id));
    await deleteUnreferencedDiscoveryToolCalls(tx, toolCalls.rows.map((row) => row.tool_call_id));
  });
}

export async function deleteUnreferencedDiscoveryToolCalls(db: QueryExecutor, toolCallIds: readonly string[]): Promise<void> {
  if (toolCallIds.length === 0) return;
  await db.query(
    `delete from tool_call_logs t
      where t.tool_call_id=any($1::uuid[])
        and not exists (select 1 from snapshots s where s.tool_call_ids ? t.tool_call_id::text)`,
    [toolCallIds],
  );
}
