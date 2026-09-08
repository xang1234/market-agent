create table agent_thesis_versions (
  thesis_version_id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references agents(agent_id) on delete cascade,
  version integer not null check (version > 0),
  thesis text not null check (length(btrim(thesis)) > 0),
  subject_ref jsonb not null check (jsonb_typeof(subject_ref) = 'object'),
  conditions jsonb not null check (jsonb_typeof(conditions) = 'array'),
  created_at timestamptz not null default now(),
  unique (agent_id, version)
);

create index agent_thesis_versions_agent_created_idx
  on agent_thesis_versions(agent_id, version desc);

create table agent_thesis_assessments (
  assessment_id uuid primary key default gen_random_uuid(),
  thesis_version_id uuid not null references agent_thesis_versions(thesis_version_id) on delete cascade,
  run_id uuid not null,
  snapshot_id uuid not null references snapshots(snapshot_id) on delete cascade,
  input_hash text not null check (length(btrim(input_hash)) between 1 and 512),
  results jsonb not null check (jsonb_typeof(results) = 'array'),
  model_version text,
  prompt_version text not null check (length(btrim(prompt_version)) > 0),
  assessed_at timestamptz not null default now(),
  unique (thesis_version_id, input_hash)
);

create index agent_thesis_assessments_version_assessed_idx
  on agent_thesis_assessments(thesis_version_id, assessed_at desc);
