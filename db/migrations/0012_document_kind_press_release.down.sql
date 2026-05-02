-- Postgres has no ALTER TYPE DROP VALUE, so the rollback rebuilds the
-- enum without 'press_release', swaps it onto documents.kind, and drops
-- the obsolete type. Refuse to roll back if any documents row still
-- uses kind='press_release' — silently dropping live data on rollback
-- would be the worst possible behavior.
do $$
begin
  if exists (select 1 from documents where kind = 'press_release') then
    raise exception 'cannot roll back 0012: documents row(s) still use kind=press_release; delete or reclassify them first';
  end if;
end$$;

create type document_kind__pre_0012 as enum (
  'filing', 'transcript', 'article', 'research_note', 'social_post', 'thread', 'upload'
);

-- Note: this ALTER COLUMN takes ACCESS EXCLUSIVE on documents and rewrites
-- every row. The DO/raise above guarantees no row's value actually changes
-- (kind is never 'press_release' here), but Postgres still forces a full
-- rewrite to validate the new type. Coordinate downtime for prod rollback.
alter table documents
  alter column kind type document_kind__pre_0012
  using kind::text::document_kind__pre_0012;

drop type document_kind;
alter type document_kind__pre_0012 rename to document_kind;
