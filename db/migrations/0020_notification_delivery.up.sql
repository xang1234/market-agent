create table notification_preferences (
  notification_preference_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(user_id) on delete cascade,
  agent_id uuid references agents(agent_id) on delete cascade,
  channel text not null,
  enabled boolean not null default true,
  digest_cadence text not null default 'immediate',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, agent_id, channel),
  constraint notification_preferences_channel_chk check (channel in ('in_app', 'web_push', 'mobile_push', 'email', 'sms', 'digest')),
  constraint notification_preferences_digest_cadence_chk check (digest_cadence in ('immediate', 'hourly', 'daily', 'weekly'))
);
create index notification_preferences_user_channel_idx
  on notification_preferences(user_id, channel);

create table notification_deliveries (
  notification_delivery_id uuid primary key default gen_random_uuid(),
  alert_fired_id uuid references alerts_fired(alert_fired_id) on delete cascade,
  user_id uuid not null references users(user_id) on delete cascade,
  agent_id uuid references agents(agent_id) on delete cascade,
  channel text not null,
  status text not null,
  payload jsonb not null default '{}'::jsonb,
  blocked_fact_ids jsonb not null default '[]'::jsonb,
  provider_message_id text,
  attempted_at timestamptz not null default now(),
  constraint notification_deliveries_channel_chk check (channel in ('in_app', 'web_push', 'mobile_push', 'email', 'sms', 'digest')),
  constraint notification_deliveries_status_chk check (status in ('delivered', 'blocked_entitlement', 'throttled', 'batched', 'failed')),
  constraint notification_deliveries_blocked_fact_ids_array_chk check (jsonb_typeof(blocked_fact_ids) = 'array')
);
create index notification_deliveries_user_channel_idx
  on notification_deliveries(user_id, channel, attempted_at desc);
create index notification_deliveries_alert_fired_idx
  on notification_deliveries(alert_fired_id);
