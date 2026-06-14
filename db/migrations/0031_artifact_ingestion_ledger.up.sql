-- Idempotency ledger for the external release-artifact ETL (xang1234/stock-screener
-- GitHub Releases). One row per successfully-ingested bundle per (release_tag, market).
-- The upstream manifest sha256 is the idempotency signal: a re-run of an unchanged
-- bundle is skipped (see the unique constraint). ingestion_batch_id mirrors
-- facts.ingestion_batch_id for the same run, so every minted fact and quote snapshot
-- is traceable back to — and reversible by — its ledger entry.
create table artifact_ingestion_ledger (
  ledger_id          uuid primary key default gen_random_uuid(),
  provider           text not null,
  release_tag        text not null,
  market             text not null,
  schema_version     text not null,
  bundle_asset_name  text not null,
  sha256             text not null,
  as_of_date         date not null,
  source_id          uuid not null references sources(source_id),
  ingestion_batch_id uuid not null,
  rows_total         integer not null default 0 check (rows_total >= 0),
  rows_ingested      integer not null default 0 check (rows_ingested >= 0),
  rows_skipped       integer not null default 0 check (rows_skipped >= 0),
  status             text not null default 'succeeded' check (status in ('succeeded', 'partial', 'failed')),
  started_at         timestamptz not null,
  finished_at        timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  unique (release_tag, market, sha256),
  check (finished_at >= started_at)
);

create index artifact_ingestion_ledger_lookup_idx
  on artifact_ingestion_ledger(release_tag, market, as_of_date desc, finished_at desc);
