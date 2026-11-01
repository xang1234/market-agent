drop trigger if exists claims_period_bound_once on claims;
drop function if exists prevent_claim_period_rebinding();
alter table claims
  drop column if exists period_bound_at,
  drop column if exists period_end,
  drop column if exists period_kind;
