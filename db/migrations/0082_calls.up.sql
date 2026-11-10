-- Calls (ADR 0005, #604): the agent's opinion, stored unchanged. Each row
-- binds a Call snapshot to the certified run its inputs come from, with the
-- Call date, the owner settings it used, a fingerprint of its bound inputs and
-- the hash of the block its seal generated. Written in the seal's transaction.
--
-- A Call copies its inputs' certified values, so it is a surface copy of that
-- certificate under 0051's rule: whatever deletes the certificate deletes the
-- Call's chat message and snapshot with it, as 0079 does for a comparison.
create table calls (
  snapshot_id uuid primary key references snapshots(snapshot_id) on delete cascade,
  inputs_snapshot_id uuid not null,
  inputs_run_id uuid not null,
  inputs_unit_id text not null,
  call_date date not null,
  settings jsonb not null check (jsonb_typeof(settings) = 'object'),
  inputs_fingerprint text not null check (inputs_fingerprint ~ '^[0-9a-f]{64}$'),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  foreign key (inputs_snapshot_id, inputs_run_id, inputs_unit_id) references snapshot_financial_runs(snapshot_id, run_id, unit_id) on delete cascade
);
create index calls_inputs_idx on calls(inputs_snapshot_id, inputs_run_id, inputs_unit_id);
create trigger calls_append_only
before update on calls
for each row execute function prevent_financial_record_update();

-- BEFORE, like 0079's: the Call snapshots go first, taking their rows by
-- cascade; the row's own cascade covers an erasure this trigger misses.
create function erase_calls() returns trigger
language plpgsql
as $$
declare
  call_snapshots uuid[];
begin
  select coalesce(array_agg(snapshot_id), '{}') into call_snapshots
    from calls
   where inputs_snapshot_id = old.snapshot_id and inputs_run_id = old.run_id and inputs_unit_id = old.unit_id;
  delete from chat_messages where snapshot_id = any(call_snapshots);
  update chat_threads set latest_snapshot_id = null where latest_snapshot_id = any(call_snapshots);
  delete from snapshots where snapshot_id = any(call_snapshots);
  return old;
end;
$$;
create trigger snapshot_financial_runs_erase_calls
before delete on snapshot_financial_runs
for each row execute function erase_calls();
