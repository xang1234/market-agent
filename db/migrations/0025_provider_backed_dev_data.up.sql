alter type source_kind add value if not exists 'reference_data';
alter type source_kind add value if not exists 'market_data';

create table if not exists market_quote_snapshots (
  quote_snapshot_id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references listings(listing_id) on delete cascade,
  source_id uuid not null references sources(source_id),
  provider text not null,
  price numeric not null check (price > 0),
  prev_close numeric not null check (prev_close > 0),
  session_state text not null check (session_state in ('pre_market', 'regular', 'post_market', 'closed')),
  as_of timestamptz not null,
  delay_class text not null check (delay_class in ('real_time', 'delayed_15m', 'eod', 'unknown')),
  currency text not null,
  fetched_at timestamptz not null,
  expires_at timestamptz not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (listing_id, source_id, as_of)
);
create index if not exists market_quote_snapshots_fresh_idx
  on market_quote_snapshots(listing_id, expires_at desc, as_of desc);

create table if not exists market_bar_ranges (
  bar_range_id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references listings(listing_id) on delete cascade,
  source_id uuid not null references sources(source_id),
  provider text not null,
  interval text not null check (interval in ('1m', '5m', '15m', '1h', '1d')),
  adjustment_basis text not null check (adjustment_basis in ('unadjusted', 'split_adjusted', 'split_and_div_adjusted')),
  range_start timestamptz not null,
  range_end timestamptz not null,
  as_of timestamptz not null,
  delay_class text not null check (delay_class in ('real_time', 'delayed_15m', 'eod', 'unknown')),
  currency text not null,
  fetched_at timestamptz not null,
  expires_at timestamptz not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (range_start < range_end),
  unique (listing_id, source_id, interval, adjustment_basis, range_start, range_end)
);
create index if not exists market_bar_ranges_fresh_idx
  on market_bar_ranges(listing_id, interval, adjustment_basis, expires_at desc);

create table if not exists market_bars (
  bar_range_id uuid not null references market_bar_ranges(bar_range_id) on delete cascade,
  ts timestamptz not null,
  open numeric not null check (open > 0),
  high numeric not null check (high > 0),
  low numeric not null check (low > 0),
  close numeric not null check (close > 0),
  volume numeric not null check (volume >= 0),
  primary key (bar_range_id, ts),
  check (high >= low and high >= open and high >= close and low <= open and low <= close)
);

create table if not exists screener_screens (
  screen_id uuid primary key,
  user_id uuid not null references users(user_id) on delete cascade,
  name text not null,
  definition jsonb not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  check (created_at <= updated_at)
);
create index if not exists screener_screens_user_updated_idx
  on screener_screens(user_id, updated_at desc);
