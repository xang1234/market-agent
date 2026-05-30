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
