-- Sample DDL: partitioned `tool_call_logs` table (monthly range on created_at).
-- Standalone example; does NOT apply to the normative schema pack.
-- Run against an empty Postgres 15+ database to exercise the pattern.
--
-- Usage:
--   createdb partition_demo
--   psql partition_demo -f db/docs/examples/partition-tool-call-logs.sql

create extension if not exists pgcrypto;

-- created_at must be part of the primary key: Postgres requires the
-- partition column in every unique constraint on a range-partitioned parent.
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
  for values from (timestamptz '2026-02-01 00:00:00+00') to (timestamptz '2026-03-01 00:00:00+00');
create table tool_call_logs_2026_03 partition of tool_call_logs
  for values from (timestamptz '2026-03-01 00:00:00+00') to (timestamptz '2026-04-01 00:00:00+00');
create table tool_call_logs_2026_04 partition of tool_call_logs
  for values from (timestamptz '2026-04-01 00:00:00+00') to (timestamptz '2026-05-01 00:00:00+00');

create table tool_call_logs_default partition of tool_call_logs default;

insert into tool_call_logs (tool_name, args, status, created_at)
select
  'demo.' || g,
  jsonb_build_object('n', g),
  'ok',
  ts
from unnest(array[
  timestamptz '2026-02-10 00:00:00+00',
  timestamptz '2026-03-10 00:00:00+00',
  timestamptz '2026-04-10 00:00:00+00'
]) with ordinality as t(ts, g);

select tableoid::regclass as partition, count(*) from tool_call_logs group by 1 order by 1;

-- Pruning proof: hot-path query scoped to a recent window.
explain (costs off)
select * from tool_call_logs
where created_at >= timestamptz '2026-04-01 00:00:00+00'
  and created_at <  timestamptz '2026-05-01 00:00:00+00'
order by created_at desc
limit 50;

-- Retention pattern (orchestration telemetry): DETACH + DROP once past the
-- warm window. Unlike facts, tool_call_logs is not archived.
alter table tool_call_logs detach partition tool_call_logs_2026_02;
drop table tool_call_logs_2026_02;
