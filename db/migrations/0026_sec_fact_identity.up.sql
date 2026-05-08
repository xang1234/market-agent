with ranked as (
  select fact_id,
         row_number() over (
           partition by subject_kind, subject_id, metric_id, period_kind,
                        fiscal_year, fiscal_period, source_id, method
           order by as_of desc, created_at desc, fact_id desc
         ) as rn,
         first_value(fact_id) over (
           partition by subject_kind, subject_id, metric_id, period_kind,
                        fiscal_year, fiscal_period, source_id, method
           order by as_of desc, created_at desc, fact_id desc
         ) as keep_id
    from facts
   where method = 'reported'
     and invalidated_at is null
     and superseded_by is null
     and fiscal_year is not null
     and fiscal_period is not null
)
update facts f
   set superseded_by = ranked.keep_id,
       invalidated_at = now(),
       updated_at = now()
  from ranked
 where f.fact_id = ranked.fact_id
   and ranked.rn > 1;

create unique index if not exists facts_active_reported_identity_idx
  on facts(subject_kind, subject_id, metric_id, period_kind, fiscal_year, fiscal_period, source_id, method)
  where method = 'reported'
    and invalidated_at is null
    and superseded_by is null
    and fiscal_year is not null
    and fiscal_period is not null;
