-- Verified finance: immutable definitions and the owner-scoped run ledger.
-- Mutable lifecycle columns (state, lease, coverage) are separate from the
-- immutable validated plan, dependency closures, and bound-input payloads.
-- Finalizers lock a run row, then its unit rows ordered by unit_id.

create table financial_definition_versions (
  definition_version_id uuid primary key default gen_random_uuid(),
  catalog_version text not null check (length(btrim(catalog_version)) > 0),
  definition_kind text not null check (definition_kind in ('metric', 'ratio', 'operation')),
  definition_key text not null check (definition_key ~ '^[a-z][a-z0-9_]{0,63}$'),
  definition_version text not null check (length(btrim(definition_version)) > 0),
  metric_id uuid references metrics(metric_id),
  definition jsonb not null check (jsonb_typeof(definition) = 'object'),
  definition_hash text not null check (definition_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (definition_kind, definition_key, definition_version)
);
create trigger financial_definition_versions_append_only
before update on financial_definition_versions
for each row execute function prevent_financial_record_update();

create table financial_plans (
  plan_id uuid primary key,
  user_id uuid not null references users(user_id) on delete cascade,
  origin_kind text not null check (origin_kind in ('chat_request', 'analyze_section', 'grid_run', 'thesis_condition', 'discovery_criterion', 'api_request')),
  origin_ref text not null check (length(btrim(origin_ref)) > 0),
  catalog_version text not null check (length(btrim(catalog_version)) > 0),
  plan jsonb not null check (jsonb_typeof(plan) = 'object'),
  semantic_hash text not null check (semantic_hash ~ '^[0-9a-f]{64}$'),
  binding_hash text not null check (binding_hash ~ '^[0-9a-f]{64}$'),
  interpretation text,
  created_at timestamptz not null default now(),
  unique (plan_id, user_id),
  constraint financial_plans_identity check (plan->>'plan_id' = plan_id::text)
);
create trigger financial_plans_append_only
before update on financial_plans
for each row execute function prevent_financial_record_update();

create table financial_runs (
  run_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(user_id) on delete cascade,
  parent_kind text not null check (parent_kind in ('chat_thread', 'analyze_memo_run', 'analyst_grid_run', 'thesis_version', 'discovery_run')),
  parent_id uuid not null,
  parent_version text not null check (length(btrim(parent_version)) > 0),
  request_key text not null check (length(request_key) between 1 and 200),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  plan_id uuid not null,
  feature_mode text not null check (feature_mode in ('off', 'shadow', 'enforce')),
  knowledge_cutoff timestamptz not null,
  policies jsonb not null check (jsonb_typeof(policies) = 'object'),
  replay_of_run_id uuid references financial_runs(run_id),
  execution_state text not null default 'pending'
    check (execution_state in ('pending', 'running', 'ready_to_seal', 'completed', 'failed', 'cancelled')),
  coverage_state text check (coverage_state in ('complete', 'partial', 'none')),
  bound_at timestamptz,
  lease_owner text,
  lease_epoch bigint not null default 0 check (lease_epoch >= 0),
  lease_expires_at timestamptz,
  cancel_requested_at timestamptz,
  failure_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (plan_id, user_id) references financial_plans(plan_id, user_id),
  unique (user_id, parent_kind, parent_id, request_key),
  constraint financial_runs_lease check ((lease_owner is null) = (lease_expires_at is null)),
  constraint financial_runs_failure check ((execution_state = 'failed') = (failure_code is not null))
);
create index financial_runs_owner_idx on financial_runs(user_id, created_at desc);
create index financial_runs_expired_lease_idx on financial_runs(lease_expires_at)
  where execution_state in ('pending', 'running');

create function guard_financial_run_update() returns trigger
language plpgsql
as $$
begin
  if (new.user_id, new.parent_kind, new.parent_id, new.parent_version, new.request_key, new.request_hash,
      new.plan_id, new.feature_mode, new.knowledge_cutoff, new.policies, new.replay_of_run_id, new.created_at)
     is distinct from
     (old.user_id, old.parent_kind, old.parent_id, old.parent_version, old.request_key, old.request_hash,
      old.plan_id, old.feature_mode, old.knowledge_cutoff, old.policies, old.replay_of_run_id, old.created_at) then
    raise exception 'financial_runs identity, plan, and policy columns are immutable';
  end if;
  if old.execution_state in ('completed', 'failed', 'cancelled') and new.execution_state is distinct from old.execution_state then
    raise exception 'financial run % is terminal (%)', old.run_id, old.execution_state;
  end if;
  if new.lease_epoch < old.lease_epoch then
    raise exception 'financial run lease epochs never decrease';
  end if;
  return new;
end;
$$;
create trigger financial_runs_guard
before update on financial_runs
for each row execute function guard_financial_run_update();

create table financial_run_units (
  run_id uuid not null references financial_runs(run_id) on delete cascade,
  unit_id text not null check (unit_id ~ '^[a-z][a-z0-9_]{0,63}$'),
  unit_kind text not null check (unit_kind in ('chat_section', 'analyze_section', 'grid_cell', 'thesis_condition', 'discovery_assessment')),
  output_ids jsonb not null check (jsonb_typeof(output_ids) = 'array' and jsonb_array_length(output_ids) > 0),
  closure_node_ids jsonb not null check (jsonb_typeof(closure_node_ids) = 'array' and jsonb_array_length(closure_node_ids) > 0),
  closure_hash text not null check (closure_hash ~ '^[0-9a-f]{64}$'),
  state text not null default 'pending' check (state in ('pending', 'computed', 'sealed', 'rejected')),
  coverage_state text check (coverage_state in ('complete', 'partial', 'none')),
  rejection_code text,
  snapshot_id uuid references snapshots(snapshot_id),
  certificate_digest text check (certificate_digest ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (run_id, unit_id),
  constraint financial_run_units_sealed check ((state = 'sealed') = (snapshot_id is not null and certificate_digest is not null)),
  constraint financial_run_units_rejected check ((state = 'rejected') = (rejection_code is not null))
);
create index financial_run_units_pending_idx on financial_run_units(run_id) where state in ('pending', 'computed');

create function guard_financial_run_unit_update() returns trigger
language plpgsql
as $$
begin
  if (new.run_id, new.unit_id, new.unit_kind, new.output_ids, new.closure_node_ids, new.closure_hash, new.created_at)
     is distinct from
     (old.run_id, old.unit_id, old.unit_kind, old.output_ids, old.closure_node_ids, old.closure_hash, old.created_at) then
    raise exception 'financial_run_units membership and closure are immutable';
  end if;
  if old.state in ('sealed', 'rejected') and new is distinct from old then
    raise exception 'financial run unit %/% is final (%)', old.run_id, old.unit_id, old.state;
  end if;
  return new;
end;
$$;
create trigger financial_run_units_guard
before update on financial_run_units
for each row execute function guard_financial_run_unit_update();

create table financial_run_inputs (
  run_id uuid not null references financial_runs(run_id) on delete cascade,
  input_slot text not null check (input_slot ~ '^[a-z][a-z0-9_]{0,63}$'),
  binding_status text not null check (binding_status in ('bound', 'gap')),
  fact_id uuid references facts(fact_id),
  publication_attestation_id uuid references source_publication_attestations(attestation_id),
  precision_attestation_id uuid references fact_precision_attestations(precision_attestation_id),
  bound_payload jsonb check (bound_payload is null or jsonb_typeof(bound_payload) = 'object'),
  payload_hash text check (payload_hash ~ '^[0-9a-f]{64}$'),
  gap_reason text,
  selection_policy_version text not null check (length(btrim(selection_policy_version)) > 0),
  candidate_set_digest text not null check (candidate_set_digest ~ '^[0-9a-f]{64}$'),
  candidate_count integer not null check (candidate_count >= 0),
  truncated boolean not null default false,
  bound_at timestamptz not null default now(),
  primary key (run_id, input_slot),
  constraint financial_run_inputs_binding check (
    (binding_status = 'bound' and fact_id is not null and publication_attestation_id is not null
       and precision_attestation_id is not null and bound_payload is not null and payload_hash is not null and gap_reason is null)
    or (binding_status = 'gap' and gap_reason is not null and bound_payload is null and payload_hash is null)
  )
);
create trigger financial_run_inputs_append_only
before update on financial_run_inputs
for each row execute function prevent_financial_record_update();

create table financial_run_events (
  run_id uuid not null references financial_runs(run_id) on delete cascade,
  sequence bigint not null check (sequence > 0),
  event_kind text not null check (event_kind in (
    'run_created', 'lease_acquired', 'lease_expired', 'inputs_bound', 'unit_computed', 'unit_sealed', 'unit_rejected',
    'run_ready_to_seal', 'run_completed', 'run_failed', 'run_cancelled'
  )),
  unit_id text,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  primary key (run_id, sequence)
);
create trigger financial_run_events_append_only
before update on financial_run_events
for each row execute function prevent_financial_record_update();
