import type { QueryExecutor } from "../../agents/src/agent-repo.ts";
import type { DiscoveryRepository, StoredCandidate } from "./ports.ts";
import type { CandidateState, CandidateView, EventPage, Page, RunView } from "./types.ts";
import { authorizedCandidateViews, redactUnauthorizedEvents, visibleCitationKeys } from "./visibility.ts";
import { DiscoveryError } from "./types.ts";

export type DiscoveryReadModel = ReturnType<typeof createDiscoveryReadModel>;

export function createDiscoveryReadModel(db: QueryExecutor, clock: () => Date = () => new Date()) {
  return Object.freeze({
    async runView(repo: DiscoveryRepository, userId: string, runId: string): Promise<RunView> {
      const [run, candidates] = await Promise.all([repo.readRun(userId, runId), repo.candidates(userId, runId)]);
      const [views, worker_waiting] = await Promise.all([
        authorizedCandidateViews(db, userId, candidates),
        queuedWorkerWaiting(db, userId, runId, clock),
      ]);
      return { ...run, shortlist: views.filter((candidate) => candidate.state === "shortlisted"), cost: { status: "unavailable" }, worker_waiting };
    },
    async candidatePage(repo: DiscoveryRepository, userId: string, runId: string, input: { cursor: string | null; limit: number; state?: CandidateState }): Promise<Page<CandidateView>> {
      const candidates = await repo.candidates(userId, runId);
      const filtered = input.state === undefined ? candidates : candidates.filter((candidate) => candidate.state === input.state);
      const start = cursorOffset(input.cursor, filtered);
      const views = await authorizedCandidateViews(db, userId, filtered.slice(start, start + input.limit + 1));
      const items = views.slice(0, input.limit);
      const more = views.length > input.limit;
      return { items, next_cursor: more && items.at(-1) ? encodeCandidateCursor(items.at(-1)!.candidate_id) : null };
    },
    async eventPage(repo: DiscoveryRepository, userId: string, runId: string, after: number): Promise<EventPage> {
      const [events, candidates] = await Promise.all([repo.events(userId, runId, after, 100), repo.candidates(userId, runId)]);
      const [views, visible] = await Promise.all([
        authorizedCandidateViews(db, userId, candidates),
        visibleCitationKeys(db, userId, candidates, events.items),
      ]);
      return { ...events, items: redactUnauthorizedEvents(events.items, views, visible) };
    },
  });
}

async function queuedWorkerWaiting(db: QueryExecutor, userId: string, runId: string, clock: () => Date): Promise<boolean> {
  const { rows } = await db.query<{ status: string; created_at: Date | string }>(
    `select status, created_at
       from discovery_runs where run_id=$1::uuid and user_id=$2::uuid`,
    [runId, userId],
  );
  const row = rows[0];
  return row?.status === "queued" && new Date(row.created_at).getTime() < clock().getTime() - 90_000;
}

function cursorOffset(cursor: string | null, candidates: readonly StoredCandidate[]): number {
  if (cursor === null) return 0;
  let id: string;
  try { id = Buffer.from(cursor, "base64url").toString("utf8"); } catch { throw new DiscoveryError("validation", "cursor is invalid"); }
  const index = candidates.findIndex((candidate) => candidate.candidate_id === id);
  if (index < 0) throw new DiscoveryError("validation", "cursor is invalid");
  return index + 1;
}
function encodeCandidateCursor(id: string): string { return Buffer.from(id).toString("base64url"); }
