drop index if exists instruments_cusip_idx;
alter table instruments drop column if exists cusip;
drop table if exists institutional_holdings;
