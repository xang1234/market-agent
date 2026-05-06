-- P0.4b baseline (fra-6al.6.1): one implicit default manual watchlist per
-- user. fra-wlc later relaxed "one manual list" into "one default list",
-- so the durable discriminator is is_default rather than mode='manual'.

alter table watchlists add column if not exists is_default boolean not null default false;

drop index if exists watchlists_default_manual_per_user_idx;

create unique index if not exists watchlists_default_per_user_idx
  on watchlists(user_id)
  where is_default;

create function ensure_default_manual_watchlist() returns trigger
language plpgsql
as $$
begin
  insert into watchlists (user_id, name, mode, is_default)
  values (new.user_id, 'Watchlist', 'manual', true)
  on conflict do nothing;
  return new;
end;
$$;

create trigger users_default_manual_watchlist
after insert on users
for each row execute function ensure_default_manual_watchlist();

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

insert into watchlists (user_id, name, mode, is_default)
select u.user_id, 'Watchlist', 'manual', true
  from users u
 where not exists (
   select 1 from watchlists w
    where w.user_id = u.user_id and w.is_default
 )
on conflict do nothing;
