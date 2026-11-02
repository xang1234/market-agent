-- net_income is income attributable to the parent (us-gaap NetIncomeLoss).
-- SEC ingestion also stored ProfitLoss under it for a period with no
-- NetIncomeLoss. ProfitLoss includes noncontrolling interest, so those facts
-- are invalidated, restatements included, and so is every fact derived from
-- one (quality_flags input_fact_ids), at any depth. The SEC statements
-- backfill stores each period's figures under their keys: ProfitLoss as
-- net_income again only where the filer reports no noncontrolling interest,
-- with that inference recorded. A fact names its concept in its precision
-- proof's locator or, for a derived quarter, in its lineage. A fact stored
-- with neither is reconciled by the backfill, not here.
with recursive derived_from(fact_id, input_fact_id) as materialized (
  select d.fact_id, input.id
    from facts d
   cross join jsonb_array_elements(case when jsonb_typeof(d.quality_flags) = 'array' then d.quality_flags else '[]' end) flag
   cross join jsonb_array_elements_text(case when jsonb_typeof(flag -> 'input_fact_ids') = 'array' then flag -> 'input_fact_ids' else '[]' end) input(id)
   where d.invalidated_at is null
),
refuted(fact_id) as (
  select f.fact_id
    from facts f
    join metrics m on m.metric_id = f.metric_id
   where m.metric_key = 'net_income'
     and f.invalidated_at is null
     and (f.quality_flags @> '[{"concept": "ProfitLoss"}]'
       or exists (select 1 from fact_precision_attestations p where p.fact_id = f.fact_id and p.source_locator like '%#ProfitLoss|%'))
  union
  select d.fact_id
    from refuted r
    join derived_from d on d.input_fact_id = r.fact_id::text
)
update facts f
   set invalidated_at = now(), updated_at = now()
  from refuted r
 where r.fact_id = f.fact_id;
