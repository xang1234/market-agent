import type { SubjectRef } from "../../shared/src/subject-ref.ts";
import type { QueryExecutor } from "./types.ts";
import type { ResolvedPeriod } from "./column-catalog.ts";

// Resolves the subject's most recently reported fiscal period from facts.
// Only issuers carry fiscal periods; everything else resolves to null. We
// select the latest reported period-bearing fact — period_kind in
// ('fiscal_q','fiscal_y','ttm') — so point facts (e.g. market_cap, which
// has NULL fiscal_year/fiscal_period and a continuously-updated as_of) can't
// win and defeat the resolver. Ties are broken deterministically with the
// repo's canonical live-fact ordering (as_of desc, period_end desc nulls
// last, created_at desc, fact_id desc; see 0026_sec_fact_identity).
// document_refs is intentionally empty in Plan 2/3 — documents have no
// subject linkage yet (resolving the backing document is a Plan-3 concern).
export async function resolvePeriodContext(
  db: QueryExecutor,
  subject: SubjectRef,
): Promise<ResolvedPeriod | null> {
  if (subject.kind !== "issuer") return null;
  const { rows } = await db.query<{
    period_kind: string;
    fiscal_year: number | null;
    fiscal_period: string | null;
    period_start: string | null;
    period_end: string | null;
  }>(
    `select f.period_kind,
            f.fiscal_year,
            f.fiscal_period,
            f.period_start::text as period_start,
            f.period_end::text as period_end
       from facts f
      where f.subject_kind = 'issuer'
        and f.subject_id = $1
        and f.invalidated_at is null
        and f.superseded_by is null
        and f.period_kind in ('fiscal_q','fiscal_y','ttm')
      order by f.as_of desc, f.period_end desc nulls last, f.created_at desc, f.fact_id desc
      limit 1`,
    [subject.id],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    period_kind: row.period_kind,
    fiscal_year: row.fiscal_year,
    fiscal_period: row.fiscal_period,
    period_start: row.period_start,
    period_end: row.period_end,
    document_refs: [],
  };
}
