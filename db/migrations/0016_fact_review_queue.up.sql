create table fact_review_queue (
  review_id uuid primary key default gen_random_uuid(),
  candidate jsonb not null,
  reason text not null,
  source_id uuid references sources(source_id) on delete set null,
  metric_id uuid references metrics(metric_id),
  confidence numeric not null check (confidence >= 0 and confidence <= 1),
  threshold numeric not null check (threshold >= 0 and threshold <= 1),
  status text not null default 'queued' check (status in ('queued', 'reviewed', 'dismissed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index fact_review_queue_status_created_idx
  on fact_review_queue(status, created_at);

create index fact_review_queue_source_idx
  on fact_review_queue(source_id)
  where source_id is not null;

create index fact_review_queue_metric_idx
  on fact_review_queue(metric_id)
  where metric_id is not null;
