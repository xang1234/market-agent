drop index if exists alerts_fired_pending_delivery_idx;

update alerts_fired
   set status = 'failed',
       last_delivery_error = coalesce(last_delivery_error, 'delivery was in progress during alert delivery metadata rollback')
 where status = 'delivering';

alter table alerts_fired
  drop constraint if exists alerts_fired_delivery_attempts_nonnegative_chk,
  drop constraint if exists alerts_fired_notification_delivery_object_chk,
  drop constraint if exists alerts_fired_status_chk,
  add constraint alerts_fired_status_chk
    check (status in ('pending_notification', 'notified', 'failed', 'acknowledged')),
  drop column if exists last_delivery_at,
  drop column if exists last_delivery_error,
  drop column if exists delivery_attempts,
  drop column if exists notification_delivery;
