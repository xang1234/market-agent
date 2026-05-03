create table evidence_bundles (
  bundle_id uuid primary key,
  bundle jsonb not null,
  created_at timestamptz not null default now()
);
