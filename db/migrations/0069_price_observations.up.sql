-- A share price as one provider response stated it (#444), so the financial
-- engine can bind it as a certified input. price_text is the provider's exact
-- token, and body_sha256 hashes the whole response it came in. known_at is the
-- earliest instant the capture proves the price was public, null when it proves
-- none. Rows are insert-only: capturing the same statement again is the same row
-- (price_observations_identity), and a revised price is a new row, known later.
create table price_observations (
  observation_id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references listings(listing_id),
  source_id uuid not null references sources(source_id),
  kind text not null check (kind in ('last_trade', 'session_close')),
  price_text text not null check (
    case when price_text ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?$' then price_text::numeric > 0 else false end
  ),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  observed_at timestamptz not null,
  known_at timestamptz,
  fetched_at timestamptz not null,
  body_sha256 text not null check (body_sha256 ~ '^[0-9a-f]{64}$'),
  -- A price is on the split basis of its own trade date; binding restates it.
  adjustment_basis text not null default 'unadjusted' check (adjustment_basis = 'unadjusted'),
  created_at timestamptz not null default now(),
  constraint price_observations_known_at check (known_at is null or (known_at >= observed_at and known_at <= fetched_at)),
  constraint price_observations_identity unique (listing_id, source_id, kind, observed_at, price_text)
);
create trigger price_observations_append_only
before update or delete on price_observations
for each row execute function prevent_financial_record_update();

-- A bound input is a fact with its two proofs, or a price observation.
alter table financial_run_inputs add column price_observation_id uuid references price_observations(observation_id);
alter table financial_run_inputs drop constraint financial_run_inputs_binding;
alter table financial_run_inputs add constraint financial_run_inputs_binding check (
  (binding_status = 'bound' and bound_payload is not null and payload_hash is not null and gap_reason is null
     and ((fact_id is not null and publication_attestation_id is not null and precision_attestation_id is not null and price_observation_id is null)
       or (price_observation_id is not null and fact_id is null and publication_attestation_id is null and precision_attestation_id is null)))
  or (binding_status = 'gap' and gap_reason is not null and bound_payload is null and payload_hash is null)
);
