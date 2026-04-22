-- Sample DDL: partitioned `facts` table (monthly range on as_of).
-- Standalone example; does NOT apply to the normative schema pack.
-- Run against an empty Postgres 15+ database to exercise the pattern.
--
-- The enum types and minimal metrics/sources parents below are reduced
-- copies of spec/finance_research_db_schema.sql (enums: lines 16-46;
-- metrics/sources: lines 152-177). They exist so the FKs resolve in
-- isolation — do not treat them as canonical definitions.
--
-- Usage:
--   createdb partition_demo
--   psql partition_demo -f db/docs/examples/partition-facts.sql

create extension if not exists pgcrypto;

create type subject_kind as enum (
  'issuer', 'instrument', 'listing', 'theme', 'macro_topic', 'portfolio', 'screen'
);
create type fact_method as enum ('reported', 'derived', 'estimated', 'vendor', 'extracted');
create type verification_status as enum ('authoritative', 'candidate', 'corroborated', 'disputed');
create type freshness_class as enum ('real_time', 'delayed_15m', 'eod', 'filing_time', 'stale');
create type coverage_level as enum ('full', 'partial', 'sparse', 'unavailable');

create table metrics (
  metric_id uuid primary key default gen_random_uuid(),
  metric_key text not null unique
);
create table sources (
  source_id uuid primary key default gen_random_uuid(),
  provider text not null
);

-- as_of must be part of the primary key: Postgres requires the partition
-- column in every unique constraint on a range-partitioned parent.
create table facts (
  fact_id uuid not null default gen_random_uuid(),
  subject_kind subject_kind not null,
  subject_id uuid not null,
  metric_id uuid not null references metrics(metric_id),
  period_kind text not null check (period_kind in ('point', 'fiscal_q', 'fiscal_y', 'ttm', 'range')),
  period_start date,
  period_end date,
  value_num numeric,
  unit text not null,
  scale numeric not null default 1,
  as_of timestamptz not null,
  observed_at timestamptz not null,
  source_id uuid not null references sources(source_id),
  method fact_method not null,
  definition_version integer not null default 1,
  verification_status verification_status not null,
  freshness_class freshness_class not null,
  coverage_level coverage_level not null,
  confidence numeric not null,
  created_at timestamptz not null default now(),
  primary key (fact_id, as_of)
) partition by range (as_of);

-- Local indexes propagate to every current and future partition.
create index facts_subject_metric_idx on facts(subject_kind, subject_id, metric_id);
create index facts_metric_period_idx on facts(metric_id, period_end desc);
create index facts_asof_idx on facts(as_of desc);
create index facts_verification_idx on facts(verification_status);

create table facts_2026_02 partition of facts
  for values from (timestamptz '2026-02-01 00:00:00+00') to (timestamptz '2026-03-01 00:00:00+00');
create table facts_2026_03 partition of facts
  for values from (timestamptz '2026-03-01 00:00:00+00') to (timestamptz '2026-04-01 00:00:00+00');
create table facts_2026_04 partition of facts
  for values from (timestamptz '2026-04-01 00:00:00+00') to (timestamptz '2026-05-01 00:00:00+00');

-- Rows landing in `default` indicate a missed monthly provision; the
-- observability worker should alert and require a move out.
create table facts_default partition of facts default;

insert into metrics (metric_key) values ('revenue');
insert into sources (provider) values ('sec_edgar');

insert into facts (
  subject_kind, subject_id, metric_id, period_kind, value_num, unit,
  as_of, observed_at, source_id, method,
  verification_status, freshness_class, coverage_level, confidence
)
select
  'issuer',
  gen_random_uuid(),
  (select metric_id from metrics where metric_key = 'revenue'),
  'fiscal_q',
  1000 * g,
  'USD',
  ts,
  ts,
  (select source_id from sources where provider = 'sec_edgar'),
  'reported',
  'authoritative',
  'filing_time',
  'full',
  0.95
from unnest(array[
  timestamptz '2026-02-15 00:00:00+00',
  timestamptz '2026-03-15 00:00:00+00',
  timestamptz '2026-04-15 00:00:00+00'
]) with ordinality as t(ts, g);

-- Sanity check: each partition has one row.
select tableoid::regclass as partition, count(*) from facts group by 1 order by 1;

-- Pruning proof: well-formed query touches one partition.
explain (costs off)
select * from facts
where as_of >= timestamptz '2026-03-01 00:00:00+00'
  and as_of <  timestamptz '2026-04-01 00:00:00+00';

-- Anti-pattern: missing as_of predicate forces a scan over every partition.
explain (costs off)
select * from facts
where subject_kind = 'issuer';

-- Retention pattern (facts-specific): DETACH, archive, then DROP — in that
-- order. The evidence plane never loses data; the local partition may be
-- dropped only after the archive is durable. In production, an observability
-- worker runs this sequence on schedule.
alter table facts detach partition facts_2026_02;
-- e.g. \copy facts_2026_02 to 'archive/facts_2026_02.csv' with csv header;
--      insert into ingestion_batches (archive_uri, ...) values (...);
--      drop table facts_2026_02;   -- only after the archive is confirmed.
