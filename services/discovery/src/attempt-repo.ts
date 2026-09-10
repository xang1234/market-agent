import { hashJsonValue } from "../../observability/src/tool-call.ts";
import type { QueryExecutor } from "../../agents/src/agent-repo.ts";
import type { AttemptReservation, Lease } from "./ports.ts";
import { SEARCH_PHASE_LIMITS } from "./policy.ts";
import type { Resource } from "./types.ts";
import { DiscoveryError } from "./types.ts";
import { json, jsonValue, requireText, requireUuid, transaction } from "./repository-support.ts";
import { lockLiveLease } from "./worker-lock.ts";

type Scope = Lease | { campaign_id: string; user_id: string; draft_token: string };
type SearchPhase = keyof typeof SEARCH_PHASE_LIMITS;
type AttemptInput = { operation_key: string; request_hash: string; resource: Resource; phase: "draft" | "discovery" | "research" | "verification"; candidate_id?: string; attempt_number: 1 | 2; model_initial?: boolean };
type AttemptRow = { attempt_id: string; attempt_number: 1 | 2; outcome: string; result: unknown; request_hash: string; model_initial: boolean };
type BudgetRow = { usage: Partial<Record<Resource, number>>; limits: { attempts: Record<Resource, number>; run_timeout_ms: number }; phase_usage: unknown; started_at: Date | string | null };
type DraftRequest = { request_id: string; requested_at: string };

