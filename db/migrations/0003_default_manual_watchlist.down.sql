drop trigger if exists users_default_manual_watchlist on users;
drop function if exists ensure_default_manual_watchlist();
drop index if exists watchlists_default_manual_per_user_idx;
drop index if exists watchlists_default_per_user_idx;
alter table watchlists drop column if exists is_default;
