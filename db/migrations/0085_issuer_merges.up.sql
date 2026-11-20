-- Each issuer repair:issuer-splits merged away, with the issuer it merged into
-- (services/fundamentals/src/issuer-splits.ts). Saved records keep naming the
-- merged issuer's id (sealed snapshots, financial plans, chat research scopes,
-- findings, grid rows), so readers by id follow this. A later merge of the
-- kept issuer moves its rows on, so each names a live issuer in one hop.
create table issuer_merges (
  dropped_issuer_id uuid primary key,
  kept_issuer_id uuid not null references issuers (issuer_id),
  merged_at timestamptz not null default now()
);
create index issuer_merges_kept_issuer_id_idx on issuer_merges (kept_issuer_id);

-- The issuer an id names now: the one it merged into, else itself.
create function current_issuer_id(issuer_id uuid) returns uuid
language sql stable
as $$
  select coalesce((select m.kept_issuer_id from issuer_merges m where m.dropped_issuer_id = issuer_id), issuer_id)
$$;
