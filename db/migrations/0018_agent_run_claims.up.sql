alter table agent_run_logs
  add column if not exists claim_expires_at timestamptz;

update agent_run_logs
   set claim_expires_at = coalesce(claim_expires_at, started_at + interval '15 minutes')
 where status = 'running'
   and ended_at is null;

create unique index agent_run_logs_one_running_per_agent_idx
  on agent_run_logs(agent_id)
  where agent_id is not null
    and status = 'running'
    and ended_at is null;
