alter table claims
  drop column if exists period_bound_at,
  drop column if exists period_end,
  drop column if exists period_kind;
