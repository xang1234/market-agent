-- Rolling back fra-wlc returns to the P0.4b invariant of one manual
-- watchlist per user. Non-default manual lists cannot be represented there,
-- so they are removed before restoring the old unique index.
delete from watchlists
 where mode = 'manual'
   and is_default = false;

drop index if exists watchlists_default_per_user_idx;

create unique index if not exists watchlists_default_manual_per_user_idx
  on watchlists(user_id)
  where mode = 'manual';

create or replace function ensure_default_manual_watchlist() returns trigger
language plpgsql
as $$
begin
  insert into watchlists (user_id, name, mode)
  values (new.user_id, 'Watchlist', 'manual')
  on conflict do nothing;
  return new;
end;
$$;

alter table watchlists drop column if exists is_default;
