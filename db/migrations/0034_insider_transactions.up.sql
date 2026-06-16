-- Insider transactions (SEC Form 4) read model. Every reported transaction is
-- retained for the issuer's ownership record (Holders tab + Screener); the Form 4
-- handler materiality-gates the agent-visible subset into claims separately.
create table insider_transactions (
  insider_transaction_id uuid primary key default gen_random_uuid(),
  issuer_id         uuid not null references issuers(issuer_id) on delete cascade,
  insider_name      text not null,
  insider_role      text not null,
  insider_cik       text,
  transaction_date  date not null,
  transaction_code  text not null,
  transaction_type  text not null,
  acquired_disposed text not null check (acquired_disposed in ('A', 'D')),
  shares            numeric not null check (shares >= 0),
  price             numeric,
  value             numeric,
  source_id         uuid not null references sources(source_id),
  accession         text not null,
  filed_at          timestamptz not null,
  created_at        timestamptz not null default now()
);

create index insider_transactions_issuer_date_idx on insider_transactions(issuer_id, transaction_date desc);
create index insider_transactions_issuer_filed_idx on insider_transactions(issuer_id, filed_at desc);
