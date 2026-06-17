drop index if exists insider_transactions_supersede_idx;
alter table insider_transactions drop column if exists period_of_report;