export function createAttemptStore(db: QueryExecutor, clock: () => Date) {
  return {
    async reserveAttempt(scope: Scope, input: AttemptInput): Promise<AttemptReservation> {
      requireText(input.operation_key, "operation_key", 1, 500); requireText(input.request_hash, "request_hash", 8, 80);
      if (!/^sha256:[0-9a-f]{64}$/u.test(input.request_hash) || (input.attempt_number !== 1 && input.attempt_number !== 2)) throw new DiscoveryError("validation", "attempt input is invalid");
      if (input.candidate_id !== undefined) requireUuid(input.candidate_id, "candidate_id");
      if (input.model_initial === true && (input.resource !== "model" || input.phase !== "research" || input.attempt_number !== 1)) throw new DiscoveryError("validation", "initial model attempts must be first research model attempts");
      if (!("run_id" in scope) && input.operation_key !== `draft/${scope.draft_token}`) throw new DiscoveryError("validation", "draft operation key is invalid");
      return transaction(db, async (tx) => {
        const identity = await lockScope(tx, scope, clock);
        const attempts = await tx.query<AttemptRow>(
          "select attempt_id::text as attempt_id,attempt_number,outcome,result,request_hash,model_initial from discovery_attempts where campaign_id=$1::uuid and operation_key=$2 for update",
          [identity.campaign_id, input.operation_key],
        );
        if (attempts.rows.some((attempt) => attempt.request_hash !== input.request_hash)) throw new DiscoveryError("request_conflict", "operation key was used with a different request");
        const existing = attempts.rows.find((attempt) => attempt.attempt_number === input.attempt_number);
        if (existing) {
          if (existing.model_initial !== (input.model_initial === true)) throw new DiscoveryError("request_conflict", "attempt kind changed for an existing operation");
          if (existing.outcome === "success") return { attempt_id: existing.attempt_id, attempt_number: input.attempt_number, state: "cached", result: existing.result };
          if (existing.outcome === "reserved") {
            await tx.query(
              "update discovery_attempts set outcome='unknown',completed_at=$2::timestamptz where attempt_id=$1::uuid and outcome='reserved'",
              [existing.attempt_id, clock().toISOString()],
            );
          }
          return { attempt_id: existing.attempt_id, attempt_number: input.attempt_number, state: "exhausted", result: existing.result };
        }
        if (identity.run_id !== null) await reserveRunBudget(tx, identity.run_id, input, clock());
        const { rows } = await tx.query<{ attempt_id: string }>(
          `insert into discovery_attempts (campaign_id,run_id,operation_key,request_hash,attempt_number,resource,phase,candidate_id,model_initial,outcome)
           values ($1::uuid,$2::uuid,$3,$4,$5,$6,$7,$8::uuid,$9,'reserved') returning attempt_id::text as attempt_id`,
          [identity.campaign_id, identity.run_id, input.operation_key, input.request_hash, input.attempt_number, input.resource, input.phase, input.candidate_id ?? null, input.model_initial === true],
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
        const campaign = await tx.query<{ draft_lock_token: string | null; draft_lock_until: Date | string | null; draft_request_ledger: unknown }>("select draft_lock_token::text as draft_lock_token,draft_lock_until,draft_request_ledger from discovery_campaigns where campaign_id=$1::uuid and user_id=$2::uuid for update", [campaignId, userId]);
        const current = campaign.rows[0];
        if (!current) throw new DiscoveryError("not_found", "campaign not found");
        const activeUntil = current.draft_lock_until === null ? null : new Date(current.draft_lock_until);
        const active = activeUntil !== null && activeUntil.getTime() > now.getTime();
        if (active && current.draft_lock_token !== requestId) throw new DiscoveryError("draft_rate_limit", "another draft request is active");
        const requests = currentDraftRequests(current.draft_request_ledger, new Date(now.getTime() - 3_600_000));
        const knownRequest = requests.some((request) => request.request_id === requestId);
        if (!knownRequest && requests.length >= 3) throw new DiscoveryError("draft_rate_limit", "draft request rate limit is exhausted");
        if (!knownRequest) requests.push({ request_id: requestId, requested_at: now.toISOString() });
        if (active && current.draft_lock_token === requestId) {
          if (!knownRequest) await tx.query("update discovery_campaigns set draft_request_ledger=$3::jsonb where campaign_id=$1::uuid and user_id=$2::uuid", [campaignId, userId, json(requests)]);
          return { draft_token: requestId, expires_at: activeUntil.toISOString() };
        }
        await tx.query("update discovery_campaigns set draft_lock_token=$3::uuid,draft_lock_until=$4::timestamptz,draft_request_ledger=$5::jsonb where campaign_id=$1::uuid and user_id=$2::uuid", [campaignId, userId, requestId, expires.toISOString(), json(requests)]);
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

async function reserveRunBudget(tx: QueryExecutor, runId: string, input: AttemptInput, now: Date): Promise<void> {
  const run = await tx.query<BudgetRow>("select usage,limits,phase_usage,started_at from discovery_runs where run_id=$1::uuid for update", [runId]);
  const current = run.rows[0];
  const startedAt = current?.started_at === null || current?.started_at === undefined ? null : new Date(current.started_at);
  const timeout = current?.limits.run_timeout_ms;
  if (startedAt !== null && (!Number.isFinite(startedAt.getTime()) || !Number.isInteger(timeout) || now.getTime() >= startedAt.getTime() + timeout)) {
    throw new DiscoveryError("deadline_exceeded", "run deadline has elapsed");
  }
  const used = current?.usage[input.resource] ?? 0;
  if (!current || !Number.isInteger(used) || used < 0 || used >= current.limits.attempts[input.resource]) throw new DiscoveryError("budget_exhausted", "attempt budget is exhausted");
  if (input.resource === "model") await enforceModelReservationFloor(tx, runId, input, used, current.limits.attempts.model);
  if (input.resource !== "search") {
    await tx.query("update discovery_runs set usage=jsonb_set(usage,array[$2],to_jsonb($3::int)) where run_id=$1::uuid", [runId, input.resource, used + 1]);
    return;
  }
  const phase = searchPhaseFor(input);
  const phaseUsage = currentSearchPhaseUsage(current.phase_usage);
  if (phaseUsage[phase] >= SEARCH_PHASE_LIMITS[phase]) throw new DiscoveryError("budget_exhausted", "search phase budget is exhausted");
  const nextPhaseUsage = { search: { ...phaseUsage, [phase]: phaseUsage[phase] + 1 } };
  await tx.query("update discovery_runs set usage=jsonb_set(usage,array[$2],to_jsonb($3::int)),phase_usage=$4::jsonb where run_id=$1::uuid", [runId, input.resource, used + 1, json(nextPhaseUsage)]);
}

async function enforceModelReservationFloor(
  tx: QueryExecutor,
  runId: string,
  input: AttemptInput,
  used: number,
  limit: number,
): Promise<void> {
  if (input.model_initial === true && input.candidate_id === undefined) {
    throw new DiscoveryError("validation", "initial model attempts require a selected candidate");
  }
  const { rows } = await tx.query<{ selected: number; reserved_initial: number; candidate_selected: boolean }>(
    `select
       (select count(*)::int from discovery_candidates
         where run_id=$1::uuid and selection_ordinal is not null and state <> 'research_error') as selected,
       (select count(*)::int from discovery_attempts a
         join discovery_candidates c on c.candidate_id=a.candidate_id
         where a.run_id=$1::uuid and a.resource='model' and a.attempt_number=1 and a.model_initial
           and c.selection_ordinal is not null and c.state <> 'research_error') as reserved_initial,
       case when $2::uuid is null then false else exists(
         select 1 from discovery_candidates
         where run_id=$1::uuid and candidate_id=$2::uuid and selection_ordinal is not null and state <> 'research_error'
       ) end as candidate_selected`,
    [runId, input.candidate_id ?? null],
  );
  const floor = Math.max(0, (rows[0]?.selected ?? 0) * 2 - (rows[0]?.reserved_initial ?? 0));
  if (input.model_initial === true && !rows[0]?.candidate_selected) {
    throw new DiscoveryError("validation", "initial model attempts require a selected candidate");
  }
  const floorAfterReservation = Math.max(0, floor - (input.model_initial === true ? 1 : 0));
  if (used + 1 + floorAfterReservation > limit) {
    throw new DiscoveryError("budget_exhausted", "model attempt budget is reserved for selected companies");
  }
}

function searchPhaseFor(input: AttemptInput): SearchPhase {
  if (input.attempt_number === 2) return "verification";
  if (input.phase === "discovery" || input.phase === "research" || input.phase === "verification") return input.phase;
  throw new DiscoveryError("validation", "search attempts require a search phase");
}

function currentSearchPhaseUsage(value: unknown): Record<SearchPhase, number> {
  const raw = jsonValue<unknown>(value, "phase_usage");
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error("phase_usage is invalid");
  const search = (raw as { search?: unknown }).search;
  if (typeof search !== "object" || search === null || Array.isArray(search)) return { discovery: 0, research: 0, verification: 0 };
  return Object.fromEntries(Object.keys(SEARCH_PHASE_LIMITS).map((phase) => {
    const value = (search as Record<string, unknown>)[phase];
    return [phase, typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0];
  })) as Record<SearchPhase, number>;
}

function currentDraftRequests(value: unknown, cutoff: Date): DraftRequest[] {
  const raw = jsonValue<unknown>(value, "draft_request_ledger");
  if (!Array.isArray(raw)) throw new Error("draft request ledger is invalid");
  const requests = new Map<string, DraftRequest>();
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) throw new Error("draft request ledger is invalid");
    const request = entry as Partial<DraftRequest>;
    const requestedAt = typeof request.requested_at === "string" ? new Date(request.requested_at) : null;
    if (typeof request.request_id !== "string" || requestedAt === null || !Number.isFinite(requestedAt.getTime())) throw new Error("draft request ledger is invalid");
    if (requestedAt >= cutoff && !requests.has(request.request_id)) requests.set(request.request_id, { request_id: request.request_id, requested_at: requestedAt.toISOString() });
  }
  return [...requests.values()];
}

async function lockScope(tx: QueryExecutor, scope: Scope, clock: () => Date, options: { allowCancelled?: boolean } = {}): Promise<{ campaign_id: string; run_id: string | null }> {
  if ("run_id" in scope) { await lockLiveLease(tx, scope, clock(), options); const row = await tx.query<{ campaign_id: string }>("select campaign_id::text as campaign_id from discovery_runs where run_id=$1::uuid", [scope.run_id]); return { campaign_id: row.rows[0]!.campaign_id, run_id: scope.run_id }; }
  requireUuid(scope.campaign_id, "campaign_id"); requireUuid(scope.user_id, "user_id"); requireUuid(scope.draft_token, "draft_token");
  const locked = await tx.query("select campaign_id from discovery_campaigns where campaign_id=$1::uuid and user_id=$2::uuid and draft_lock_token=$3::uuid and draft_lock_until > $4::timestamptz for update", [scope.campaign_id, scope.user_id, scope.draft_token, clock().toISOString()]);
  if (!locked.rows[0]) throw new DiscoveryError("lease_lost", "draft lock is no longer current"); return { campaign_id: scope.campaign_id, run_id: null };
}
