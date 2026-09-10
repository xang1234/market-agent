create table discovery_campaigns (
  campaign_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(user_id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 120),
  question text not null check (length(btrim(question)) between 20 and 4000),
  current_brief_version integer not null default 0 check (current_brief_version >= 0),
  archived_at timestamptz,
  draft_lock_token uuid,
  draft_lock_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, user_id)
);

create table discovery_briefs (
  brief_id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references discovery_campaigns(campaign_id) on delete cascade,
  version integer not null check (version > 0),
  brief jsonb not null check (jsonb_typeof(brief) = 'object'),
  content_hash text not null check (content_hash ~ '^sha256:[0-9a-f]{64}$'),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (campaign_id, version),
  unique (brief_id, campaign_id)
);

create function prevent_discovery_approved_brief_mutation() returns trigger
language plpgsql
as $$
begin
  if old.approved_at is not null and new is distinct from old then
    raise exception 'approved discovery briefs are immutable';
  end if;
  return new;
end;
$$;
create trigger discovery_briefs_immutable
before update on discovery_briefs
for each row execute function prevent_discovery_approved_brief_mutation();

create table discovery_runs (
  run_id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null,
  user_id uuid not null,
  brief_id uuid not null,
  request_key uuid not null,
  status text not null check (status in ('queued','running','completed','partial','failed','cancelled')),
  stage text not null check (stage in ('queued','discovery','research','finalization')),
  policy_version text not null check (length(btrim(policy_version)) > 0),
  model_config jsonb not null default '[]'::jsonb check (jsonb_typeof(model_config) = 'array'),
  limits jsonb not null check (jsonb_typeof(limits) = 'object'),
  usage jsonb not null check (jsonb_typeof(usage) = 'object'),
  phase_usage jsonb not null default '{}'::jsonb check (jsonb_typeof(phase_usage) = 'object'),
  checkpoint jsonb not null check (jsonb_typeof(checkpoint) = 'object'),
  coverage jsonb not null check (jsonb_typeof(coverage) = 'object'),
  lease_owner text,
  lease_epoch bigint not null default 0 check (lease_epoch >= 0),
  lease_expires_at timestamptz,
  next_event_sequence bigint not null default 0 check (next_event_sequence >= 0),
  cancel_requested_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (campaign_id, user_id) references discovery_campaigns(campaign_id, user_id) on delete cascade,
  foreign key (brief_id, campaign_id) references discovery_briefs(brief_id, campaign_id) on delete restrict,
  unique (run_id, campaign_id),
  unique (campaign_id, request_key)
);
create unique index discovery_one_active_run_per_user
  on discovery_runs(user_id) where status in ('queued','running');
create index discovery_runs_campaign_created_idx on discovery_runs(campaign_id, created_at desc, run_id desc);

create table discovery_candidates (
  candidate_id uuid primary key,
  run_id uuid not null references discovery_runs(run_id) on delete cascade,
  lead_key text not null check (length(btrim(lead_key)) > 0),
  issuer_id uuid references issuers(issuer_id),
  listing_id uuid references listings(listing_id),
  identity_display jsonb check (identity_display is null or jsonb_typeof(identity_display) = 'object'),
  origins jsonb not null check (jsonb_typeof(origins) = 'array'),
  mechanism_ids jsonb not null check (jsonb_typeof(mechanism_ids) = 'array'),
  lead_hit_ids jsonb not null check (jsonb_typeof(lead_hit_ids) = 'array'),
  reason_codes jsonb not null check (jsonb_typeof(reason_codes) = 'array'),
  first_seen jsonb not null check (jsonb_typeof(first_seen) = 'array' and jsonb_array_length(first_seen) = 2),
  seed boolean not null,
  primary_domain_lead boolean not null,
  name text not null check (length(btrim(name)) > 0),
  state text not null check (state in ('unresolved_identity','discovered','not_selected','researching','shortlisted','eligible_not_shortlisted','excluded','needs_evidence','research_error')),
  selection_ordinal integer check (selection_ordinal between 1 and 25),
  analyst_output jsonb check (analyst_output is null or jsonb_typeof(analyst_output) = 'object'),
  skeptic_output jsonb check (skeptic_output is null or jsonb_typeof(skeptic_output) = 'object'),
  assessment jsonb check (assessment is null or jsonb_typeof(assessment) = 'object'),
  snapshot_id uuid references snapshots(snapshot_id),
  rank integer check (rank is null or rank between 1 and 10),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((issuer_id is null and listing_id is null) or (issuer_id is not null and listing_id is not null))
);
create unique index discovery_candidate_issuer on discovery_candidates(run_id, issuer_id)
  where issuer_id is not null;
create unique index discovery_candidate_lead on discovery_candidates(run_id, lead_key);
create unique index discovery_shortlist_rank on discovery_candidates(run_id, rank)
  where rank is not null;

create table discovery_attempts (
  attempt_id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references discovery_campaigns(campaign_id) on delete cascade,
  run_id uuid,
  operation_key text not null check (length(btrim(operation_key)) > 0),
  request_hash text not null check (request_hash ~ '^sha256:[0-9a-f]{64}$'),
  attempt_number integer not null check (attempt_number in (1,2)),
  resource text not null check (resource in ('search','document','identity','financial','model')),
  phase text not null check (phase in ('draft','discovery','research','verification')),
  candidate_id uuid references discovery_candidates(candidate_id) on delete cascade,
  outcome text not null check (outcome in ('reserved','success','error','unknown')),
  result jsonb check (result is null or jsonb_typeof(result) in ('object','array','string','number','boolean','null')),
  result_hash text,
  tool_call_id uuid,
  reserved_at timestamptz not null default now(),
  completed_at timestamptz,
  foreign key (run_id, campaign_id) references discovery_runs(run_id, campaign_id) on delete cascade,
  unique (campaign_id, operation_key, attempt_number)
);

create table discovery_events (
  run_id uuid not null references discovery_runs(run_id) on delete cascade,
  sequence bigint not null check (sequence > 0),
  candidate_id uuid references discovery_candidates(candidate_id) on delete cascade,
  stage text not null check (stage in ('queued','discovery','research','finalization')),
  event_kind text not null check (event_kind in ('search_completed','lead_resolved','document_acquired','criterion_assessed','skeptic_completed','budget_exhausted','run_resumed','run_finalized')),
  summary text not null check (length(btrim(summary)) between 1 and 2000),
  citation_refs jsonb not null check (jsonb_typeof(citation_refs) = 'array'),
  learning_concept_id text,
  created_at timestamptz not null default now(),
  primary key (run_id, sequence)
);
