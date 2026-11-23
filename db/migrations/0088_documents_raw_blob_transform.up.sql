-- How a stored blob was made from the bytes its source sent (#757), or null
-- when it is those bytes. content_hash keeps naming the bytes as sent, which
-- publication attestations and campaign quotes cite; raw_blob_id names the
-- bytes stored. sec_uuencoded_bodies_removed.v1 is an EDGAR submission without
-- its binary documents' uuencoded bodies (services/evidence/src/
-- sec-submission-strip.ts).
alter table documents add column if not exists raw_blob_transform text
  check (raw_blob_transform in ('sec_uuencoded_bodies_removed.v1'));

-- The rewrite of stored blobs queues each blob it replaced for deletion.
alter table object_blob_gc_queue drop constraint if exists object_blob_gc_queue_reason_check;
alter table object_blob_gc_queue add constraint object_blob_gc_queue_reason_check
  check (reason in ('user_erasure', 'blob_rewrite'));
