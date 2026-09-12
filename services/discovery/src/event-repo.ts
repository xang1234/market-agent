import type { QueryExecutor } from "../../agents/src/agent-repo.ts";
import type { Lease } from "./ports.ts";
import { DiscoveryError, type CampaignEvent, type EventPage } from "./types.ts";
import { isoDate, json, requireUuid, transaction } from "./repository-support.ts";
import { lockLiveLease } from "./worker-lock.ts";

type EventRow = { run_id: string; sequence: number | string; stage: CampaignEvent["stage"]; event_kind: CampaignEvent["kind"]; candidate_id: string | null; summary: string; citation_refs: CampaignEvent["citations"]; created_at: Date | string };

/** Appends an event inside an already-fenced domain transaction. */
export async function appendEventInTransaction(
  tx: QueryExecutor,
  run: Pick<Lease, "run_id">,
  event: Omit<CampaignEvent, "run_id" | "sequence" | "created_at">,
): Promise<void> {
  if (typeof event.summary !== "string" || event.summary !== event.summary.trim() || event.summary.length < 1 || event.summary.length > 2_000) throw new DiscoveryError("validation", "event summary is invalid");
  if (!Array.isArray(event.citations) || event.citations.length > 12) throw new DiscoveryError("validation", "event citations are invalid");
  const updated = await tx.query<{ next_event_sequence: number }>("update discovery_runs set next_event_sequence=next_event_sequence+1 where run_id=$1::uuid returning next_event_sequence", [run.run_id]);
  const sequence = updated.rows[0]?.next_event_sequence;
  if (sequence === undefined) throw new DiscoveryError("lease_lost", "run no longer exists");
  await tx.query("insert into discovery_events (run_id,sequence,candidate_id,stage,event_kind,summary,citation_refs) values ($1::uuid,$2,$3::uuid,$4,$5,$6,$7::jsonb)", [run.run_id, sequence, event.candidate_id, event.stage, event.kind, event.summary, json(event.citations)]);
}

export function createEventStore(db: QueryExecutor, clock: () => Date) {
  return {
    async appendEvent(lease: Lease, event: Omit<CampaignEvent, "run_id" | "sequence" | "created_at">): Promise<void> {
      await transaction(db, async (tx) => {
        await lockLiveLease(tx, lease, clock());
        await appendEventInTransaction(tx, lease, event);
      });
    },
    async events(userId: string, runId: string, after: number, limit: number): Promise<EventPage> {
      requireUuid(userId, "user_id"); requireUuid(runId, "run_id");
      if (!Number.isInteger(after) || after < 0 || !Number.isInteger(limit) || limit < 1 || limit > 200) throw new DiscoveryError("validation", "event pagination is invalid");
      const { rows } = await db.query<EventRow>(
        `select e.run_id::text as run_id,e.sequence,e.stage,e.event_kind,e.candidate_id::text as candidate_id,e.summary,e.citation_refs,e.created_at
           from discovery_events e join discovery_runs r using(run_id) where e.run_id=$1::uuid and r.user_id=$2::uuid and e.sequence>$3 order by e.sequence asc limit $4`,
        [runId, userId, after, limit + 1],
      );
      const selected = rows.slice(0, limit).map(eventFromRow); const tail = selected.at(-1);
      return { items: selected, next_sequence: tail?.sequence ?? after, has_more: rows.length > limit };
    },
  };
}

function eventFromRow(row: EventRow): CampaignEvent {
  return { run_id: row.run_id, sequence: Number(row.sequence), stage: row.stage, kind: row.event_kind, candidate_id: row.candidate_id, summary: row.summary, citations: row.citation_refs, created_at: isoDate(row.created_at, "created_at")! };
}
