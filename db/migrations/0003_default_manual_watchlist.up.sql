-- P0.4b baseline (fra-6al.6.1): one implicit default manual watchlist per
-- user. The unique partial index enforces the "at most one manual
-- watchlist per user" invariant for this phase; fra-wlc will relax it when
-- multi-list management is introduced.

create unique index watchlists_default_manual_per_user_idx
  on watchlists(user_id)
  where mode = 'manual';

create function ensure_default_manual_watchlist() returns trigger
language plpgsql
as $$
begin
  insert into watchlists (user_id, name, mode)
  values (new.user_id, 'Watchlist', 'manual')
  on conflict do nothing;
  return new;
end;
$$;

create trigger users_default_manual_watchlist
after insert on users
for each row execute function ensure_default_manual_watchlist();

insert into watchlists (user_id, name, mode)
select u.user_id, 'Watchlist', 'manual'
  from users u
 where not exists (
   select 1 from watchlists w
    where w.user_id = u.user_id and w.mode = 'manual'
 )
on conflict do nothing;
