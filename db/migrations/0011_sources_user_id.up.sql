-- fra-1ji: user-scoped uploads. Adding user_id to sources lets every
-- documents row inherit visibility scope through its source_id FK without
-- duplicating the column on each documents row. The column is nullable
-- because the vast majority of sources (filings, press releases, social
-- posts, etc.) are public and have no user owner.
alter table sources
  add column user_id uuid references users(user_id) on delete cascade;

-- Partial index: most rows have user_id IS NULL (public sources). Indexing
-- only the user-owned rows keeps the index compact and matches the only
-- query shape that uses it (filter by user_id, scoped to uploads).
create index sources_user_id_idx on sources(user_id) where user_id is not null;
