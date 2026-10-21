-- A filing states its own period's EPS and share counts on the split basis
-- of its filing date (#387). Their contexts are "as filed" and name that date;
-- binding restates them to an analysis's reference date from listing_splits.
alter table fact_financial_contexts add column if not exists as_filed_on date;
alter table fact_financial_contexts drop constraint if exists fact_financial_contexts_adjustment_basis_check;
alter table fact_financial_contexts add constraint fact_financial_contexts_adjustment_basis_check
  check (adjustment_basis in ('unadjusted', 'split_adjusted', 'as_filed'));
alter table fact_financial_contexts drop constraint if exists fact_financial_contexts_as_filed;
alter table fact_financial_contexts add constraint fact_financial_contexts_as_filed
  check ((adjustment_basis = 'as_filed') = (as_filed_on is not null));
