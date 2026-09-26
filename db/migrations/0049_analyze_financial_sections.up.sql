-- Verified numerical memo sections. Each row is written by the financial
-- finalization transaction that seals the section's snapshot and certificate,
-- so a section exists exactly when its certificate does. The memo run's
-- metadata declares which sections were requested; a declared section without
-- a row here is a gap, never silently complete coverage.

create table analyze_run_financial_sections (
  analyze_run_id uuid not null references analyze_template_runs(run_id) on delete cascade,
  section_id text not null check (section_id ~ '^[a-z][a-z0-9_]{0,63}$'),
  financial_run_id uuid not null,
  unit_id text not null,
  snapshot_id uuid not null,
  certificate_digest text not null check (certificate_digest ~ '^[0-9a-f]{64}$'),
  block jsonb not null check (jsonb_typeof(block) = 'object' and block->>'kind' = 'financial_answer'),
  created_at timestamptz not null default now(),
  primary key (analyze_run_id, section_id),
  unique (financial_run_id, unit_id),
  foreign key (snapshot_id, financial_run_id, unit_id) references snapshot_financial_runs(snapshot_id, run_id, unit_id)
);
create trigger analyze_run_financial_sections_append_only
before update on analyze_run_financial_sections
for each row execute function prevent_financial_record_update();
