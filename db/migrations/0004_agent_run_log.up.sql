-- PX.1 (fra-hyz.1.1): operational audit log for agent runs. Distinct from
-- run_activities, which is user-facing stage telemetry. agent_run_logs is
-- ops-side: one row per agent run with start/end, inputs watermark, outputs
-- summary, duration, and terminal outcome.
--
-- agent_id is left unconstrained (no FK) so audit rows survive agent
-- deletion, matching tool_call_logs.

create table agent_run_logs (
  agent_run_log_id uuid primary key default gen_random_uuid(),
  agent_id uuid,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_ms integer,
  inputs_watermark jsonb,
  outputs_summary jsonb,
  status text not null default 'running',
  error text
);
create index agent_run_logs_agent_started_idx on agent_run_logs(agent_id, started_at desc);
