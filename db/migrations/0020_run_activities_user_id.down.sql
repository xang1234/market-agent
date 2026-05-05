drop index if exists run_activities_user_ts_idx;
alter table run_activities drop column if exists user_id;
