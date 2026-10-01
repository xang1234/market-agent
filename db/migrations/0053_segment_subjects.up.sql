-- #157: a business or geographic segment is a fact subject, so a segment value
-- (NVDA Data Center revenue, FY2026 Q4) is an ordinary fact row that blocks can
-- cite and the verifier can bind. Consolidated readers select
-- subject_kind = 'issuer', so segment rows never mix into company totals.
--
-- ALTER TYPE ADD VALUE works inside a transaction on PG 12+ as long as the new
-- value isn't referenced in the same transaction, which it isn't here.
alter type subject_kind add value if not exists 'segment';

create table segments (
  segment_id uuid primary key default gen_random_uuid(),
  issuer_id uuid not null references issuers(issuer_id),
  axis text not null check (axis in ('business', 'geography')),
  name text not null,
  -- A sub-segment's parent (e.g. Compute within Data Center); top-level
  -- segments, the ones a breakdown sums, have none.
  parent_segment_id uuid references segments(segment_id),
  definition_as_of timestamptz not null,
  created_at timestamptz not null default now(),
  unique (issuer_id, axis, name)
);
