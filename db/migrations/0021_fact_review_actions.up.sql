alter table fact_review_queue
  add column reviewed_by text,
  add column reviewed_at timestamptz,
  add column fact_id uuid references facts(fact_id);

create table fact_review_actions (
  action_id uuid primary key default gen_random_uuid(),
  review_id uuid not null references fact_review_queue(review_id),
  action text not null check (action in ('approved', 'rejected', 'edited')),
  reviewer_id text not null check (length(btrim(reviewer_id)) > 0),
  notes text,
  candidate_before jsonb not null,
  candidate_after jsonb,
  fact_id uuid references facts(fact_id),
  created_at timestamptz not null default now()
);

create index fact_review_actions_review_created_idx
  on fact_review_actions(review_id, created_at);

create index fact_review_actions_reviewer_created_idx
  on fact_review_actions(reviewer_id, created_at desc);
