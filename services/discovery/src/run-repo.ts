import type { QueryExecutor } from "../../agents/src/agent-repo.ts";
import { DEFAULT_LIMITS, EMPTY_CHECKPOINT, EMPTY_COVERAGE, EMPTY_PHASE_USAGE, EMPTY_USAGE, POLICY_VERSION } from "./policy.ts";
import type { Checkpoint, Lease } from "./ports.ts";
import { DiscoveryError, type Coverage, type Page, type RankedDecision, type RunRecord } from "./types.ts";
import { decodeCursor, encodeCursor, isoDate, json, jsonValue, requireLimit, requireText, requireUuid, transaction } from "./repository-support.ts";
import { leaseFromRow, lockLiveLease } from "./worker-lock.ts";

type RunRow = { run_id: string; campaign_id: string; brief_id: string; user_id: string; status: RunRecord["status"]; stage: RunRecord["stage"]; policy_version: string; request_key: string; limits: unknown; usage: unknown; coverage: unknown; started_at: Date | string | null; finished_at: Date | string | null; cancel_requested_at: Date | string | null; created_at: Date | string; lease_owner?: string | null; lease_epoch?: number; lease_expires_at?: Date | string | null; checkpoint?: unknown };
const RUN_COLUMNS = "run_id::text as run_id, campaign_id::text as campaign_id, brief_id::text as brief_id, user_id::text as user_id, status, stage, policy_version, request_key::text as request_key, limits, usage, coverage, started_at, finished_at, cancel_requested_at, created_at";

