-- Sample DDL: partitioned `tool_call_logs` table (monthly range on created_at).
-- Standalone example; does NOT apply to the normative schema pack.
-- Run against an empty Postgres 15+ database to exercise the pattern.
--
-- Usage:
--   createdb partition_demo
--   psql partition_demo -f db/docs/examples/partition-tool-call-logs.sql

create extension if not exists pgcrypto;

-- Parent partitioned table. created_at joins the primary key.
create table tool_call_logs (
  tool_call_id uuid not null default gen_random_uuid(),
  thread_id uuid,
  agent_id uuid,
  tool_name text not null,
  args jsonb not null,
  result_hash text,
  duration_ms integer,
  status text not null,
  error_code text,
  created_at timestamptz not null default now(),
  primary key (tool_call_id, created_at)
) partition by range (created_at);

create index tool_call_logs_thread_idx on tool_call_logs(thread_id, created_at desc);
create index tool_call_logs_agent_idx on tool_call_logs(agent_id, created_at desc);

create table tool_call_logs_2026_02 partition of tool_call_logs
  for values from ('2026-02-01T00:00:00Z') to ('2026-03-01T00:00:00Z');
create table tool_call_logs_2026_03 partition of tool_call_logs
  for values from ('2026-03-01T00:00:00Z') to ('2026-04-01T00:00:00Z');
create table tool_call_logs_2026_04 partition of tool_call_logs
  for values from ('2026-04-01T00:00:00Z') to ('2026-05-01T00:00:00Z');

create table tool_call_logs_default partition of tool_call_logs default;

insert into tool_call_logs (tool_name, args, status, created_at)
select
  'demo.' || g,
  jsonb_build_object('n', g),
  'ok',
  ts
from unnest(array[
  '2026-02-10T00:00:00Z'::timestamptz,
  '2026-03-10T00:00:00Z'::timestamptz,
  '2026-04-10T00:00:00Z'::timestamptz
]) with ordinality as t(ts, g);

-- Sanity check: one row per partition.
select tableoid::regclass as partition, count(*) from tool_call_logs group by 1 order by 1;

-- Pruning proof: hot-path query scoped to a recent window.
explain (costs off)
select * from tool_call_logs
where created_at >= '2026-04-01T00:00:00Z'
  and created_at <  '2026-05-01T00:00:00Z'
order by created_at desc
limit 50;

-- Retention pattern: detach the oldest partition for DROP or archival.
-- In production, an observability worker runs this on schedule.
alter table tool_call_logs detach partition tool_call_logs_2026_02;
drop table tool_call_logs_2026_02;
