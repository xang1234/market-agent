create table discovery_quote_claim_refs (
  quote_key text not null references discovery_quote_claims(quote_key) on delete cascade,
  run_id uuid not null references discovery_runs(run_id) on delete cascade,
  operation_key text not null check (length(btrim(operation_key)) > 0),
  request_hash text not null check (request_hash ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  primary key (quote_key, operation_key)
);

insert into discovery_quote_claim_refs (quote_key,run_id,operation_key,request_hash,created_at)
select quote_key,split_part(operation_key,'/',1)::uuid,operation_key,request_hash,created_at
  from discovery_quote_claims;

create index discovery_quote_claim_refs_run_idx on discovery_quote_claim_refs(run_id, quote_key);
