-- An unverified restatement has no relation before 0067. Its context is
-- removed, and selection never binds a fact without one.
delete from fact_financial_contexts where disclosure_relation = 'unverified_restatement';
alter table fact_financial_contexts drop constraint if exists fact_financial_contexts_disclosure_relation_check;
alter table fact_financial_contexts add constraint fact_financial_contexts_disclosure_relation_check
  check (disclosure_relation in ('original', 'economic_restatement', 'extraction_correction'));
