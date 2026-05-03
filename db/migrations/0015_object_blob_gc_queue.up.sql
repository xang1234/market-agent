create table object_blob_gc_queue (
  raw_blob_id text primary key check (raw_blob_id ~ '^sha256:[0-9a-f]{64}$'),
  reason text not null check (reason in ('user_erasure')),
  source_user_id uuid references users(user_id) on delete set null,
  queued_at timestamptz not null default now(),
  next_attempt_at timestamptz not null default now(),
  last_checked_at timestamptz,
  deleted_at timestamptz,
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  updated_at timestamptz not null default now()
);

create index object_blob_gc_queue_pending_idx
  on object_blob_gc_queue(next_attempt_at, queued_at, raw_blob_id)
  where deleted_at is null;

create index object_blob_gc_queue_source_user_idx
  on object_blob_gc_queue(source_user_id)
  where source_user_id is not null;
