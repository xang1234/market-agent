-- Idempotency + per-day audit ledger for the daily EDGAR master-index crawl.
-- One row per (form, index_date) crawl attempt: reruns upsert in place and an
-- operator can see per-day coverage. (Resume/catch-up is deferred until the
-- form handlers exist to key a watermark on.)
create table edgar_crawl_ledger (
  ledger_id        uuid primary key default gen_random_uuid(),
  form             text not null,
  index_date       date not null,
  status           text not null default 'succeeded' check (status in ('succeeded', 'partial', 'failed')),
  filings_total    integer not null default 0 check (filings_total >= 0),
  filings_ingested integer not null default 0 check (filings_ingested >= 0),
  filings_skipped  integer not null default 0 check (filings_skipped >= 0),
  started_at       timestamptz not null,
  finished_at      timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  unique (form, index_date),
  check (finished_at >= started_at)
);

create index edgar_crawl_ledger_form_date_idx
  on edgar_crawl_ledger(form, index_date desc);
