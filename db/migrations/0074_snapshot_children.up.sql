-- A child snapshot, such as an answer's filed cause, belongs to its parent and
-- is deleted with it. That happens when the parent snapshot is deleted, or when
-- a financial answer's thread or run is deleted and takes the answer's snapshot.
-- A child snapshot is never referenced directly; it is reached only through its
-- parent, and children are one level deep.
alter table snapshots drop constraint snapshots_parent_snapshot_fkey;
alter table snapshots add constraint snapshots_parent_snapshot_fkey
  foreign key (parent_snapshot) references snapshots(snapshot_id) on delete cascade;
create index snapshots_parent_idx on snapshots(parent_snapshot) where parent_snapshot is not null;

-- Reachability and the inspector find a snapshot's answer by its snapshot_id.
create index chat_messages_snapshot_idx on chat_messages(snapshot_id);
