// Whether a fact counts as active, as one SQL predicate shared by every reader
// that grounds or verifies a sealed answer (#159). Without a cutoff: active now.
// With one: active at the cutoff, so a fact invalidated later, or superseded by
// a fact observed later, is still the one that was known then. Facts carry no
// superseded_at, so the replacement's observed_at marks the supersession.
export function factActiveSql(alias: string, cutoff?: string): string {
  if (cutoff === undefined) return `${alias}.superseded_by is null and ${alias}.invalidated_at is null`;
  return `(${alias}.invalidated_at is null or ${alias}.invalidated_at > ${cutoff})
          and (${alias}.superseded_by is null
               or exists (select 1 from facts successor
                           where successor.fact_id = ${alias}.superseded_by
                             and successor.observed_at > ${cutoff}))`;
}

// Known by the cutoff: active then (above), and dated, observed and reported at
// or before it, so a backdated filing ingested later does not count.
export function factKnownAtSql(alias: string, cutoff: string): string {
  return `${factActiveSql(alias, cutoff)}
          and ${alias}.as_of <= ${cutoff}
          and ${alias}.observed_at <= ${cutoff}
          and (${alias}.reported_at is null or ${alias}.reported_at <= ${cutoff})`;
}