export function createRunStore(db: QueryExecutor, clock: () => Date) {
  return {
    async startRun(userId: string, campaignId: string, input: { brief_version: number; brief_hash: string; request_key: string }): Promise<RunRecord> {
      requireUuid(userId, "user_id"); requireUuid(campaignId, "campaign_id"); requireUuid(input.request_key, "request_key");
      if (!Number.isInteger(input.brief_version) || input.brief_version < 1 || typeof input.brief_hash !== "string") throw new DiscoveryError("validation", "run request is invalid");
      return transaction(db, async (tx) => {
        const user = await tx.query("select user_id from users where user_id=$1::uuid for update", [userId]);
        if (!user.rows[0]) throw new DiscoveryError("not_found", "campaign not found");
        const campaign = await tx.query<{ current_brief_version: number }>("select current_brief_version from discovery_campaigns where campaign_id=$1::uuid and user_id=$2::uuid for update", [campaignId, userId]);
        if (!campaign.rows[0]) throw new DiscoveryError("not_found", "campaign not found");
        const existing = await tx.query<RunRow>(`select ${RUN_COLUMNS} from discovery_runs where campaign_id=$1::uuid and request_key=$2::uuid for update`, [campaignId, input.request_key]);
        if (existing.rows[0]) {
          const current = await tx.query<{ version: number; content_hash: string }>("select version, content_hash from discovery_briefs where brief_id=$1::uuid", [existing.rows[0].brief_id]);
          if (!current.rows[0] || current.rows[0].version !== input.brief_version || current.rows[0].content_hash !== input.brief_hash) throw new DiscoveryError("request_conflict", "request key was used with different brief data");
          return runFromRow(existing.rows[0]);
        }
        const brief = await tx.query<{ brief_id: string; version: number; content_hash: string; approved_at: Date | string | null }>(
          "select brief_id::text as brief_id, version, content_hash, approved_at from discovery_briefs where campaign_id=$1::uuid and version=$2 for update", [campaignId, input.brief_version],
        );
        const current = brief.rows[0];
        if (!current || campaign.rows[0].current_brief_version !== input.brief_version || current.content_hash !== input.brief_hash) throw new DiscoveryError("stale_brief", "brief version or hash is stale");
        if (current.approved_at === null) await tx.query("update discovery_briefs set approved_at=$2::timestamptz where brief_id=$1::uuid", [current.brief_id, clock().toISOString()]);
        try {
          const { rows } = await tx.query<RunRow>(
            `insert into discovery_runs (campaign_id,user_id,brief_id,request_key,status,stage,policy_version,limits,usage,phase_usage,checkpoint,coverage)
             values ($1::uuid,$2::uuid,$3::uuid,$4::uuid,'queued','queued',$5,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb)
             returning ${RUN_COLUMNS}`,
            [campaignId, userId, current.brief_id, input.request_key, POLICY_VERSION, json(DEFAULT_LIMITS), json(EMPTY_USAGE), json(EMPTY_PHASE_USAGE), json(EMPTY_CHECKPOINT), json(EMPTY_COVERAGE)],
          );
          return runFromRow(rows[0]);
        } catch (error) {
          if (typeof error === "object" && error !== null && (error as { code?: string }).code === "23505") throw new DiscoveryError("active_run", "user already has an active run");
          throw error;
        }
      });
    },
    async readRun(userId: string, runId: string): Promise<RunRecord> {
      requireUuid(userId, "user_id"); requireUuid(runId, "run_id");
      const { rows } = await db.query<RunRow>(`select ${RUN_COLUMNS} from discovery_runs where run_id=$1::uuid and user_id=$2::uuid`, [runId, userId]);
      if (!rows[0]) throw new DiscoveryError("not_found", "run not found"); return runFromRow(rows[0]);
    },
    async listRuns(userId: string, campaignId: string, cursor: string | null, requestedLimit: number): Promise<Page<RunRecord>> {
      requireUuid(userId, "user_id"); requireUuid(campaignId, "campaign_id"); const limit = requireLimit(requestedLimit, 20); const decoded = decodeCursor(cursor);
      const { rows } = await db.query<RunRow>(
        `select ${RUN_COLUMNS} from discovery_runs where campaign_id=$1::uuid and user_id=$2::uuid
          and ($3::timestamptz is null or (created_at,run_id) < ($3::timestamptz,$4::uuid)) order by created_at desc,run_id desc limit $5`,
        [campaignId, userId, decoded?.created_at ?? null, decoded?.id ?? null, limit + 1],
      );
      const items = rows.slice(0, limit).map(runFromRow); const last = rows.slice(0, limit).at(-1);
      return { items, next_cursor: rows.length > limit && last ? encodeCursor({ created_at: last.created_at, id: last.run_id }) : null };
    },
    async claimNextRun(workerId: string): Promise<Lease | null> {
      requireText(workerId, "worker_id", 1, 200); const now = clock(); const expires = new Date(now.getTime() + 90_000);
      return transaction(db, async (tx) => {
        const candidate = await tx.query<{ run_id: string; user_id: string }>(
          `select r.run_id::text as run_id,r.user_id::text as user_id from discovery_runs r join users u on u.user_id=r.user_id
             where r.cancel_requested_at is null and (r.status='queued' or (r.status='running' and r.lease_expires_at <= $1::timestamptz))
             order by r.created_at asc for update of r,u skip locked limit 1`, [now.toISOString()],
        );
        if (!candidate.rows[0]) return null;
        const { rows } = await tx.query<RunRow>(
          `update discovery_runs set status='running',stage=case when stage='queued' then 'discovery' else stage end,started_at=coalesce(started_at,$2::timestamptz),lease_owner=$3,lease_epoch=lease_epoch+1,lease_expires_at=$4::timestamptz
            where run_id=$1::uuid returning ${RUN_COLUMNS},lease_owner,lease_epoch,lease_expires_at`,
          [candidate.rows[0].run_id, now.toISOString(), workerId, expires.toISOString()],
        );
        return leaseFromRow(rows[0] as RunRow & { lease_owner: string; lease_epoch: number; lease_expires_at: Date | string });
      });
    },
    async heartbeat(lease: Lease): Promise<Lease> {
      const now = clock(); const expires = new Date(now.getTime() + 90_000);
      return transaction(db, async (tx) => {
        await lockLiveLease(tx, lease, now);
        const { rows } = await tx.query<RunRow>(`update discovery_runs set lease_expires_at=$2::timestamptz where run_id=$1::uuid returning ${RUN_COLUMNS},lease_owner,lease_epoch,lease_expires_at`, [lease.run_id, expires.toISOString()]);
        return leaseFromRow(rows[0] as RunRow & { lease_owner: string; lease_epoch: number; lease_expires_at: Date | string });
      });
    },
    async checkpoint(lease: Lease): Promise<Checkpoint> {
      return transaction(db, async (tx) => {
        await lockLiveLease(tx, lease, clock()); const { rows } = await tx.query<{ checkpoint: unknown }>("select checkpoint from discovery_runs where run_id=$1::uuid", [lease.run_id]);
        return checkpointFromValue(rows[0]?.checkpoint);
      });
    },
    async saveCheckpoint(lease: Lease, checkpoint: Checkpoint): Promise<void> {
      const normalized = checkpointFromValue(checkpoint);
      await transaction(db, async (tx) => { await lockLiveLease(tx, lease, clock()); await tx.query("update discovery_runs set checkpoint=$2::jsonb,stage=$3 where run_id=$1::uuid", [lease.run_id, json(normalized), normalized.stage]); });
    },
    async requestCancel(userId: string, runId: string): Promise<RunRecord> {
      requireUuid(userId, "user_id"); requireUuid(runId, "run_id");
      const now = clock().toISOString();
      const { rows } = await db.query<RunRow>(
        `update discovery_runs
            set cancel_requested_at=coalesce(cancel_requested_at,$3::timestamptz),
                status=case when status='queued' then 'cancelled' else status end,
                stage=case when status='queued' then 'finalization' else stage end,
                finished_at=case when status='queued' then coalesce(finished_at,$3::timestamptz) else finished_at end,
                lease_expires_at=case when status='queued' then null else lease_expires_at end
          where run_id=$1::uuid and user_id=$2::uuid and status in ('queued','running')
          returning ${RUN_COLUMNS}`,
        [runId, userId, now],
      );
      if (rows[0]) return runFromRow(rows[0]);
      const { rows: existing } = await db.query<RunRow>(`select ${RUN_COLUMNS} from discovery_runs where run_id=$1::uuid and user_id=$2::uuid`, [runId, userId]);
      if (!existing[0]) throw new DiscoveryError("not_found", "run not found"); return runFromRow(existing[0]);
    },
    async finalize(lease: Lease, input: { status: "completed" | "partial" | "failed" | "cancelled"; decisions: RankedDecision[]; coverage: Coverage }): Promise<void> {
      await transaction(db, async (tx) => {
        await lockLiveLease(tx, lease, clock(), { allowCancelled: input.status === "cancelled" });
        const candidateIds = input.decisions.map((decision) => requireUuid(decision.candidate_id, "candidate_id"));
        if (new Set(candidateIds).size !== candidateIds.length) throw new DiscoveryError("validation", "candidate decisions must be unique");
        const shortlist = input.decisions.filter((decision) => decision.state === "shortlisted");
        if (shortlist.length > 10 || input.decisions.some((decision) => (decision.state === "shortlisted") !== (decision.rank !== null))) throw new DiscoveryError("validation", "shortlist ranks are invalid");
        const ranks = shortlist.map((decision) => decision.rank).sort((left, right) => left! - right!);
        if (ranks.some((rank, index) => !Number.isInteger(rank) || rank !== index + 1)) throw new DiscoveryError("validation", "shortlist ranks are invalid");
        const candidates = await tx.query<{ candidate_id: string }>("select candidate_id::text as candidate_id from discovery_candidates where run_id=$1::uuid and candidate_id=any($2::uuid[]) for update", [lease.run_id, candidateIds]);
        if (candidates.rows.length !== candidateIds.length) throw new DiscoveryError("not_found", "finalization candidate not found");
        for (const decision of input.decisions) {
          const updated = await tx.query("update discovery_candidates set state=$2,rank=$3,assessment=$4::jsonb,updated_at=now() where run_id=$1::uuid and candidate_id=$5::uuid", [lease.run_id, decision.state, decision.rank, json(decision), decision.candidate_id]);
          if (updated.rowCount !== 1) throw new DiscoveryError("not_found", "finalization candidate not found");
        }
        await tx.query("update discovery_runs set status=$2,stage='finalization',coverage=$3::jsonb,finished_at=$4::timestamptz,lease_expires_at=null where run_id=$1::uuid", [lease.run_id, input.status, json(input.coverage), clock().toISOString()]);
        const sequence = await tx.query<{ next_event_sequence: number }>("update discovery_runs set next_event_sequence=next_event_sequence+1 where run_id=$1::uuid returning next_event_sequence", [lease.run_id]);
        await tx.query(
          "insert into discovery_events (run_id,sequence,candidate_id,stage,event_kind,summary,citation_refs) values ($1::uuid,$2,null,'finalization','run_finalized',$3,'[]'::jsonb)",
          [lease.run_id, sequence.rows[0]?.next_event_sequence, `Run ${input.status}.`],
        );
      });
    },
    async deleteCampaign(userId: string, campaignId: string): Promise<void> {
      requireUuid(userId, "user_id"); requireUuid(campaignId, "campaign_id");
      await transaction(db, async (tx) => {
        const user = await tx.query("select user_id from users where user_id=$1::uuid for update", [userId]);
        if (!user.rows[0]) throw new DiscoveryError("not_found", "campaign not found");
        const campaign = await tx.query("select campaign_id from discovery_campaigns where campaign_id=$1::uuid and user_id=$2::uuid for update", [campaignId, userId]);
        if (!campaign.rows[0]) throw new DiscoveryError("not_found", "campaign not found");
        const active = await tx.query("select 1 from discovery_runs where campaign_id=$1::uuid and lease_expires_at > $2::timestamptz limit 1", [campaignId, clock().toISOString()]);
        if (active.rows[0]) throw new DiscoveryError("active_run", "campaign has a live worker lease");
        await tx.query("delete from discovery_campaigns where campaign_id=$1::uuid", [campaignId]);
      });
    },
  };
}

