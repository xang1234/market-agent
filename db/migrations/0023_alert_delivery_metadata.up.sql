alter table alerts_fired
  add column if not exists notification_delivery jsonb not null default '{}'::jsonb,
  add column if not exists delivery_attempts integer not null default 0,
  add column if not exists last_delivery_error text,
  add column if not exists last_delivery_at timestamptz;

alter table alerts_fired
  drop constraint if exists alerts_fired_status_chk,
  add constraint alerts_fired_status_chk
    check (status in ('pending_notification', 'delivering', 'notified', 'failed', 'acknowledged'));

alter table alerts_fired
  add constraint alerts_fired_notification_delivery_object_chk
    check (jsonb_typeof(notification_delivery) = 'object'),
  add constraint alerts_fired_delivery_attempts_nonnegative_chk
    check (delivery_attempts >= 0);

create index if not exists alerts_fired_pending_delivery_idx
  on alerts_fired(fired_at asc)
  where status = 'pending_notification';
