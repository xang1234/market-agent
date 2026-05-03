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
