-- An as-filed context has no basis before 0066; it is removed, and the fact
-- is uncertified again as it was.
delete from fact_financial_contexts where adjustment_basis = 'as_filed';
alter table fact_financial_contexts drop constraint if exists fact_financial_contexts_as_filed;
alter table fact_financial_contexts drop constraint if exists fact_financial_contexts_adjustment_basis_check;
alter table fact_financial_contexts add constraint fact_financial_contexts_adjustment_basis_check
  check (adjustment_basis in ('unadjusted', 'split_adjusted'));
alter table fact_financial_contexts drop column if exists as_filed_on;
