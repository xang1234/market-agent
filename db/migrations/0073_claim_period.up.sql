-- The fiscal period a claim explains (#542), keyed as facts are: a quarter or
-- a year, and the date it ends. All three or none: an unbound claim explains no
-- period a lookup can ask for.
-- period_bound_at is when the claim was bound to its period, and a lookup at a
-- cutoff before it does not see the binding. Whoever binds or rebinds a claim
-- sets it to that moment, never earlier: a backdated binding would change what
-- a lookup replayed at an earlier cutoff returns.
-- One statement, so the table is scanned once: the runner applies a migration
-- in one transaction, which holds the first statement's ACCESS EXCLUSIVE lock
-- to the end, so checks added NOT VALID and then validated would scan under
-- that same lock.
alter table claims
  add column if not exists period_kind text,
  add column if not exists period_end date,
  add column if not exists period_bound_at timestamptz,
  drop constraint if exists claims_period_kind_check,
  add constraint claims_period_kind_check check (period_kind in ('fiscal_q', 'fiscal_y')),
  drop constraint if exists claims_period_pair,
  add constraint claims_period_pair check (num_nulls(period_kind, period_end, period_bound_at) in (0, 3));
