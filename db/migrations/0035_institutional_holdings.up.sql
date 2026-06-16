-- 13F institutional holdings (superinvestor-seeded v1) read model. One aggregated
-- row per (filer, issuer, reporting period): the 13F handler sums the multiple
-- infoTable rows a filer reports per CUSIP. Only CUSIP-resolvable holdings are
-- stored (issuer_id not null); misses are logged. Notable period-over-period
-- changes are materiality-gated into claims separately by the handler.
create table institutional_holdings (
  institutional_holding_id uuid primary key default gen_random_uuid(),
  filer_cik      text not null,
  filer_name     text not null,
  issuer_id      uuid not null references issuers(issuer_id) on delete cascade,
  cusip          text not null,
  shares         numeric not null check (shares >= 0),
  value_usd      numeric not null check (value_usd >= 0),
  filing_period  date not null,
  filing_date    date not null,
  source_id      uuid not null references sources(source_id),
  accession      text not null,
  created_at     timestamptz not null default now(),
  unique (filer_cik, issuer_id, filing_period)
);

create index institutional_holdings_issuer_period_idx on institutional_holdings(issuer_id, filing_period desc);
create index institutional_holdings_filer_period_idx on institutional_holdings(filer_cik, filing_period desc);

-- CUSIP lives on the instrument (alongside isin/figi_composite); 13F resolution
-- matches on it, or derives it from a US ISIN (US + 9-char CUSIP + check digit).
alter table instruments add column cusip text;
create index instruments_cusip_idx on instruments(cusip);
