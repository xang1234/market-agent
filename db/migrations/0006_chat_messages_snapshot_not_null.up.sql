do $$
begin
  if exists (select 1 from chat_messages where snapshot_id is null) then
    raise exception 'cannot require chat_messages.snapshot_id while null rows exist; delete unsealed chat_messages or attach them to sealed snapshots before rerunning this migration';
  end if;
end $$;

alter table chat_messages
  alter column snapshot_id set not null;
