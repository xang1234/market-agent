import type { QueryExecutor } from "../../agents/src/agent-repo.ts";
import type { CandidateDecision, CandidateView, CampaignEvent, Citation, SourceView } from "./types.ts";
import type { StoredCandidate } from "./ports.ts";

type RequestedCitation = Citation & { candidate_id: string };
type VisibleCitation = RequestedCitation;
type SourceRow = {
  candidate_id: string; kind: Citation["kind"]; id: string; title: string; url: string | null;
  published_at: Date | string | null; retrieved_at: Date | string;
};

/** Resolves every cited dependency in two set-based queries before exposing derived copy. */
export async function authorizedCandidateViews(
  db: QueryExecutor,
  userId: string,
  candidates: readonly StoredCandidate[],
): Promise<ReadonlyArray<CandidateView>> {
  const requested = candidates.flatMap((candidate) => candidate.assessment === null
    ? []
    : citationsForDecision(candidate.assessment).map((citation) => ({ ...citation, candidate_id: candidate.candidate_id })));
  const visible = await visibleCitations(db, userId, requested);
  const sourceRows = await sourceRowsForCitations(db, userId, requested);
  const visibleKeys = new Set(visible.map(citationKey));
  const sourceByCandidate = new Map<string, SourceView[]>();
  for (const row of sourceRows) {
    const views = sourceByCandidate.get(row.candidate_id) ?? [];
    views.push({
      citation: { kind: row.kind, id: row.id }, title: row.title, url: row.url ?? "",
      published_at: iso(row.published_at), retrieved_at: iso(row.retrieved_at)!,
    });
    sourceByCandidate.set(row.candidate_id, views);
  }
  return candidates.map((candidate) => {
    const citations = candidate.assessment === null ? [] : citationsForDecision(candidate.assessment);
    const available = candidate.assessment === null || citations.every((citation) => visibleKeys.has(citationKey({ ...citation, candidate_id: candidate.candidate_id })));
    const assessment = available ? candidate.assessment : null;
    return {
      candidate_id: candidate.candidate_id,
      identity: candidate.identity,
      name: candidate.name,
      state: candidate.state,
      rank: candidate.rank,
      snapshot_id: candidate.snapshot_id,
      evidence_available: available,
      can_promote: available && assessment !== null && (candidate.state === "shortlisted" || candidate.state === "eligible_not_shortlisted"),
      assessment,
      sources: available ? [...(sourceByCandidate.get(candidate.candidate_id) ?? [])] : [],
      origins: [...candidate.origins],
      mechanism_ids: [...candidate.mechanism_ids],
      reason_codes: [...candidate.reason_codes],
    };
  });
}

/** Event narratives can contain derived evidence, so their visibility has the same current-source gate. */
export function redactUnauthorizedEvents(
  events: readonly CampaignEvent[],
  views: readonly CandidateView[],
  visible: ReadonlySet<string>,
): CampaignEvent[] {
  const availability = new Map(views.map((view) => [view.candidate_id, view.evidence_available]));
  return events.map((event) => {
    const candidateAvailable = event.candidate_id === null || availability.get(event.candidate_id) !== false;
    const citationsAvailable = event.citations.every((citation) => visible.has(citationKey({ ...citation, candidate_id: event.candidate_id ?? "" })) || visible.has(citationKey({ ...citation, candidate_id: "*" })));
    if (candidateAvailable && citationsAvailable) return event;
    return Object.freeze({ ...event, summary: "Evidence is no longer available.", citations: [] });
  });
}

export async function visibleCitationKeys(
  db: QueryExecutor,
  userId: string,
  candidates: readonly StoredCandidate[],
  events: readonly CampaignEvent[] = [],
): Promise<ReadonlySet<string>> {
  const requested: RequestedCitation[] = [
    ...candidates.flatMap((candidate) => candidate.assessment === null ? [] : citationsForDecision(candidate.assessment).map((citation) => ({ ...citation, candidate_id: candidate.candidate_id }))),
    ...events.flatMap((event) => event.citations.map((citation) => ({ ...citation, candidate_id: event.candidate_id ?? "*" }))),
  ];
  return new Set((await visibleCitations(db, userId, requested)).map(citationKey));
}

function citationsForDecision(decision: CandidateDecision): Citation[] {
  const citations = [
    ...Object.values(decision.dimensions).flatMap((dimension) => dimension.citations),
    ...decision.criteria.flatMap((criterion) => criterion.citations),
    ...decision.counterarguments.flatMap((argument) => argument.citations),
  ];
  return [...new Map(citations.map((citation) => [`${citation.kind}:${citation.id}`, citation])).values()];
}

async function visibleCitations(db: QueryExecutor, userId: string, requested: readonly RequestedCitation[]): Promise<VisibleCitation[]> {
  if (requested.length === 0) return [];
  const { rows } = await db.query<VisibleCitation>(
    `with requested as (
       select * from jsonb_to_recordset($1::jsonb) as r(candidate_id text,kind text,id uuid)
     ), visible as (
       select r.candidate_id,r.kind,r.id
         from requested r
         join claims c on r.kind='claim' and c.claim_id=r.id and c.superseded_at is null
         join documents d on d.document_id=c.document_id and d.deleted_at is null
         join sources reported on reported.source_id=c.reported_by_source_id and (reported.user_id is null or reported.user_id=$2::uuid)
         join sources document_source on document_source.source_id=d.source_id and (document_source.user_id is null or document_source.user_id=$2::uuid)
       union all
       select r.candidate_id,r.kind,r.id
         from requested r
         join facts f on r.kind='fact' and f.fact_id=r.id and f.invalidated_at is null and f.superseded_by is null and f.entitlement_channels ? 'app'
         join sources s on s.source_id=f.source_id and (s.user_id is null or s.user_id=$2::uuid)
     ) select candidate_id,kind,id::text as id from visible`,
    [JSON.stringify(requested), userId],
  );
  return rows;
}

async function sourceRowsForCitations(db: QueryExecutor, userId: string, requested: readonly RequestedCitation[]): Promise<SourceRow[]> {
  if (requested.length === 0) return [];
  const { rows } = await db.query<SourceRow>(
    `with requested as (
       select * from jsonb_to_recordset($1::jsonb) as r(candidate_id text,kind text,id uuid)
     )
     select r.candidate_id,r.kind,c.claim_id::text as id,c.predicate as title,s.canonical_url as url,d.published_at,s.retrieved_at
       from requested r join claims c on r.kind='claim' and c.claim_id=r.id and c.superseded_at is null
       join documents d on d.document_id=c.document_id and d.deleted_at is null
       join sources s on s.source_id=c.reported_by_source_id and (s.user_id is null or s.user_id=$2::uuid)
       join sources ds on ds.source_id=d.source_id and (ds.user_id is null or ds.user_id=$2::uuid)
     union all
     select r.candidate_id,r.kind,f.fact_id::text as id,m.display_name as title,s.canonical_url as url,null::timestamptz as published_at,s.retrieved_at
       from requested r join facts f on r.kind='fact' and f.fact_id=r.id and f.invalidated_at is null and f.superseded_by is null and f.entitlement_channels ? 'app'
       join metrics m on m.metric_id=f.metric_id
       join sources s on s.source_id=f.source_id and (s.user_id is null or s.user_id=$2::uuid)`,
    [JSON.stringify(requested), userId],
  );
  return rows;
}

function citationKey(citation: RequestedCitation): string { return `${citation.candidate_id}:${citation.kind}:${citation.id}`; }
function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
