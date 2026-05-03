drop index if exists sources_user_id_idx;
alter table sources drop column if exists user_id;
