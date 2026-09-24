create table discovery_quote_claims (
  quote_key text primary key check (quote_key ~ '^sha256:[0-9a-f]{64}$'),
  operation_key text not null check (length(btrim(operation_key)) > 0),
  request_hash text not null check (request_hash ~ '^sha256:[0-9a-f]{64}$'),
  claim_id uuid not null unique references claims(claim_id) on delete restrict,
  document_id uuid not null references documents(document_id) on delete restrict,
  source_id uuid not null references sources(source_id) on delete restrict,
  document_hash text not null check (length(btrim(document_hash)) > 0),
  normalized_start integer not null check (normalized_start >= 0),
  quote_hash text not null check (quote_hash ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);

create index discovery_quote_claims_document_idx on discovery_quote_claims(document_id, quote_hash);
