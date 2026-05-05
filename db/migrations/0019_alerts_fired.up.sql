create table alerts_fired (
  alert_fired_id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references agents(agent_id) on delete cascade,
  run_id uuid not null references agent_run_logs(agent_run_log_id) on delete cascade,
  rule_id text not null,
  finding_id uuid not null references findings(finding_id) on delete cascade,
  channels jsonb not null,
  trigger_refs jsonb not null,
  status text not null default 'pending_notification',
  fired_at timestamptz not null default now(),
  unique (agent_id, run_id, rule_id, finding_id),
  constraint alerts_fired_channels_array_chk check (jsonb_typeof(channels) = 'array'),
  constraint alerts_fired_trigger_refs_array_chk check (jsonb_typeof(trigger_refs) = 'array'),
  constraint alerts_fired_status_chk check (status in ('pending_notification', 'notified', 'failed', 'acknowledged'))
);

create index alerts_fired_agent_fired_idx on alerts_fired(agent_id, fired_at desc);
create index alerts_fired_run_idx on alerts_fired(run_id);
create index alerts_fired_finding_idx on alerts_fired(finding_id);
