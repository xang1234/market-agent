alter table snapshots
  add column document_refs jsonb not null default '[]'::jsonb,
  add column tool_call_result_hashes jsonb not null default '[]'::jsonb;
