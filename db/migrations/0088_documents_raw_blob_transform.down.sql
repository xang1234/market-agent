-- A rewritten filing's blob is no longer SEC's bytes, and only this column
-- says so. Refuse to roll back while any row carries a transform: dropping it
-- would leave stripped blobs labelled as originals.
do $$
begin
  if exists (select 1 from documents where raw_blob_transform is not null) then
    raise exception 'cannot roll back 0088: documents row(s) hold rewritten blobs (raw_blob_transform is set); restore their original bytes first';
  end if;
end$$;

delete from object_blob_gc_queue where reason = 'blob_rewrite';
alter table object_blob_gc_queue drop constraint object_blob_gc_queue_reason_check;
alter table object_blob_gc_queue add constraint object_blob_gc_queue_reason_check check (reason in ('user_erasure'));
alter table documents drop column raw_blob_transform;
