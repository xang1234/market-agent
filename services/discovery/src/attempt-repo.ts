import { hashJsonValue } from "../../observability/src/tool-call.ts";
import type { QueryExecutor } from "../../agents/src/agent-repo.ts";
import type { AttemptReservation, Lease } from "./ports.ts";
import type { Resource } from "./types.ts";
import { DiscoveryError } from "./types.ts";
import { json, jsonValue, requireText, requireUuid, transaction } from "./repository-support.ts";
import { lockLiveLease } from "./worker-lock.ts";

type Scope = Lease | { campaign_id: string; user_id: string; draft_token: string };

export function createAttemptStore(db: QueryExecutor, clock: () => Date) {
  return {
    async reserveAttempt(scope: Scope, input: { operation_key: string; request_hash: string; resource: Resource; phase: "draft" | "discovery" | "research" | "verification"; candidate_id?: string; attempt_number: 1 | 2 }): Promise<AttemptReservation> {
      requireText(input.operation_key, "operation_key", 1, 500); requireText(input.request_hash, "request_hash", 8, 80);
      if (!/^sha256:[0-9a-f]{64}$/u.test(input.request_hash) || (input.attempt_number !== 1 && input.attempt_number !== 2)) throw new DiscoveryError("validation", "attempt input is invalid");
      if (input.candidate_id !== undefined) requireUuid(input.candidate_id, "candidate_id");
      return transaction(db, async (tx) => {
        const identity = await lockScope(tx, scope, clock);
        const existing = await tx.query<{ attempt_id: string; outcome: string; result: unknown; request_hash: string }>("select attempt_id::text as attempt_id,outcome,result,request_hash from discovery_attempts where campaign_id=$1::uuid and operation_key=$2 and attempt_number=$3 for update", [identity.campaign_id, input.operation_key, input.attempt_number]);
        if (existing.rows[0]) {
          if (existing.rows[0].request_hash !== input.request_hash) throw new DiscoveryError("request_conflict", "operation key was used with a different request");
          if (existing.rows[0].outcome === "success") return { attempt_id: existing.rows[0].attempt_id, attempt_number: input.attempt_number, state: "cached", result: existing.rows[0].result };
          return { attempt_id: existing.rows[0].attempt_id, attempt_number: input.attempt_number, state: "exhausted", result: existing.rows[0].result };
        }
        if (identity.run_id !== null) {
          const run = await tx.query<{ usage: Record<Resource, number>; limits: { attempts: Record<Resource, number> } }>("select usage,limits from discovery_runs where run_id=$1::uuid for update", [identity.run_id]);
          const current = run.rows[0]; if (!current || (current.usage[input.resource] ?? 0) >= current.limits.attempts[input.resource]) throw new DiscoveryError("budget_exhausted", "attempt budget is exhausted");
          await tx.query("update discovery_runs set usage=jsonb_set(usage,array[$2],to_jsonb(coalesce((usage ->> $2)::int,0)+1)) where run_id=$1::uuid", [identity.run_id, input.resource]);
        }
        const { rows } = await tx.query<{ attempt_id: string }>(
          `insert into discovery_attempts (campaign_id,run_id,operation_key,request_hash,attempt_number,resource,phase,candidate_id,outcome)
           values ($1::uuid,$2::uuid,$3,$4,$5,$6,$7,$8::uuid,'reserved') returning attempt_id::text as attempt_id`,
          [identity.campaign_id, identity.run_id, input.operation_key, input.request_hash, input.attempt_number, input.resource, input.phase, input.candidate_id ?? null],
        );
        return { attempt_id: rows[0]!.attempt_id, attempt_number: input.attempt_number, state: "dispatch", result: null };
      });
    },
    async finishAttempt(scope: Scope, input: { attempt_id: string; outcome: "success" | "error" | "unknown"; result: unknown; tool_call_id: string | null }): Promise<void> {
      requireUuid(input.attempt_id, "attempt_id"); if (input.tool_call_id !== null) requireUuid(input.tool_call_id, "tool_call_id");
      await transaction(db, async (tx) => {
        const identity = await lockScope(tx, scope, clock, { allowCancelled: true });
        const updated = await tx.query("update discovery_attempts set outcome=$3,result=$4::jsonb,result_hash=$5,tool_call_id=$6::uuid,completed_at=$7::timestamptz where attempt_id=$1::uuid and campaign_id=$2::uuid and outcome='reserved'", [input.attempt_id, identity.campaign_id, input.outcome, json(input.result), hashJsonValue(input.result as never), input.tool_call_id, clock().toISOString()]);
        if (updated.rowCount !== 1) throw new DiscoveryError("request_conflict", "attempt is not reservable");
      });
    },
    async getOperation(userId: string, runId: string, key: string): Promise<{ outcome: string; result: unknown } | null> {
      requireUuid(userId, "user_id"); requireUuid(runId, "run_id"); requireText(key, "operation_key", 1, 500);
      const { rows } = await db.query<{ outcome: string; result: unknown }>(`select a.outcome,a.result from discovery_attempts a join discovery_runs r on r.run_id=a.run_id where a.run_id=$1::uuid and r.user_id=$2::uuid and a.operation_key=$3 and a.outcome='success' order by a.attempt_number desc limit 1`, [runId, userId, key]);
      return rows[0] ?? null;
    },
    async acquireDraft(userId: string, campaignId: string, requestId: string): Promise<{ draft_token: string; expires_at: string }> {
      requireUuid(userId, "user_id"); requireUuid(campaignId, "campaign_id"); requireUuid(requestId, "request_id"); const now = clock(); const expires = new Date(now.getTime() + 90_000);
      return transaction(db, async (tx) => {
        const campaign = await tx.query<{ draft_lock_token: string | null; draft_lock_until: Date | string | null }>("select draft_lock_token::text as draft_lock_token,draft_lock_until from discovery_campaigns where campaign_id=$1::uuid and user_id=$2::uuid for update", [campaignId, userId]);
        if (!campaign.rows[0]) throw new DiscoveryError("not_found", "campaign not found");
        if (campaign.rows[0].draft_lock_until !== null && new Date(campaign.rows[0].draft_lock_until).getTime() > now.getTime() && campaign.rows[0].draft_lock_token !== requestId) throw new DiscoveryError("draft_rate_limit", "another draft request is active");
        const count = await tx.query<{ count: number }>("select count(*)::int as count from discovery_attempts where campaign_id=$1::uuid and phase='draft' and reserved_at >= $2::timestamptz", [campaignId, new Date(now.getTime() - 3_600_000).toISOString()]);
        if ((count.rows[0]?.count ?? 0) >= 3) throw new DiscoveryError("draft_rate_limit", "draft request rate limit is exhausted");
        await tx.query("update discovery_campaigns set draft_lock_token=$3::uuid,draft_lock_until=$4::timestamptz where campaign_id=$1::uuid and user_id=$2::uuid", [campaignId, userId, requestId, expires.toISOString()]);
        return { draft_token: requestId, expires_at: expires.toISOString() };
      });
    },
    async releaseDraft(userId: string, campaignId: string, token: string): Promise<void> {
      requireUuid(userId, "user_id"); requireUuid(campaignId, "campaign_id"); requireUuid(token, "draft_token");
      const updated = await db.query("update discovery_campaigns set draft_lock_token=null,draft_lock_until=null where campaign_id=$1::uuid and user_id=$2::uuid and draft_lock_token=$3::uuid", [campaignId, userId, token]);
      if (updated.rowCount === 0) throw new DiscoveryError("not_found", "draft lock not found");
    },
  };
}

async function lockScope(tx: QueryExecutor, scope: Scope, clock: () => Date, options: { allowCancelled?: boolean } = {}): Promise<{ campaign_id: string; run_id: string | null }> {
  if ("run_id" in scope) { await lockLiveLease(tx, scope, clock(), options); const row = await tx.query<{ campaign_id: string }>("select campaign_id::text as campaign_id from discovery_runs where run_id=$1::uuid", [scope.run_id]); return { campaign_id: row.rows[0]!.campaign_id, run_id: scope.run_id }; }
  requireUuid(scope.campaign_id, "campaign_id"); requireUuid(scope.user_id, "user_id"); requireUuid(scope.draft_token, "draft_token");
  const locked = await tx.query("select campaign_id from discovery_campaigns where campaign_id=$1::uuid and user_id=$2::uuid and draft_lock_token=$3::uuid and draft_lock_until > $4::timestamptz for update", [scope.campaign_id, scope.user_id, scope.draft_token, clock().toISOString()]);
  if (!locked.rows[0]) throw new DiscoveryError("lease_lost", "draft lock is no longer current"); return { campaign_id: scope.campaign_id, run_id: null };
}
