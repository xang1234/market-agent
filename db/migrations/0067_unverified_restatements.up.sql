-- A later 10-K's statement of an as-filed EPS or share count, when the splits
-- since the original could not be checked at ingest (#387), is stored as an
-- unverified restatement. An as_restated plan gaps on it until the SEC
-- backfill, rerun after a split sync, decides it.
alter table fact_financial_contexts drop constraint if exists fact_financial_contexts_disclosure_relation_check;
alter table fact_financial_contexts add constraint fact_financial_contexts_disclosure_relation_check
  check (disclosure_relation in ('original', 'economic_restatement', 'extraction_correction', 'unverified_restatement'));
