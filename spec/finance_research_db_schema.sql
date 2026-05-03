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
  'filing', 'press_release', 'transcript', 'article', 'research_note', 'social_post', 'upload', 'internal'
);

create type trust_tier as enum ('primary', 'secondary', 'tertiary', 'user');
create type document_kind as enum ('filing', 'transcript', 'article', 'research_note', 'social_post', 'thread', 'upload', 'press_release');
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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index instruments_issuer_idx on instruments(issuer_id);
create unique index instruments_isin_idx on instruments(isin) where isin is not null;

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
  updated_at timestamptz not null default now()
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

create table fact_review_queue (
  review_id uuid primary key default gen_random_uuid(),
  candidate jsonb not null,
  reason text not null,
  source_id uuid references sources(source_id),
  metric_id uuid references metrics(metric_id),
  confidence numeric not null check (confidence >= 0 and confidence <= 1),
  threshold numeric not null check (threshold >= 0 and threshold <= 1),
  status text not null default 'queued' check (status in ('queued', 'reviewed', 'dismissed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index fact_review_queue_status_created_idx on fact_review_queue(status, created_at);
create index fact_review_queue_source_idx on fact_review_queue(source_id) where source_id is not null;
create index fact_review_queue_metric_idx on fact_review_queue(metric_id) where metric_id is not null;

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
  membership_spec jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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
  updated_at timestamptz not null default now()
);

-- Each analyze_template_runs row is a sealed memo: the snapshot anchors
-- the evidence, blocks holds the rendered Block[] payload, and
-- template_version is pinned at run time so editing the template later
-- does not rewrite history. snapshot_id intentionally lacks ON DELETE
-- CASCADE (mirrors chat_messages): deleting a referenced snapshot must
-- fail loudly, not silently orphan the memo.
create table analyze_template_runs (
  run_id uuid primary key default gen_random_uuid(),
  template_id uuid not null references analyze_templates(template_id) on delete cascade,
  template_version integer not null,
  snapshot_id uuid not null references snapshots(snapshot_id),
  blocks jsonb not null,
  created_at timestamptz not null default now()
);
create index analyze_template_runs_template_created_idx
  on analyze_template_runs(template_id, created_at desc);

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

create table run_activities (
  run_activity_id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references agents(agent_id) on delete cascade,
  stage activity_stage not null,
  subject_refs jsonb not null,
  source_refs jsonb not null default '[]'::jsonb,
  summary text not null,
  ts timestamptz not null default now()
);
create index run_activities_agent_ts_idx on run_activities(agent_id, ts desc);

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
  error text
);
create index agent_run_logs_agent_started_idx on agent_run_logs(agent_id, started_at desc);
