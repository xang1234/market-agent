create table if not exists issuer_profile_enrichments (
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

create index if not exists issuer_profile_enrichments_fresh_idx
  on issuer_profile_enrichments(issuer_id, field_name, retrieved_at desc);
