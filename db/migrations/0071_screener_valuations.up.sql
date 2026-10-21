-- The screener's market cap and P/E come only from certified engine figures
-- (#444). A batch certifies the screener universe in runs of at most 25
-- issuers, each under its own screener_valuation_runs row. One service user
-- owns every such run: financial_runs.user_id is required, and these runs
-- belong to no person.
insert into users (user_id, email, display_name)
values ('00000000-0000-4000-8000-0000000005ee', 'screener-certification@system.invalid', 'Screener certification')
on conflict (user_id) do nothing;

alter table financial_runs drop constraint financial_runs_parent_kind_check;
alter table financial_runs add constraint financial_runs_parent_kind_check
  check (parent_kind in ('chat_thread', 'analyze_memo_run', 'analyst_grid_run', 'thesis_version', 'discovery_run', 'screener_valuation_run'));
alter table financial_run_units drop constraint financial_run_units_unit_kind_check;
alter table financial_run_units add constraint financial_run_units_unit_kind_check
  check (unit_kind in ('chat_section', 'analyze_section', 'grid_cell', 'thesis_condition', 'discovery_assessment', 'screener_valuation'));

-- One certification run: its cutoff, and the issuer each plan row values. A
-- unit id cannot hold a UUID, so a sealed figure finds its issuer here.
-- Deleting the row erases its financial run.
create table screener_valuation_runs (
  screener_valuation_run_id uuid primary key default gen_random_uuid(),
  as_of timestamptz not null,
  -- [{"row": 0, "issuer_id": "...", "listing_id": "..." or null, "timezone": "America/New_York"}]
  subjects jsonb not null check (jsonb_typeof(subjects) = 'array' and jsonb_array_length(subjects) between 1 and 25),
  created_at timestamptz not null default now()
);
create index screener_valuation_runs_as_of_idx on screener_valuation_runs(as_of);
create trigger screener_valuation_runs_erase_financial_runs
after delete on screener_valuation_runs
for each row execute function erase_financial_runs_referencing($$parent_kind = 'screener_valuation_run' and parent_id = $1$$, 'screener_valuation_run_id');

-- An issuer's latest certified market cap or P/E, or the gap the engine
-- sealed instead, written by the finalization transaction that seals it.
-- A refresh replaces the row, never with an older cutoff, and never a value
-- with a gap in the value's own session. The row goes with its certificate,
-- so erased evidence takes the value with it.
create table screener_certified_valuations (
  issuer_id uuid not null references issuers(issuer_id) on delete cascade,
  valuation text not null check (valuation in ('market_cap', 'pe_ratio')),
  knowledge_cutoff timestamptz not null,
  -- The last regular session the cutoff had closed, in the listing's zone.
  -- The screener shows the value until a later session closes.
  session_date date not null,
  value numeric,
  -- The price's currency; a P/E has none.
  currency text check (currency ~ '^[A-Z]{3}$'),
  reason_code text,
  -- The one active common-stock listing the figure is priced on; null when
  -- the issuer had several.
  listing_id uuid references listings(listing_id) on delete cascade,
  snapshot_id uuid not null,
  financial_run_id uuid not null,
  financial_unit_id text not null,
  primary key (issuer_id, valuation),
  unique (financial_run_id, financial_unit_id),
  constraint screener_certified_valuations_value check ((value is null) <> (reason_code is null)),
  constraint screener_certified_valuations_currency check ((currency is not null) = (valuation = 'market_cap' and value is not null)),
  constraint screener_certified_valuations_market_cap check (valuation <> 'market_cap' or value >= 0),
  foreign key (snapshot_id, financial_run_id, financial_unit_id) references snapshot_financial_runs(snapshot_id, run_id, unit_id) on delete cascade
);
