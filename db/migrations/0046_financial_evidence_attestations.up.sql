-- Verified finance: source-version publication proofs, numeric precision
-- attestations, and explicit financial contexts for facts. Additive only.
-- Nothing is backfilled: existing reported_at/observed_at timestamps, numeric
-- values, and document dates do not become attestations by migration.

create function prevent_financial_record_update() returns trigger
language plpgsql
as $$
begin
  raise exception '% rows are append-only; record a superseding row instead', tg_table_name;
end;
$$;

-- Facts are referenced together with their source so an attestation can only
-- describe the source a fact actually came from.
create unique index facts_fact_source_uidx on facts(fact_id, source_id);

create table source_publication_attestations (
  attestation_id uuid primary key default gen_random_uuid(),
  source_id uuid not null references sources(source_id) on delete cascade,
  document_id uuid references documents(document_id) on delete cascade,
  source_version_hash text not null check (source_version_hash ~ '^[0-9a-f]{64}$'),
  available_not_before timestamptz,
  available_no_later_than timestamptz not null,
  timing_precision text not null check (timing_precision in ('instant', 'date', 'observed_public')),
  source_timezone text not null check (length(btrim(source_timezone)) > 0),
  proof_method text not null check (proof_method in ('controlled_public_fetch', 'provider_publication_mapping', 'accession_bound_archive')),
  proof_ref text not null check (length(btrim(proof_ref)) > 0),
  proof_hash text not null check (proof_hash ~ '^[0-9a-f]{64}$'),
  mapping_version text not null check (length(btrim(mapping_version)) > 0),
  attested_at timestamptz not null default now(),
  supersedes uuid references source_publication_attestations(attestation_id),
  supersession_reason text check (supersession_reason in ('correction', 'reclassification')),
  constraint source_publication_attestations_bounds check (available_not_before is null or available_not_before <= available_no_later_than),
  constraint source_publication_attestations_supersession check ((supersedes is null) = (supersession_reason is null))
);
create unique index source_publication_attestations_successor_uidx on source_publication_attestations(supersedes) where supersedes is not null;
create index source_publication_attestations_version_idx on source_publication_attestations(source_id, source_version_hash);
create trigger source_publication_attestations_append_only
before update on source_publication_attestations
for each row execute function prevent_financial_record_update();

create table fact_precision_attestations (
  precision_attestation_id uuid primary key default gen_random_uuid(),
  fact_id uuid not null,
  source_id uuid not null,
  precision_class text not null check (precision_class in ('source_token_preserved', 'revalidated_against_source', 'legacy_unverified')),
  raw_token text check (raw_token is null or length(raw_token) between 1 and 256),
  token_proof_hash text check (token_proof_hash is null or token_proof_hash ~ '^[0-9a-f]{64}$'),
  value_text text check (value_text is null or value_text ~ '^-?(0|[1-9][0-9]*)(\.[0-9]*[1-9])?$'),
  scale_text text check (scale_text is null or scale_text ~ '^(0|[1-9][0-9]*)(\.[0-9]*[1-9])?$'),
  source_locator text,
  validation_method text not null check (length(btrim(validation_method)) > 0),
  attested_at timestamptz not null default now(),
  supersedes uuid references fact_precision_attestations(precision_attestation_id),
  foreign key (fact_id, source_id) references facts(fact_id, source_id) on delete cascade,
  constraint fact_precision_attestations_proof check (
    precision_class = 'legacy_unverified'
    or (raw_token is not null and token_proof_hash is not null and value_text is not null and scale_text is not null)
  )
);
create unique index fact_precision_attestations_successor_uidx on fact_precision_attestations(supersedes) where supersedes is not null;
-- One chain per fact: a single root, each proof superseded at most once.
create unique index fact_precision_attestations_root_uidx on fact_precision_attestations(fact_id) where supersedes is null;
create index fact_precision_attestations_fact_idx on fact_precision_attestations(fact_id, attested_at desc);
create trigger fact_precision_attestations_append_only
before update on fact_precision_attestations
for each row execute function prevent_financial_record_update();

create table fact_financial_contexts (
  fact_id uuid primary key references facts(fact_id) on delete cascade,
  context_version text not null check (length(btrim(context_version)) > 0),
  period_type text not null check (period_type in ('duration', 'instant')),
  dimension_scope text not null check (dimension_scope in ('consolidated', 'segment')),
  dimension_members jsonb not null default '[]'::jsonb check (jsonb_typeof(dimension_members) = 'array'),
  reporting_basis text not null check (reporting_basis in ('as_reported', 'as_restated')),
  adjustment_basis text not null check (adjustment_basis in ('unadjusted', 'split_adjusted')),
  share_basis text not null check (share_basis in ('basic', 'diluted', 'not_applicable')),
  fiscal_calendar_version text not null check (length(btrim(fiscal_calendar_version)) > 0),
  disclosure_relation text not null check (disclosure_relation in ('original', 'economic_restatement', 'extraction_correction')),
  source_context_ref text,
  created_at timestamptz not null default now(),
  constraint fact_financial_contexts_dimensions check ((dimension_scope = 'segment') = (jsonb_array_length(dimension_members) > 0))
);
create trigger fact_financial_contexts_append_only
before update on fact_financial_contexts
for each row execute function prevent_financial_record_update();

-- Content hashes are stored as bare hex or `sha256:<hex>`; proofs name the hex.
create function normalized_content_hash(content_hash text) returns text
language sql immutable
as $$
  select case when content_hash ~ '^(sha256:)?[0-9a-f]{64}$' then regexp_replace(content_hash, '^sha256:', '') end
$$;

-- A proof chain's current proof is the row nothing supersedes. Readers use
-- these views instead of repeating the anti-join.
create view current_source_publication_attestations as
select p.*
  from source_publication_attestations p
 where not exists (select 1 from source_publication_attestations newer where newer.supersedes = p.attestation_id);

create view current_fact_precision_attestations as
select a.*
  from fact_precision_attestations a
 where not exists (select 1 from fact_precision_attestations newer where newer.supersedes = a.precision_attestation_id);
