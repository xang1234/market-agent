drop index chat_messages_snapshot_idx;
drop index snapshots_parent_idx;
alter table snapshots drop constraint snapshots_parent_snapshot_fkey;
alter table snapshots add constraint snapshots_parent_snapshot_fkey
  foreign key (parent_snapshot) references snapshots(snapshot_id);
