-- Finance Research App schema pack
-- Target dialect: PostgreSQL 15+
-- Notes:
-- 1. App metadata may live in D1/Postgres. Evidence plane should live in Postgres.
-- 2. subject_kind + subject_id is used where a cross-table reference is required.
-- 3. Generated columns, partitioning, and advanced indexes are omitted where vendor-specific.
-- Table families:
-- reference and universe tables define reusable subject context and membership state.
-- evidence-plane relational tables hold provenance, facts, claims, events, and snapshots.
-- app metadata and orchestration tables support user state and workflow coordination.
-- raw document bytes live outside the relational schema and are referenced by metadata.
-- Identity contract:
-- issuer = reporting entity; instrument = tradable security definition; listing = venue-specific symbol.
-- ticker is a listing locator, not canonical identity.

create extension if not exists pgcrypto;

create type subject_kind as enum (
  'issuer', 'instrument', 'listing', 'theme', 'macro_topic', 'portfolio', 'screen'
);

create type asset_type as enum (
  'common_stock', 'adr', 'etf', 'index', 'crypto', 'fx', 'bond'
);

create type source_kind as enum (
  'filing',
  'press_release',
  'transcript',
  'article',
  'research_note',
  'social_post',
  'upload',
  'internal',
  'reference_data',
  'market_data'
);

create type trust_tier as enum ('primary', 'secondary', 'tertiary', 'user');
create type document_kind as enum ('filing', 'transcript', 'article', 'research_note', 'social_post', 'thread', 'upload', 'press_release');
create type ir_source_type as enum (
  'rss',
  'atom',
  'sitemap',
  'html_index',
  'hosted_pattern',
  'manual_url'
);
create type ir_asset_kind as enum (
  'press_release',
  'presentation',
  'transcript'
);
create type parse_status as enum ('pending', 'parsed', 'failed', 'superseded');
create type fact_method as enum ('reported', 'derived', 'estimated', 'vendor', 'extracted');
create type verification_status as enum ('authoritative', 'candidate', 'corroborated', 'disputed');
create type freshness_class as enum ('real_time', 'delayed_15m', 'eod', 'filing_time', 'stale');
create type coverage_level as enum ('full', 'partial', 'sparse', 'unavailable');
create type claim_modality as enum ('asserted', 'estimated', 'speculative', 'rumored', 'quoted');
create type claim_status as enum ('extracted', 'corroborated', 'disputed', 'rejected');
create type polarity as enum ('positive', 'negative', 'neutral', 'mixed');
create type impact_direction as enum ('positive', 'negative', 'mixed', 'unknown');
create type impact_horizon as enum ('near_term', 'medium_term', 'long_term');
create type event_status as enum ('reported', 'confirmed', 'canceled');
create type finding_severity as enum ('low', 'medium', 'high', 'critical');
create type activity_stage as enum ('reading', 'investigating', 'found', 'dismissed');
create type watchlist_mode as enum ('manual', 'screen', 'agent', 'theme', 'portfolio');
create type chat_role as enum ('user', 'assistant', 'tool');