function runFromRow(row: RunRow | undefined): RunRecord {
  if (!row) throw new Error("run query returned no row");
  return { run_id: row.run_id, campaign_id: row.campaign_id, brief_id: row.brief_id, user_id: row.user_id, status: row.status, stage: row.stage, policy_version: row.policy_version, request_key: row.request_key, limits: jsonValue(row.limits, "limits"), usage: jsonValue(row.usage, "usage"), coverage: jsonValue(row.coverage, "coverage"), started_at: isoDate(row.started_at, "started_at"), finished_at: isoDate(row.finished_at, "finished_at"), cancel_requested_at: isoDate(row.cancel_requested_at, "cancel_requested_at") };
}

function checkpointFromValue(value: unknown): Checkpoint {
  const raw = jsonValue<Partial<Checkpoint>>(value, "checkpoint");
  const { stage, next_company: nextCompany, cohort, completed_operation_keys: completedOperationKeys } = raw;
  if (raw.version !== 1 || !Array.isArray(cohort) || !Array.isArray(completedOperationKeys) || typeof nextCompany !== "number" || !Number.isInteger(nextCompany) || !["queued", "discovery", "research", "finalization"].includes(stage ?? "")) throw new DiscoveryError("validation", "checkpoint is invalid");
  return { version: 1, stage: stage as Checkpoint["stage"], cohort: cohort.map((id) => requireUuid(id, "checkpoint.cohort")), next_company: nextCompany, completed_operation_keys: completedOperationKeys.map((key) => requireText(key, "checkpoint.operation_key", 1, 500)) };
}
