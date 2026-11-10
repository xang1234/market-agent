-- Ten years of daily closes captured from a dev provider (yfinance), to anchor
-- a Call's exit multiple against the company's own history (ADR 0005). These
-- closes are split adjusted, so a later split restates every earlier close:
-- they are never certified and stay out of price_observations and market_bars.
-- A capture is a whole set of closes dated by captured_on, the UTC day the
-- provider answered. Rows are never rewritten: a later day's capture is a new
-- set, a same-day rerun inserts nothing, and a reader takes the latest
-- captured_on per listing and source. close_text is the provider's exact token.
create table daily_close_captures (
  listing_id uuid not null references listings(listing_id) on delete cascade,
  source_id uuid not null references sources(source_id),
  captured_on date not null,
  retrieved_at timestamptz not null,
  trade_date date not null,
  close_text text not null check (
    case when close_text ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?$' then close_text::numeric > 0 else false end
  ),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  adjustment_basis text not null check (adjustment_basis = 'split_adjusted'),
  primary key (listing_id, source_id, captured_on, trade_date)
);
create trigger daily_close_captures_append_only
before update on daily_close_captures
for each row execute function prevent_financial_record_update();