create table users (
  user_id uuid primary key default gen_random_uuid(),
  email text unique not null,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table issuers (
  issuer_id uuid primary key default gen_random_uuid(),
  legal_name text not null,
  former_names jsonb not null default '[]'::jsonb,
  cik text,
  lei text,
  domicile text,
  sector text,
  industry text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index issuers_cik_idx on issuers(cik) where cik is not null;
create unique index issuers_lei_idx on issuers(lei) where lei is not null;

create table issuer_aliases (
  issuer_alias_id uuid primary key default gen_random_uuid(),
  issuer_id uuid not null references issuers(issuer_id) on delete cascade,
  raw_name text not null,
  normalized_name text not null,
  match_reason text not null check (match_reason in ('legal_name', 'former_name')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index issuer_aliases_normalized_name_idx on issuer_aliases(normalized_name);
create unique index issuer_aliases_unique_idx on issuer_aliases(issuer_id, match_reason, raw_name);

create function normalize_issuer_alias_name(alias_name text) returns text
language sql
immutable
as $$
  select btrim(
    regexp_replace(
      regexp_replace(lower(alias_name), '[^[:alnum:][:space:]]+', ' ', 'g'),
      '[[:space:]]+',
      ' ',
      'g'
    )
  );
$$;

create function refresh_issuer_aliases() returns trigger
language plpgsql
as $$
begin
  delete from issuer_aliases where issuer_id = new.issuer_id;

  insert into issuer_aliases (issuer_id, raw_name, normalized_name, match_reason)
  select new.issuer_id,
         new.legal_name,
         normalize_issuer_alias_name(new.legal_name),
         'legal_name'
   where normalize_issuer_alias_name(new.legal_name) <> ''
  on conflict do nothing;

  insert into issuer_aliases (issuer_id, raw_name, normalized_name, match_reason)
  select new.issuer_id,
         former_name.raw_name,
         normalize_issuer_alias_name(former_name.raw_name),
         'former_name'
    from (
      select value #>> '{}' as raw_name
        from jsonb_array_elements(new.former_names) as former_name(value)
       where jsonb_typeof(value) = 'string'
    ) as former_name
   where normalize_issuer_alias_name(former_name.raw_name) <> ''
  on conflict do nothing;

  return new;
end;
$$;

create trigger issuers_refresh_aliases
after insert or update of legal_name, former_names on issuers
for each row execute function refresh_issuer_aliases();

-- Instruments model the tradable security independent of venue so share classes,
-- ADRs, ETFs, bonds, and other instrument variants are not collapsed into issuer identity.
create table instruments (
  instrument_id uuid primary key default gen_random_uuid(),
  issuer_id uuid not null references issuers(issuer_id) on delete cascade,
  asset_type asset_type not null,
  share_class text,
  isin text,
  figi_composite text,
  cusip text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index instruments_issuer_idx on instruments(issuer_id);
create unique index instruments_isin_idx on instruments(isin) where isin is not null;
create unique index instruments_figi_composite_idx on instruments(figi_composite) where figi_composite is not null;
create index instruments_cusip_idx on instruments(cusip) where cusip is not null;

-- Listings model venue-specific symbol state. Use listing identity for quotes, bars,
-- session state, and other market interactions that depend on exchange context.
create table listings (
  listing_id uuid primary key default gen_random_uuid(),
  instrument_id uuid not null references instruments(instrument_id) on delete cascade,
  mic text not null,
  ticker text not null,
  trading_currency text not null,
  timezone text not null,
  active_from timestamptz,
  active_to timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (mic, ticker, active_from)
);
create index listings_instrument_idx on listings(instrument_id);
create index listings_ticker_idx on listings(ticker);

create table themes (
  theme_id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  membership_mode text not null check (membership_mode in ('manual', 'rule_based', 'inferred')),
  membership_spec jsonb,
  active_from timestamptz,
  active_to timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table theme_memberships (
  theme_membership_id uuid primary key default gen_random_uuid(),
  theme_id uuid not null references themes(theme_id) on delete cascade,
  subject_kind subject_kind not null,
  subject_id uuid not null,
  score numeric,
  rationale_claim_ids jsonb not null default '[]'::jsonb,
  effective_at timestamptz not null default now(),
  expires_at timestamptz,
  unique (theme_id, subject_kind, subject_id)
);
-- Covering indexes for the list ORDER BY (score desc nulls last, effective_at asc).
-- The leading column also satisfies the WHERE filter, so a separate single-column
-- index would be redundant.
create index theme_memberships_theme_score_idx
  on theme_memberships(theme_id, score desc nulls last, effective_at asc);
create index theme_memberships_subject_score_idx
  on theme_memberships(subject_kind, subject_id, score desc nulls last, effective_at asc);

create table portfolios (
  portfolio_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(user_id) on delete cascade,
  name text not null,
  base_currency text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table portfolio_holdings (
  portfolio_holding_id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null references portfolios(portfolio_id) on delete cascade,
  subject_kind subject_kind not null,
  subject_id uuid not null,
  quantity numeric not null,
  cost_basis numeric,
  opened_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index portfolio_holdings_subject_idx on portfolio_holdings(subject_kind, subject_id);

create table metrics (
  metric_id uuid primary key default gen_random_uuid(),
  metric_key text not null unique,
  display_name text not null,
  unit_class text not null,
  aggregation text not null,
  interpretation text not null,
  canonical_source_class text not null,
  definition_version integer not null default 1,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table sources (
  source_id uuid primary key default gen_random_uuid(),
  provider text not null,
  kind source_kind not null,
  canonical_url text,
  trust_tier trust_tier not null,
  license_class text not null,
  retrieved_at timestamptz not null,
  content_hash text,
  user_id uuid references users(user_id) on delete cascade,
  created_at timestamptz not null default now()
);
create index sources_provider_kind_idx on sources(provider, kind);
create index sources_user_id_idx on sources(user_id) where user_id is not null;

create table issuer_profile_enrichments (
  issuer_id uuid not null references issuers(issuer_id) on delete cascade,
  field_name text not null check (field_name in ('domicile', 'sector', 'industry')),
  field_value text not null check (length(field_value) > 0),
  source_id uuid not null references sources(source_id),
  provider text not null,
  retrieved_at timestamptz not null,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (issuer_id, field_name, source_id)
);
create index issuer_profile_enrichments_fresh_idx
  on issuer_profile_enrichments(issuer_id, field_name, retrieved_at desc);

create table market_quote_snapshots (
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
create index market_quote_snapshots_fresh_idx
  on market_quote_snapshots(listing_id, expires_at desc, as_of desc);

create table market_bar_ranges (
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
create index market_bar_ranges_fresh_idx
  on market_bar_ranges(listing_id, interval, adjustment_basis, expires_at desc);

create table market_bars (
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

create table documents (
  document_id uuid primary key default gen_random_uuid(),
  source_id uuid not null references sources(source_id) on delete cascade,
  provider_doc_id text,
  kind document_kind not null,
  parent_document_id uuid references documents(document_id),
  conversation_id text,
  title text,
  author text,
  published_at timestamptz,
  lang text,
  content_hash text not null,
  raw_blob_id text not null,
  parse_status parse_status not null default 'pending',
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index documents_content_hash_idx on documents(content_hash, raw_blob_id);
create index documents_source_idx on documents(source_id);
create index documents_published_idx on documents(published_at desc);
create index documents_parent_idx on documents(parent_document_id) where parent_document_id is not null;
create index documents_conversation_idx on documents(conversation_id) where conversation_id is not null;
create index documents_provider_doc_id_idx on documents(provider_doc_id) where deleted_at is null and provider_doc_id is not null;

create table ir_source_registry (
  ir_source_id uuid primary key default gen_random_uuid(),
  issuer_id uuid not null references issuers(issuer_id) on delete cascade,
  source_type ir_source_type not null,
  url text not null check (url ~* '^https://'),
  provider_hint text,
  document_kind document_kind,
  enabled boolean not null default false,
  last_crawled_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  etag text,
  last_modified text,
  crawl_interval_seconds integer not null default 86400 check (crawl_interval_seconds > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (issuer_id, url)
);
create index ir_source_registry_enabled_idx
  on ir_source_registry(issuer_id, enabled, source_type);

create table ir_document_assets (
  ir_document_asset_id uuid primary key default gen_random_uuid(),
  ir_source_id uuid references ir_source_registry(ir_source_id) on delete set null,
  issuer_id uuid not null references issuers(issuer_id) on delete cascade,
  document_id uuid not null references documents(document_id) on delete cascade,
  source_id uuid not null references sources(source_id) on delete cascade,
  asset_kind ir_asset_kind not null,
  canonical_url text not null check (canonical_url ~* '^https://'),
  hosted_provider text,
  issuer_attested boolean not null default true,
  content_type text,
  discovered_at timestamptz not null,
  fetched_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (issuer_id, canonical_url),
  unique (document_id)
);
create index ir_document_assets_issuer_kind_idx
  on ir_document_assets(issuer_id, asset_kind, fetched_at desc);
create index ir_document_assets_source_idx
  on ir_document_assets(source_id);

create table object_blob_gc_queue (
  raw_blob_id text primary key check (raw_blob_id ~ '^sha256:[0-9a-f]{64}$'),
  reason text not null check (reason in ('user_erasure')),
  source_user_id uuid references users(user_id) on delete set null,
  queued_at timestamptz not null default now(),
  next_attempt_at timestamptz not null default now(),
  last_checked_at timestamptz,
  deleted_at timestamptz,
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  updated_at timestamptz not null default now()
);
create index object_blob_gc_queue_pending_idx
  on object_blob_gc_queue(next_attempt_at, queued_at, raw_blob_id)
  where deleted_at is null;
create index object_blob_gc_queue_source_user_idx
  on object_blob_gc_queue(source_user_id)
  where source_user_id is not null;

create table mentions (
  mention_id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(document_id) on delete cascade,
  subject_kind subject_kind not null,
  subject_id uuid not null,
  prominence text not null check (prominence in ('headline', 'lead', 'body', 'incidental')),
  mention_count integer not null default 1,
  confidence numeric not null check (confidence >= 0 and confidence <= 1),
  created_at timestamptz not null default now()
);
create index mentions_subject_idx on mentions(subject_kind, subject_id);
create index mentions_document_idx on mentions(document_id);
create unique index mentions_document_subject_prominence_idx
  on mentions(document_id, subject_kind, subject_id, prominence);

create table claims (
  claim_id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(document_id) on delete cascade,
  predicate text not null,
  text_canonical text not null,
  polarity polarity not null,
  modality claim_modality not null,
  reported_by_source_id uuid not null references sources(source_id),
  attributed_to_type text,
  attributed_to_id text,
  effective_time timestamptz,
  confidence numeric not null check (confidence >= 0 and confidence <= 1),
  status claim_status not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  superseded_at timestamptz,
  enriched_at timestamptz
);
create index claims_document_idx on claims(document_id);
create index claims_predicate_idx on claims(predicate);
create index claims_status_idx on claims(status);

create table claim_arguments (
  claim_argument_id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references claims(claim_id) on delete cascade,
  subject_kind subject_kind not null,
  subject_id uuid not null,
  role text not null,
  created_at timestamptz not null default now()
);
create index claim_arguments_subject_idx on claim_arguments(subject_kind, subject_id);
create index claim_arguments_claim_idx on claim_arguments(claim_id);

create table entity_impacts (
  entity_impact_id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references claims(claim_id) on delete cascade,
  subject_kind subject_kind not null,
  subject_id uuid not null,
  direction impact_direction not null,
  channel text not null check (channel in ('demand', 'pricing', 'supply_chain', 'regulation', 'competition', 'balance_sheet', 'sentiment')),
  horizon impact_horizon not null,
  confidence numeric not null check (confidence >= 0 and confidence <= 1),
  created_at timestamptz not null default now()
);
create index entity_impacts_subject_idx on entity_impacts(subject_kind, subject_id);
create index entity_impacts_claim_idx on entity_impacts(claim_id);

create table claim_evidence (
  claim_evidence_id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references claims(claim_id) on delete cascade,
  document_id uuid not null references documents(document_id) on delete cascade,
  locator jsonb not null,
  excerpt_hash text,
  confidence numeric not null check (confidence >= 0 and confidence <= 1),
  created_at timestamptz not null default now()
);
create index claim_evidence_claim_idx on claim_evidence(claim_id);

create table claim_clusters (
  cluster_id uuid primary key default gen_random_uuid(),
  canonical_signature text not null unique,
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  support_count integer not null default 0,
  contradiction_count integer not null default 0,
  aggregate_confidence numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table claim_cluster_members (
  claim_cluster_member_id uuid primary key default gen_random_uuid(),
  cluster_id uuid not null references claim_clusters(cluster_id) on delete cascade,
  claim_id uuid not null references claims(claim_id) on delete cascade,
  relation text not null check (relation in ('support', 'contradict')),
  created_at timestamptz not null default now(),
  unique (cluster_id, claim_id)
);
create index claim_cluster_members_claim_idx on claim_cluster_members(claim_id);

create table events (
  event_id uuid primary key default gen_random_uuid(),
  event_type text not null,
  occurred_at timestamptz not null,
  status event_status not null,
  source_claim_ids jsonb not null default '[]'::jsonb,
  source_ids jsonb not null default '[]'::jsonb,
  payload_json jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index events_type_occured_idx on events(event_type, occurred_at desc);

create table event_subjects (
  event_subject_id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(event_id) on delete cascade,
  subject_kind subject_kind not null,
  subject_id uuid not null,
  role text,
  created_at timestamptz not null default now()
);
create index event_subjects_subject_idx on event_subjects(subject_kind, subject_id);
create index event_subjects_event_idx on event_subjects(event_id);

-- Truth and evidence contract:
-- facts are immutable except through supersession or invalidation.
-- verification_status and source_id preserve provenance and promotion state for displayed values.
create table facts (
  fact_id uuid primary key default gen_random_uuid(),
  subject_kind subject_kind not null,
  subject_id uuid not null,
  metric_id uuid not null references metrics(metric_id),
  period_kind text not null check (period_kind in ('point', 'fiscal_q', 'fiscal_y', 'ttm', 'range')),
  period_start date,
  period_end date,
  fiscal_year integer,
  fiscal_period text,
  value_num numeric,
  value_text text,
  unit text not null,
  currency text,
  scale numeric not null default 1,
  as_of timestamptz not null,
  reported_at timestamptz,
  observed_at timestamptz not null,
  source_id uuid not null references sources(source_id),
  method fact_method not null,
  adjustment_basis text,
  definition_version integer not null default 1,
  verification_status verification_status not null,
  freshness_class freshness_class not null,
  coverage_level coverage_level not null,
  quality_flags jsonb not null default '[]'::jsonb,
  entitlement_channels jsonb not null default '["app"]'::jsonb,
  confidence numeric not null check (confidence >= 0 and confidence <= 1),
  supersedes uuid references facts(fact_id),
  superseded_by uuid references facts(fact_id),
  invalidated_at timestamptz,
  ingestion_batch_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index facts_subject_metric_idx on facts(subject_kind, subject_id, metric_id);
create index facts_metric_period_idx on facts(metric_id, period_end desc);
create index facts_asof_idx on facts(as_of desc);
create index facts_verification_idx on facts(verification_status);
create unique index facts_active_reported_identity_idx
  on facts(subject_kind, subject_id, metric_id, period_kind, fiscal_year, fiscal_period, source_id, method)
  where method = 'reported'
    and invalidated_at is null
    and superseded_by is null
    and fiscal_year is not null
    and fiscal_period is not null;

create table fact_review_queue (
  review_id uuid primary key default gen_random_uuid(),
  candidate jsonb not null,
  reason text not null,
  source_id uuid references sources(source_id) on delete set null,
  metric_id uuid references metrics(metric_id),
  confidence numeric not null check (confidence >= 0 and confidence <= 1),
  threshold numeric not null check (threshold >= 0 and threshold <= 1),
  status text not null default 'queued' check (status in ('queued', 'reviewed', 'dismissed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reviewed_by text,
  reviewed_at timestamptz,
  fact_id uuid references facts(fact_id),
  constraint fact_review_queue_review_metadata_chk check (
    (
      status = 'queued'
      and reviewed_by is null
      and reviewed_at is null
      and fact_id is null
    ) or (
      status = 'reviewed'
      and reviewed_by is not null
      and length(btrim(reviewed_by)) > 0
      and reviewed_at is not null
      and fact_id is not null
    ) or (
      status = 'dismissed'
      and reviewed_by is not null
      and length(btrim(reviewed_by)) > 0
      and reviewed_at is not null
      and fact_id is null
    )
  )
);
create index fact_review_queue_status_created_idx on fact_review_queue(status, created_at);
create index fact_review_queue_source_idx on fact_review_queue(source_id) where source_id is not null;
create index fact_review_queue_metric_idx on fact_review_queue(metric_id) where metric_id is not null;

create table fact_review_actions (
  action_id uuid primary key default gen_random_uuid(),
  review_id uuid not null references fact_review_queue(review_id),
  action text not null check (action in ('approved', 'rejected', 'edited')),
  reviewer_id text not null check (length(btrim(reviewer_id)) > 0),
  notes text,
  candidate_before jsonb not null,
  candidate_after jsonb,
  fact_id uuid references facts(fact_id),
  created_at timestamptz not null default now()
);
create index fact_review_actions_review_created_idx on fact_review_actions(review_id, created_at);
create index fact_review_actions_reviewer_created_idx on fact_review_actions(reviewer_id, created_at desc);

create table evidence_bundles (
  bundle_id uuid primary key,
  bundle jsonb not null,
  created_at timestamptz not null default now()
);

create function prevent_evidence_bundle_modification() returns trigger
language plpgsql
as $$
begin
  raise exception 'evidence_bundles are immutable and cannot be modified or deleted';
end;
$$;

create trigger evidence_bundles_immutable
before update or delete on evidence_bundles
for each row execute function prevent_evidence_bundle_modification();

create table computations (
  computation_id uuid primary key default gen_random_uuid(),
  formula_id text not null,
  code_version text not null,
  input_refs jsonb not null,
  output_ref jsonb not null,
  created_at timestamptz not null default now()
);

-- claims remain evidence-layer assertions rather than canonical truth.
create table snapshots (
  snapshot_id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  subject_refs jsonb not null,
  fact_refs jsonb not null default '[]'::jsonb,
  claim_refs jsonb not null default '[]'::jsonb,
  event_refs jsonb not null default '[]'::jsonb,
  document_refs jsonb not null default '[]'::jsonb,
  series_specs jsonb not null default '[]'::jsonb,
  source_ids jsonb not null default '[]'::jsonb,
  tool_call_ids jsonb not null default '[]'::jsonb,
  tool_call_result_hashes jsonb not null default '[]'::jsonb,
  as_of timestamptz not null,
  basis text not null,
  normalization text not null,
  coverage_start timestamptz,
  allowed_transforms jsonb not null,
  model_version text,
  parent_snapshot uuid references snapshots(snapshot_id)
);
create index snapshots_created_idx on snapshots(created_at desc);

create table watchlists (
  watchlist_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(user_id) on delete cascade,
  name text not null,
  mode watchlist_mode not null,
  is_default boolean not null default false,
  membership_spec jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint watchlists_default_manual_mode_chk check (not is_default or mode = 'manual')
);
create unique index watchlists_default_per_user_idx on watchlists(user_id) where is_default;

create function ensure_default_manual_watchlist() returns trigger
language plpgsql
as $$
begin
  insert into watchlists (user_id, name, mode, is_default)
  values (new.user_id, 'Watchlist', 'manual', true)
  on conflict do nothing;
  return new;
end;
$$;

create trigger users_default_manual_watchlist
after insert on users
for each row execute function ensure_default_manual_watchlist();

create table watchlist_members (
  watchlist_member_id uuid primary key default gen_random_uuid(),
  watchlist_id uuid not null references watchlists(watchlist_id) on delete cascade,
  subject_kind subject_kind not null,
  subject_id uuid not null,
  position integer,
  created_at timestamptz not null default now(),
  unique (watchlist_id, subject_kind, subject_id)
);
create index watchlist_members_subject_idx on watchlist_members(subject_kind, subject_id);

create table analyze_templates (
  template_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(user_id) on delete cascade,
  name text not null,
  prompt_template text not null,
  source_categories jsonb not null default '[]'::jsonb,
  added_subject_refs jsonb not null default '[]'::jsonb,
  block_layout_hint jsonb,
  peer_policy jsonb,
  disclosure_policy jsonb,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Each analyze_template_runs row is a sealed memo: the snapshot anchors
-- the evidence, blocks holds the rendered Block[] payload, and
-- template_version is pinned at run time so editing the template later
-- does not rewrite history. snapshot_id intentionally lacks ON DELETE
-- CASCADE (mirrors chat_messages): deleting a referenced snapshot must
-- fail loudly, not silently orphan the memo.
create table analyze_template_runs (
  run_id uuid primary key default gen_random_uuid(),
  template_id uuid not null references analyze_templates(template_id),
  template_version integer not null,
  playbook_id text,
  run_metadata jsonb not null default '{}'::jsonb,
  snapshot_id uuid not null references snapshots(snapshot_id),
  blocks jsonb not null,
  created_at timestamptz not null default now()
);
create index analyze_template_runs_template_created_idx
  on analyze_template_runs(template_id, created_at desc, run_id desc);
create index analyze_templates_user_template_idx
  on analyze_templates(user_id, template_id);
create index analyze_template_runs_playbook_created_idx
  on analyze_template_runs(playbook_id, created_at desc)
  where playbook_id is not null;

create table agents (
  agent_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(user_id) on delete cascade,
  name text not null,
  thesis text not null,
  universe jsonb not null,
  source_policy jsonb,
  cadence text not null,
  prompt_template text,
  alert_rules jsonb not null default '[]'::jsonb,
  watermarks jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table findings (
  finding_id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references agents(agent_id) on delete cascade,
  snapshot_id uuid not null references snapshots(snapshot_id) on delete cascade,
  subject_refs jsonb not null,
  claim_cluster_ids jsonb not null default '[]'::jsonb,
  severity finding_severity not null,
  headline text not null,
  summary_blocks jsonb not null,
  created_at timestamptz not null default now()
);
-- findings must point at a sealed snapshot and remain user-facing artifacts.
create index findings_agent_created_idx on findings(agent_id, created_at desc);

create table screener_screens (
  screen_id uuid primary key,
  user_id uuid not null references users(user_id) on delete cascade,
  name text not null,
  definition jsonb not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  check (created_at <= updated_at)
);
create index screener_screens_user_updated_idx on screener_screens(user_id, updated_at desc);

create table run_activities (
  run_activity_id uuid primary key default gen_random_uuid(),
  user_id uuid references users(user_id) on delete cascade,
  agent_id uuid not null references agents(agent_id) on delete cascade,
  stage activity_stage not null,
  subject_refs jsonb not null,
  source_refs jsonb not null default '[]'::jsonb,
  summary text not null,
  ts timestamptz not null default now()
);
create index run_activities_agent_ts_idx on run_activities(agent_id, ts desc);
create index run_activities_user_ts_idx on run_activities(user_id, ts desc) where user_id is not null;

create table chat_threads (
  thread_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(user_id) on delete cascade,
  primary_subject_kind subject_kind,
  primary_subject_id uuid,
  title text,
  latest_snapshot_id uuid references snapshots(snapshot_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create index chat_threads_user_updated_idx on chat_threads(user_id, updated_at desc);

create table chat_messages (
  message_id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references chat_threads(thread_id) on delete cascade,
  role chat_role not null,
  snapshot_id uuid not null references snapshots(snapshot_id),
  blocks jsonb not null,
  content_hash text not null,
  created_at timestamptz not null default now()
);
create index chat_messages_thread_created_idx on chat_messages(thread_id, created_at);

create table tool_call_logs (
  tool_call_id uuid primary key default gen_random_uuid(),
  thread_id uuid,
  agent_id uuid,
  tool_name text not null,
  args jsonb not null,
  result_hash text,
  duration_ms integer,
  status text not null,
  error_code text,
  created_at timestamptz not null default now()
);
create index tool_call_logs_thread_idx on tool_call_logs(thread_id, created_at desc);
create index tool_call_logs_agent_idx on tool_call_logs(agent_id, created_at desc);

create table citation_logs (
  citation_log_id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references snapshots(snapshot_id) on delete cascade,
  block_id text not null,
  ref_kind text not null,
  ref_id uuid not null,
  source_id uuid,
  created_at timestamptz not null default now()
);
create index citation_logs_snapshot_idx on citation_logs(snapshot_id);

create table verifier_fail_logs (
  verifier_fail_log_id uuid primary key default gen_random_uuid(),
  thread_id uuid,
  snapshot_id uuid,
  reason_code text not null,
  details jsonb,
  created_at timestamptz not null default now()
);

create table eval_run_results (
  eval_run_result_id uuid primary key default gen_random_uuid(),
  suite_name text not null,
  model_version text not null,
  prompt_version text not null,
  result_json jsonb not null,
  created_at timestamptz not null default now()
);

create table agent_run_logs (
  agent_run_log_id uuid primary key default gen_random_uuid(),
  agent_id uuid,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_ms integer,
  inputs_watermark jsonb,
  outputs_summary jsonb,
  status text not null default 'running',
  error text,
  claim_expires_at timestamptz
);
create index agent_run_logs_agent_started_idx on agent_run_logs(agent_id, started_at desc);
create unique index if not exists agent_run_logs_one_running_per_agent_idx
  on agent_run_logs(agent_id)
  where agent_id is not null
    and status = 'running'
    and ended_at is null;

create table alerts_fired (
  alert_fired_id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references agents(agent_id) on delete cascade,
  run_id uuid not null references agent_run_logs(agent_run_log_id) on delete cascade,
  rule_id text not null,
  finding_id uuid not null references findings(finding_id) on delete cascade,
  channels jsonb not null,
  trigger_refs jsonb not null,
  status text not null default 'pending_notification',
  notification_delivery jsonb not null default '{}'::jsonb,
  delivery_attempts integer not null default 0,
  last_delivery_error text,
  last_delivery_at timestamptz,
  fired_at timestamptz not null default now(),
  unique (agent_id, run_id, rule_id, finding_id),
  constraint alerts_fired_channels_array_chk check (jsonb_typeof(channels) = 'array'),
  constraint alerts_fired_trigger_refs_array_chk check (jsonb_typeof(trigger_refs) = 'array'),
  constraint alerts_fired_notification_delivery_object_chk check (jsonb_typeof(notification_delivery) = 'object'),
  constraint alerts_fired_delivery_attempts_nonnegative_chk check (delivery_attempts >= 0),
  constraint alerts_fired_status_chk check (status in ('pending_notification', 'delivering', 'notified', 'failed', 'acknowledged'))
);
create index alerts_fired_agent_fired_idx on alerts_fired(agent_id, fired_at desc);
create index alerts_fired_run_idx on alerts_fired(run_id);
create index alerts_fired_finding_idx on alerts_fired(finding_id);
create index alerts_fired_pending_delivery_idx on alerts_fired(fired_at asc) where status = 'pending_notification';

create table research_grids (
  grid_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(user_id) on delete cascade,
  name text not null,
  description text,
  universe_spec jsonb not null,
  column_specs jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (created_at <= updated_at)
);

create table grid_runs (
  grid_run_id uuid primary key default gen_random_uuid(),
  grid_id uuid not null references research_grids(grid_id) on delete cascade,
  user_id uuid not null references users(user_id) on delete cascade,
  status text not null check (status in ('pending','running','partial','completed','failed')),
  as_of timestamptz not null,
  cell_total integer not null default 0 check (cell_total >= 0),
  cell_done integer not null default 0 check (cell_done >= 0),
  dropped_row_count integer not null default 0 check (dropped_row_count >= 0),
  error_message text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  check (cell_done <= cell_total),
  check (completed_at is null or completed_at >= started_at)
);

create table grid_rows (
  grid_row_id uuid primary key default gen_random_uuid(),
  grid_run_id uuid not null references grid_runs(grid_run_id) on delete cascade,
  row_number integer not null check (row_number >= 0),
  subject_ref jsonb not null,
  period_context jsonb,
  status text not null check (status in ('pending','resolved','failed')),
  created_at timestamptz not null default now(),
  unique (grid_run_id, row_number)
);

create table grid_cells (
  grid_cell_id uuid primary key default gen_random_uuid(),
  grid_row_id uuid not null references grid_rows(grid_row_id) on delete cascade,
  grid_run_id uuid not null references grid_runs(grid_run_id) on delete cascade,
  column_key text not null,
  status text not null check (status in ('pending','ok','missing_data','no_coverage','error')),
  display jsonb,
  snapshot_id uuid references snapshots(snapshot_id),
  primary_ref jsonb,
  coverage_flag text,
  computed_at timestamptz,
  unique (grid_row_id, column_key)
);

create index research_grids_user_idx on research_grids(user_id);
create index grid_runs_grid_idx on grid_runs(grid_id, started_at desc);
create index grid_rows_run_idx on grid_rows(grid_run_id);
create index grid_cells_row_idx on grid_cells(grid_row_id);
create index grid_cells_snapshot_idx on grid_cells(snapshot_id);

create table artifact_ingestion_ledger (
  ledger_id          uuid primary key default gen_random_uuid(),
  provider           text not null,
  release_tag        text not null,
  market             text not null,
  schema_version     text not null,
  bundle_asset_name  text not null,
  sha256             text not null,
  as_of_date         date not null,
  source_id          uuid not null references sources(source_id),
  ingestion_batch_id uuid not null,
  rows_total         integer not null default 0 check (rows_total >= 0),
  rows_ingested      integer not null default 0 check (rows_ingested >= 0),
  rows_skipped       integer not null default 0 check (rows_skipped >= 0),
  status             text not null default 'succeeded' check (status in ('succeeded', 'partial', 'failed')),
  started_at         timestamptz not null,
  finished_at        timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  unique (release_tag, market, sha256),
  check (finished_at >= started_at)
);

create index artifact_ingestion_ledger_lookup_idx
  on artifact_ingestion_ledger(release_tag, market, as_of_date desc, finished_at desc);

create table edgar_crawl_ledger (
  ledger_id        uuid primary key default gen_random_uuid(),
  form             text not null,
  index_date       date not null,
  status           text not null default 'succeeded' check (status in ('succeeded', 'partial', 'failed')),
  filings_total    integer not null default 0 check (filings_total >= 0),
  filings_ingested integer not null default 0 check (filings_ingested >= 0),
  filings_skipped  integer not null default 0 check (filings_skipped >= 0),
  started_at       timestamptz not null,
  finished_at      timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  unique (form, index_date),
  check (filings_ingested + filings_skipped = filings_total),
  check (finished_at >= started_at)
);

create index edgar_crawl_ledger_form_date_idx
  on edgar_crawl_ledger(form, index_date desc);

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
  period_of_report  date,
  filed_at          timestamptz not null,
  created_at        timestamptz not null default now()
);
create index insider_transactions_issuer_date_idx on insider_transactions(issuer_id, transaction_date desc);
create index insider_transactions_issuer_filed_idx on insider_transactions(issuer_id, filed_at desc);
create index insider_transactions_supersede_idx on insider_transactions(issuer_id, period_of_report, insider_cik);

-- 13F institutional holdings (superinvestor-seeded v1) read model. One aggregated
-- row per (filer, issuer, reporting period); only CUSIP-resolvable holdings are
-- stored. Notable period-over-period changes are gated into claims by the handler.
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
