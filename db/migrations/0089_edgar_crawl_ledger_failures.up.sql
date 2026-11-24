-- Why a crawl day is partial or failed (#769): one {accession, cause} per filing
-- whose handler failed. A succeeded day has none, and a partial or failed day
-- has at least one, so neither status can be written without its cause.
alter table edgar_crawl_ledger add column if not exists failures jsonb not null default '[]'::jsonb;

-- Days recorded partial before this column existed kept no cause.
update edgar_crawl_ledger
   set failures = '[{"accession": null, "cause": "not recorded: this day was crawled before migration 0089 kept causes"}]'::jsonb
 where status <> 'succeeded' and failures = '[]'::jsonb;

alter table edgar_crawl_ledger drop constraint if exists edgar_crawl_ledger_failures_check;
alter table edgar_crawl_ledger add constraint edgar_crawl_ledger_failures_check
  check (jsonb_typeof(failures) = 'array');
alter table edgar_crawl_ledger drop constraint if exists edgar_crawl_ledger_cause_check;
alter table edgar_crawl_ledger add constraint edgar_crawl_ledger_cause_check
  check ((status = 'succeeded') = (failures = '[]'::jsonb));
