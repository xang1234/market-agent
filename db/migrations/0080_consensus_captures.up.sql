-- Analyst consensus captured once a day from a dev provider (Finviz), one row
-- per field. These are attributed analyst expectations, never reported facts,
-- so they stay out of facts. A row is never rewritten: a later day's figure is
-- a new row, and a cell Finviz showed empty keeps its row with a null value.
-- fiscal_period names the fiscal period the field covers only when it follows
-- from the issuer's reported periods on file; fiscal_period_basis says how.
create table consensus_captures (
  capture_id uuid primary key default gen_random_uuid(),
  issuer_id uuid not null references issuers(issuer_id) on delete cascade,
  listing_id uuid not null references listings(listing_id) on delete cascade,
  source_id uuid not null references sources(source_id),
  captured_on date not null,
  retrieved_at timestamptz not null,
  field_key text not null check (field_key in (
    'eps_next_q', 'eps_next_y', 'eps_growth_this_y', 'eps_growth_next_y', 'eps_growth_next_5y', 'target_price', 'recommendation_mean'
  )),
  raw_label text not null,
  raw_value text not null,
  value numeric,
  unit text not null check (unit in ('usd_per_share', 'percent', 'usd', 'recommendation_1_to_5')),
  fiscal_period text,
  fiscal_period_basis text,
  constraint consensus_captures_fiscal_period_pair check ((fiscal_period is null) = (fiscal_period_basis is null)),
  unique (issuer_id, source_id, captured_on, field_key)
);
create index consensus_captures_listing_idx on consensus_captures(listing_id);
create trigger consensus_captures_append_only
before update on consensus_captures
for each row execute function prevent_financial_record_update();

insert into sources (source_id, provider, kind, canonical_url, trust_tier, license_class, retrieved_at) values
  ('00000000-0000-4000-a000-000000000015', 'finviz_dev_consensus', 'reference_data', 'https://finviz.com', 'tertiary', 'free_dev', '2000-01-01T00:00:00Z')
on conflict (source_id) do nothing;
