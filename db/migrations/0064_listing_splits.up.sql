-- Stock splits per listing (#387), as the provider listed them at the last
-- complete fetch (split-repository.ts). The coverage row records that fetch, so
-- a reader can tell "checked, no split" from "never checked", which the events
-- table cannot.
create table listing_splits (
  listing_id uuid not null references listings(listing_id) on delete cascade,
  execution_date date not null,
  split_from numeric not null check (split_from > 0),
  split_to numeric not null check (split_to > 0),
  source_id uuid not null references sources(source_id),
  provider_ref text,
  created_at timestamptz not null default now(),
  primary key (listing_id, execution_date)
);

create table listing_split_coverage (
  listing_id uuid primary key references listings(listing_id) on delete cascade,
  checked_at timestamptz not null,
  source_id uuid not null references sources(source_id)
);
