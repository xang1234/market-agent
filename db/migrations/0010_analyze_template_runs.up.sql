-- fra-dpj: persist analyze_template runs as sealed memos. Each row is one
-- run of a template against a snapshot; reruns produce new snapshot_ids
-- so old memos stay readable at their original snapshot.
create table analyze_template_runs (
  run_id uuid primary key default gen_random_uuid(),
  template_id uuid not null references analyze_templates(template_id) on delete cascade,
  template_version integer not null,
  snapshot_id uuid not null references snapshots(snapshot_id),
  blocks jsonb not null,
  created_at timestamptz not null default now()
);

-- Composite index for listAnalyzeTemplateRunsByTemplate: filter by
-- template_id, order by created_at desc (newest first).
create index analyze_template_runs_template_created_idx
  on analyze_template_runs(template_id, created_at desc);
