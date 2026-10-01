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
