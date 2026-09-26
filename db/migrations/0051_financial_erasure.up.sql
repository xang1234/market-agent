-- Verified finance: erasure. A financial run holds the owner's request (plan
-- interpretation and thresholds), bound input copies, derived results, and a
-- certificate; each surface holds a copy of the sealed block. Whatever deletes
-- a run — the owner's erasure, its parent's deletion, or the deletion of
-- evidence it bound — takes every one of those with it, in one transaction.
--
-- These are audited deletions of whole runs, never partial ones: a run whose
-- evidence is gone keeps no derived value from it. Nothing here disables an
-- immutability trigger; those guard updates, and erasure only deletes.

-- The engine: deleting a run removes what the plain cascades cannot — replays
-- that re-derive its values, then its certificates, results, and units, then
-- the certificate snapshots, which finalization creates for its unit alone.
-- Each surface's copy goes with the certificate (below).
create function erase_financial_run_dependents() returns trigger
language plpgsql
as $$
declare
  certificate_snapshots uuid[];
begin
  delete from financial_runs where replay_of_run_id = old.run_id;
  select coalesce(array_agg(snapshot_id), '{}') into certificate_snapshots
    from snapshot_financial_runs where run_id = old.run_id;
  delete from snapshot_financial_runs where run_id = old.run_id;
  delete from financial_results where run_id = old.run_id;
  delete from financial_run_units where run_id = old.run_id;
  delete from snapshots where snapshot_id = any(certificate_snapshots);
  return old;
end;
$$;
create trigger financial_runs_erase_dependents
before delete on financial_runs
for each row execute function erase_financial_run_dependents();

-- The plan holds the owner's words and thresholds; it goes with its last run.
create function erase_orphaned_financial_plan() returns trigger
language plpgsql
as $$
begin
  delete from financial_plans p
   where p.plan_id = old.plan_id and p.user_id = old.user_id
     and not exists (select 1 from financial_runs r where r.plan_id = old.plan_id and r.user_id = old.user_id);
  return null;
end;
$$;
create trigger financial_runs_erase_orphaned_plan
after delete on financial_runs
for each row execute function erase_orphaned_financial_plan();

-- Surface copies of a certificate's sealed block. Thesis and Discovery keep
-- only ids and hashes of the certificate, which then read as unavailable.

-- Memo sections are the sealed block itself.
alter table analyze_run_financial_sections drop constraint analyze_run_financial_section_snapshot_id_financial_run_id_fkey;
alter table analyze_run_financial_sections add constraint analyze_run_financial_section_snapshot_id_financial_run_id_fkey
  foreign key (snapshot_id, financial_run_id, unit_id) references snapshot_financial_runs(snapshot_id, run_id, unit_id) on delete cascade;

-- A chat answer is the assistant message carrying the certificate's snapshot.
create function erase_chat_financial_copy() returns trigger
language plpgsql
as $$
begin
  delete from chat_messages where snapshot_id = old.snapshot_id;
  update chat_threads set latest_snapshot_id = null where latest_snapshot_id = old.snapshot_id;
  return old;
end;
$$;
create trigger snapshot_financial_runs_erase_chat_copy
before delete on snapshot_financial_runs
for each row execute function erase_chat_financial_copy();

-- A grid cell stays in its grid, as an explicit gap with no value.
create function erase_grid_financial_copy() returns trigger
language plpgsql
as $$
begin
  update grid_cells
     set status = 'error', display = '{"value": "—", "tone": null}'::jsonb, snapshot_id = null, primary_ref = null,
         coverage_flag = 'financial_result_erased', financial_run_id = null, financial_unit_id = null,
         certificate_digest = null, financial_block = null
   where financial_run_id = old.run_id and financial_unit_id = old.unit_id;
  return old;
end;
$$;
create trigger snapshot_financial_runs_erase_grid_copy
before delete on snapshot_financial_runs
for each row execute function erase_grid_financial_copy();

-- Deleting a run's parent, or evidence a run bound, deletes the run. One
-- function for both: tg_argv names the financial_runs/financial_run_inputs
-- predicate and the deleted row's key column.
--
-- Parents: AFTER, so the parent's own cascades finish first and erasure never
-- touches a row being deleted. Evidence: BEFORE, because the run's inputs
-- reference the row. Precision attestations need no trigger: they are only
-- ever deleted by the cascade from their fact, whose trigger already ran.
create function erase_financial_runs_referencing() returns trigger
language plpgsql
as $$
begin
  execute format('delete from financial_runs where %s', tg_argv[0]) using (to_jsonb(old) ->> tg_argv[1])::uuid;
  return old;
end;
$$;
create trigger chat_threads_erase_financial_runs
after delete on chat_threads
for each row execute function erase_financial_runs_referencing($$parent_kind = 'chat_thread' and parent_id = $1$$, 'thread_id');
create trigger analyze_template_runs_erase_financial_runs
after delete on analyze_template_runs
for each row execute function erase_financial_runs_referencing($$parent_kind = 'analyze_memo_run' and parent_id = $1$$, 'run_id');
create trigger grid_runs_erase_financial_runs
after delete on grid_runs
for each row execute function erase_financial_runs_referencing($$parent_kind = 'analyst_grid_run' and parent_id = $1$$, 'grid_run_id');
create trigger agent_thesis_versions_erase_financial_runs
after delete on agent_thesis_versions
for each row execute function erase_financial_runs_referencing($$parent_kind = 'thesis_version' and parent_id = $1$$, 'thesis_version_id');
create trigger discovery_runs_erase_financial_runs
after delete on discovery_runs
for each row execute function erase_financial_runs_referencing($$parent_kind = 'discovery_run' and parent_id = $1$$, 'run_id');
create trigger facts_erase_financial_runs
before delete on facts
for each row execute function erase_financial_runs_referencing($$run_id in (select run_id from financial_run_inputs where fact_id = $1)$$, 'fact_id');
create trigger source_publication_attestations_erase_financial_runs
before delete on source_publication_attestations
for each row execute function erase_financial_runs_referencing($$run_id in (select run_id from financial_run_inputs where publication_attestation_id = $1)$$, 'attestation_id');
