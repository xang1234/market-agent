-- Scenario price comparisons (#224): which sealed P/E scenario a comparison
-- snapshot compares, and the hash of the comparison content it sealed.
-- Written in the seal's transaction, so a comparison block reads as linked
-- only when its stored content is the content its seal generated again.
--
-- A comparison copies its scenario's certified values and the owner's P/E, so
-- it is a surface copy of that certificate under 0051's rule: whatever deletes
-- the certificate (the owner's erasure, the run's parent's deletion, or the
-- deletion of evidence the run bound) deletes the comparison's chat message
-- and snapshot with it.
create table scenario_price_comparisons (
  snapshot_id uuid primary key references snapshots(snapshot_id) on delete cascade,
  scenario_snapshot_id uuid not null,
  scenario_run_id uuid not null,
  scenario_unit_id text not null,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  foreign key (scenario_snapshot_id, scenario_run_id, scenario_unit_id) references snapshot_financial_runs(snapshot_id, run_id, unit_id) on delete cascade
);
create index scenario_price_comparisons_scenario_idx on scenario_price_comparisons(scenario_snapshot_id, scenario_run_id, scenario_unit_id);
create trigger scenario_price_comparisons_append_only
before update on scenario_price_comparisons
for each row execute function prevent_financial_record_update();

-- BEFORE, like the chat copy's trigger (0051): the comparison snapshots go
-- first, taking their bindings by cascade. The binding's own cascade covers
-- what this trigger misses: the trigger disabled, or an erasure under
-- repeatable read that does not see a binding committed after its snapshot.
-- It removes only the binding, so the comparison reads unproven, while its
-- message and snapshot remain.
create function erase_scenario_price_comparisons() returns trigger
language plpgsql
as $$
declare
  comparison_snapshots uuid[];
begin
  select coalesce(array_agg(snapshot_id), '{}') into comparison_snapshots
    from scenario_price_comparisons
   where scenario_snapshot_id = old.snapshot_id and scenario_run_id = old.run_id and scenario_unit_id = old.unit_id;
  delete from chat_messages where snapshot_id = any(comparison_snapshots);
  update chat_threads set latest_snapshot_id = null where latest_snapshot_id = any(comparison_snapshots);
  delete from snapshots where snapshot_id = any(comparison_snapshots);
  return old;
end;
$$;
create trigger snapshot_financial_runs_erase_price_comparisons
before delete on snapshot_financial_runs
for each row execute function erase_scenario_price_comparisons();
