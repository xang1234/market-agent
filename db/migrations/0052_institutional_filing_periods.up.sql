-- Every (filer, reporting period) a 13F was ingested for, including periods that
-- store no holdings rows (a portfolio restated or reported as empty). Prior-period
-- change detection reads this, not institutional_holdings, so an empty quarter is
-- still the prior of the next one (fra-zpet).
create table institutional_filing_periods (
  filer_cik      text not null,
  filing_period  date not null,
  -- The 13F-HR/A RESTATEMENT that replaced this period, if any: an original arriving
  -- later (out-of-order backfill) is stale and must not overwrite it.
  restated_accession text,
  primary key (filer_cik, filing_period)
);

insert into institutional_filing_periods (filer_cik, filing_period)
select distinct filer_cik, filing_period from institutional_holdings;
