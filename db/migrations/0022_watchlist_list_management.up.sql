alter table watchlists add column if not exists is_default boolean not null default false;

with existing_default as (
  select distinct on (user_id) watchlist_id
    from watchlists
   where mode = 'manual'
   order by user_id, created_at asc, watchlist_id asc
)
update watchlists w
   set is_default = true
  from existing_default d
 where w.watchlist_id = d.watchlist_id;

drop index if exists watchlists_default_manual_per_user_idx;

create unique index if not exists watchlists_default_per_user_idx
  on watchlists(user_id)
  where is_default;

create or replace function ensure_default_manual_watchlist() returns trigger
language plpgsql
as $$
begin
  insert into watchlists (user_id, name, mode, is_default)
  values (new.user_id, 'Watchlist', 'manual', true)
  on conflict do nothing;
  return new;
end;
$$;

insert into watchlists (user_id, name, mode, is_default)
select u.user_id, 'Watchlist', 'manual', true
  from users u
 where not exists (
   select 1 from watchlists w
    where w.user_id = u.user_id and w.is_default
 )
on conflict do nothing;
