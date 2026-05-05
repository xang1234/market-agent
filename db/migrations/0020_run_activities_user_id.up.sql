alter table run_activities
  add column user_id uuid references users(user_id) on delete cascade;

create index run_activities_user_ts_idx
  on run_activities(user_id, ts desc)
  where user_id is not null;
