delete from object_blob_gc_queue where reason = 'blob_rewrite';
alter table object_blob_gc_queue drop constraint object_blob_gc_queue_reason_check;
alter table object_blob_gc_queue add constraint object_blob_gc_queue_reason_check check (reason in ('user_erasure'));
alter table documents drop column raw_blob_transform;
