drop index if exists agent_run_logs_one_running_per_agent_idx;

alter table agent_run_logs
  drop column if exists claim_expires_at;
