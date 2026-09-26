-- Verified finance: erasure. A financial run holds the owner's request (plan
-- interpretation and thresholds), bound input copies, derived results, and a
-- certificate; each surface holds a copy of the sealed block. Whatever deletes
-- a run — the owner's erasure, its parent's deletion, or the deletion of
-- evidence it bound — takes every one of those with it, in one transaction.
--
-- These are audited deletions of whole runs, never partial ones: a run whose
-- evidence is gone keeps no derived value from it. Nothing here disables an
-- immutability trigger; those guard updates, and erasure only deletes.

-- Deleting a run first removes what the plain cascades cannot: replays that
-- re-derive its values, the surfaces' copies of its sealed blocks, and its
-- certificates, results, and units (so the certificate snapshots can go).
create function erase_financial_run_dependents() returns trigger
language plpgsql
as $$
declare
  certificate_snapshots uuid[];
begin
  delete from financial_runs where replay_of_run_id = old.run_id;
  select coalesce(array_agg(snapshot_id), '{}') into certificate_snapshots
    from snapshot_financial_runs where run_id = old.run_id;

  -- Surface copies. Chat and memo copies are the sealed block itself; a grid
  -- cell stays in its grid as an explicit gap. Thesis and Discovery keep only
  -- ids and hashes of the certificate, which now resolve to unavailable.
  delete from chat_messages where snapshot_id = any(certificate_snapshots);
  update chat_threads set latest_snapshot_id = null where latest_snapshot_id = any(certificate_snapshots);
  delete from analyze_run_financial_sections where financial_run_id = old.run_id;
  update grid_cells
     set status = 'error', display = '{"value": "—", "tone": null}'::jsonb, snapshot_id = null, primary_ref = null,
         coverage_flag = 'financial_result_erased', financial_run_id = null, financial_unit_id = null,
         certificate_digest = null, financial_block = null
   where financial_run_id = old.run_id;

  delete from snapshot_financial_runs where run_id = old.run_id;
  delete from financial_results where run_id = old.run_id;
  delete from financial_run_units where run_id = old.run_id;
  delete from snapshots s
   where s.snapshot_id = any(certificate_snapshots)
     and not exists (select 1 from chat_messages m where m.snapshot_id = s.snapshot_id)
     and not exists (select 1 from chat_threads t where t.latest_snapshot_id = s.snapshot_id)
     and not exists (select 1 from analyze_template_runs a where a.snapshot_id = s.snapshot_id)
     and not exists (select 1 from grid_cells g where g.snapshot_id = s.snapshot_id)
     and not exists (select 1 from discovery_candidates c where c.snapshot_id = s.snapshot_id)
     and not exists (select 1 from agent_thesis_assessments a where a.snapshot_id = s.snapshot_id)
     and not exists (select 1 from findings f where f.snapshot_id = s.snapshot_id)
     and not exists (select 1 from financial_run_units u where u.snapshot_id = s.snapshot_id)
     and not exists (select 1 from snapshots child where child.parent_snapshot = s.snapshot_id);
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

-- A parent's deletion erases the runs computed for it. AFTER, so the parent's
-- own cascades finish first and erasure never touches a row being deleted.
-- tg_argv: the run parent_kind, then the parent table's id column.
create function erase_financial_runs_of_parent() returns trigger
language plpgsql
as $$
begin
  delete from financial_runs
   where parent_kind = tg_argv[0] and parent_id = (to_jsonb(old) ->> tg_argv[1])::uuid;
  return null;
end;
$$;
create trigger chat_threads_erase_financial_runs
after delete on chat_threads
for each row execute function erase_financial_runs_of_parent('chat_thread', 'thread_id');
create trigger analyze_template_runs_erase_financial_runs
after delete on analyze_template_runs
for each row execute function erase_financial_runs_of_parent('analyze_memo_run', 'run_id');
create trigger grid_runs_erase_financial_runs
after delete on grid_runs
for each row execute function erase_financial_runs_of_parent('analyst_grid_run', 'grid_run_id');
create trigger agent_thesis_versions_erase_financial_runs
after delete on agent_thesis_versions
for each row execute function erase_financial_runs_of_parent('thesis_version', 'thesis_version_id');
create trigger discovery_runs_erase_financial_runs
after delete on discovery_runs
for each row execute function erase_financial_runs_of_parent('discovery_run', 'run_id');

-- Deleting evidence a run bound erases that run first, so no bound copy or
-- value derived from the deleted evidence survives it. BEFORE, because the
-- run's inputs reference the row being deleted.
create function erase_financial_runs_binding_evidence() returns trigger
language plpgsql
as $$
begin
  if tg_table_name = 'facts' then
    delete from financial_runs where run_id in (select run_id from financial_run_inputs where fact_id = old.fact_id);
  elsif tg_table_name = 'source_publication_attestations' then
    delete from financial_runs where run_id in (select run_id from financial_run_inputs where publication_attestation_id = old.attestation_id);
  else
    delete from financial_runs where run_id in (select run_id from financial_run_inputs where precision_attestation_id = old.precision_attestation_id);
  end if;
  return old;
end;
$$;
create trigger facts_erase_financial_runs
before delete on facts
for each row execute function erase_financial_runs_binding_evidence();
create trigger source_publication_attestations_erase_financial_runs
before delete on source_publication_attestations
for each row execute function erase_financial_runs_binding_evidence();
create trigger fact_precision_attestations_erase_financial_runs
before delete on fact_precision_attestations
for each row execute function erase_financial_runs_binding_evidence();
