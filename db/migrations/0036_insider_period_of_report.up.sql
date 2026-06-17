-- A Form 4/A amendment restates the full ownership form, so the handler supersedes
-- the original filing's transactions by (issuer, reporting owner, period_of_report)
-- rather than appending a duplicate set. Store the period (SEC "Date of Earliest
-- Transaction") so that match is possible. Nullable: rows ingested before this
-- migration predate the supersede path; the handler always sets it on new rows.
alter table insider_transactions add column period_of_report date;

-- Backfill existing rows so a 4/A arriving after this migration can supersede an
-- original already in the table (Form 4 shipped before this column existed). The value
-- is the filing's earliest transaction date per accession — the same fallback the
-- extractor uses when a filing carries no explicit <periodOfReport>.
update insider_transactions it
   set period_of_report = sub.earliest
  from (select accession, min(transaction_date) as earliest from insider_transactions group by accession) sub
 where it.accession = sub.accession and it.period_of_report is null;

-- Supports the supersede lookup (delete prior rows for issuer+period+owner).
create index insider_transactions_supersede_idx
  on insider_transactions(issuer_id, period_of_report, insider_cik);
