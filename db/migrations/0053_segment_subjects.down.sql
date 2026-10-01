-- Refuse to roll back while facts still describe a segment: dropping the
-- segments table would orphan them silently.
do $$
begin
  if exists (select 1 from facts where subject_kind::text = 'segment') then
    raise exception 'cannot roll back 0053: facts still use subject_kind=segment; delete them first';
  end if;
end$$;

drop table segments;

-- ponytail: the 'segment' enum value stays. Postgres has no ALTER TYPE DROP
-- VALUE, and rebuilding subject_kind means swapping it on every table that uses
-- it (facts, mentions, theme and watchlist members, ...). An unused value is
-- harmless; rebuild only if a rollback must also remove it.
