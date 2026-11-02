-- net_income is income attributable to the parent (us-gaap NetIncomeLoss).
-- SEC ingestion also stored ProfitLoss under it for a period with no
-- NetIncomeLoss. ProfitLoss includes noncontrolling interest, and ingestion
-- now stores it as net_income_consolidated, so those facts are invalidated.
-- The SEC statements backfill stores the period's figures under their keys.
-- A fact names its concept in its precision proof's locator or, for a
-- derived quarter, in its lineage.
update facts f
   set invalidated_at = now(), updated_at = now()
  from metrics m
 where m.metric_id = f.metric_id
   and m.metric_key = 'net_income'
   and f.invalidated_at is null
   and (f.quality_flags @> '[{"concept": "ProfitLoss"}]'
     or exists (select 1 from fact_precision_attestations p where p.fact_id = f.fact_id and p.source_locator like '%#ProfitLoss|%'));
