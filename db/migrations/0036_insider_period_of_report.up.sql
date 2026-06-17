-- A Form 4/A amendment restates the full ownership form, so the handler supersedes
-- the original filing's transactions by (issuer, reporting owner, period_of_report)
-- rather than appending a duplicate set. Store the period (SEC "Date of Earliest
-- Transaction") so that match is possible. Nullable: rows ingested before this
-- migration predate the supersede path; the handler always sets it on new rows.
alter table insider_transactions add column period_of_report date;

-- Supports the supersede lookup (delete prior rows for issuer+period+owner).
create index insider_transactions_supersede_idx
  on insider_transactions(issuer_id, period_of_report, insider_cik);
