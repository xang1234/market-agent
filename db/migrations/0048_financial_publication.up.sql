-- Verified finance: computation lineage, requested-output results, and
-- snapshot certificates. Legacy computations keep their columns and stay
-- readable; no existing snapshot or computation gains a certificate.

alter table computations add column financial_run_id uuid references financial_runs(run_id) on delete cascade;
alter table computations add column node_id text;
alter table computations add column operation_version text;
alter table computations add column numeric_policy_version text;
alter table computations add column definition_versions jsonb;
alter table computations add column output_hash text;
alter table computations add constraint computations_financial_lineage check (
  (financial_run_id is null and node_id is null and operation_version is null and numeric_policy_version is null
     and definition_versions is null and output_hash is null)
  or (financial_run_id is not null and node_id ~ '^[a-z][a-z0-9_]{0,63}$' and operation_version is not null
     and numeric_policy_version is not null and jsonb_typeof(definition_versions) = 'object'
     and output_hash ~ '^[0-9a-f]{64}$')
);
create unique index computations_financial_node_uidx on computations(financial_run_id, node_id) where financial_run_id is not null;
create unique index computations_financial_run_uidx on computations(computation_id, financial_run_id);

create function guard_financial_computation_update() returns trigger
language plpgsql
as $$
begin
  if old.financial_run_id is not null or new.financial_run_id is not null then
    raise exception 'financial computations are immutable';
  end if;
  return new;
end;
$$;
create trigger computations_financial_immutable
before update on computations
for each row execute function guard_financial_computation_update();

create table financial_results (
  result_id uuid primary key default gen_random_uuid(),
  run_id uuid not null references financial_runs(run_id) on delete cascade,
  output_id text not null check (output_id ~ '^[a-z][a-z0-9_]{0,63}$'),
  node_id text not null check (node_id ~ '^[a-z][a-z0-9_]{0,63}$'),
  unit_id text not null,
  computation_id uuid,
  state text not null check (state in ('draft', 'finalized')),
  disposition text not null check (disposition in (
    'computed', 'verified', 'missing', 'unsupported', 'not_applicable', 'undefined', 'incompatible', 'blocked_dependency', 'execution_error'
  )),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  dependencies jsonb not null check (jsonb_typeof(dependencies) = 'array'),
  result_hash text not null check (result_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  finalized_at timestamptz,
  unique (run_id, output_id),
  foreign key (run_id, unit_id) references financial_run_units(run_id, unit_id),
  foreign key (computation_id, run_id) references computations(computation_id, financial_run_id),
  constraint financial_results_state check (
    (state = 'draft' and disposition <> 'verified' and finalized_at is null)
    or (state = 'finalized' and disposition <> 'computed' and finalized_at is not null)
  )
);
create index financial_results_node_idx on financial_results(run_id, node_id);

-- Payloads and hashes never change. The only transition is draft -> finalized,
-- which may award 'verified' only to a computed result; finalized rows are frozen.
create function guard_financial_result_update() returns trigger
language plpgsql
as $$
begin
  if old.state = 'finalized' then
    raise exception 'finalized financial results are immutable';
  end if;
  if (new.result_id, new.run_id, new.output_id, new.node_id, new.unit_id, new.computation_id, new.payload, new.dependencies, new.result_hash, new.created_at)
     is distinct from
     (old.result_id, old.run_id, old.output_id, old.node_id, old.unit_id, old.computation_id, old.payload, old.dependencies, old.result_hash, old.created_at) then
    raise exception 'financial result payloads are immutable';
  end if;
  if new.state = 'finalized' and new.disposition is distinct from old.disposition
     and not (old.disposition = 'computed' and new.disposition = 'verified') then
    raise exception 'finalization may only verify a computed result';
  end if;
  return new;
end;
$$;
create trigger financial_results_guard
before update on financial_results
for each row execute function guard_financial_result_update();

create table snapshot_financial_runs (
  snapshot_id uuid not null references snapshots(snapshot_id) on delete cascade,
  run_id uuid not null,
  unit_id text not null,
  certificate jsonb not null check (jsonb_typeof(certificate) = 'object'),
  certificate_digest text not null check (certificate_digest ~ '^[0-9a-f]{64}$'),
  result_ids jsonb not null check (jsonb_typeof(result_ids) = 'array'),
  presentation_hash text not null check (presentation_hash ~ '^[0-9a-f]{64}$'),
  verifier_version text not null check (length(btrim(verifier_version)) > 0),
  created_at timestamptz not null default now(),
  primary key (snapshot_id, run_id, unit_id),
  unique (run_id, unit_id),
  foreign key (run_id, unit_id) references financial_run_units(run_id, unit_id)
);
create trigger snapshot_financial_runs_append_only
before update on snapshot_financial_runs
for each row execute function prevent_financial_record_update();

-- A certificate and its sealed unit must agree at commit, in either write order.
create function check_financial_certificate_unit() returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from financial_run_units u
     where u.run_id = new.run_id and u.unit_id = new.unit_id and u.state = 'sealed'
       and u.snapshot_id = new.snapshot_id and u.certificate_digest = new.certificate_digest
  ) then
    raise exception 'certificate for %/% does not match a sealed unit', new.run_id, new.unit_id;
  end if;
  return null;
end;
$$;
create constraint trigger snapshot_financial_runs_sealed_unit
after insert on snapshot_financial_runs
deferrable initially deferred
for each row execute function check_financial_certificate_unit();

create function check_financial_unit_certificate() returns trigger
language plpgsql
as $$
begin
  if new.state = 'sealed' and not exists (
    select 1 from snapshot_financial_runs c
     where c.run_id = new.run_id and c.unit_id = new.unit_id
       and c.snapshot_id = new.snapshot_id and c.certificate_digest = new.certificate_digest
  ) then
    raise exception 'sealed unit %/% has no matching certificate', new.run_id, new.unit_id;
  end if;
  return null;
end;
$$;
create constraint trigger financial_run_units_sealed_certificate
after insert or update on financial_run_units
deferrable initially deferred
for each row execute function check_financial_unit_certificate();
