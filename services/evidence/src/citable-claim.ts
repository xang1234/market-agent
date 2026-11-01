// A claim a reader may cite: extracted or corroborated and current, in a live
// document, from sources the user may see, and under a cutoff, written and
// published by it. c is the claim, d its document, s its reporting source.
export function citableClaimSql(user: string, cutoff: string): string {
  return `c.status in ('extracted', 'corroborated')
          and c.superseded_at is null
          and d.deleted_at is null
          and d.parse_status <> 'superseded'
          and exists (select 1 from sources ds where ds.source_id=d.source_id
            and (ds.user_id is null or ds.user_id=${user}))
          and (
            s.user_id is null
            or (${user} is not null and s.user_id = ${user})
          )
          and (${cutoff} is null or (
            c.created_at <= ${cutoff}
            and coalesce(d.published_at,d.created_at) <= ${cutoff}
          ))`;
}
