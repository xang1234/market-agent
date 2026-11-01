-- A child snapshot, such as an answer's filed cause, belongs to its parent and
-- is deleted with it, whether the answer's thread, its financial run, or the
-- parent snapshot itself is deleted.
alter table snapshots drop constraint snapshots_parent_snapshot_fkey;
alter table snapshots add constraint snapshots_parent_snapshot_fkey
  foreign key (parent_snapshot) references snapshots(snapshot_id) on delete cascade;
create index snapshots_parent_idx on snapshots(parent_snapshot) where parent_snapshot is not null;

-- Reachability and the inspector find a snapshot's answer by its snapshot_id.
create index chat_messages_snapshot_idx on chat_messages(snapshot_id);
