-- The GAAP to non-GAAP reconciliations of each stored earnings release (an
-- Item 2.02 8-K), for the quarter it reports (services/evidence/src/
-- sec-non-gaap-reconciliations.ts). One row per release read, so the row also
-- marks it read: a release that reconciles nothing keeps a row with no lines,
-- and one whose quarter could not be dated keeps a null quarter_end. Each line
-- is a cell of the release's own tables, in the scale the table states.
-- The issuer and the filing date are the release's Item 2.02 claim's, which
-- issuer merges move, so this table names neither.
create table non_gaap_reconciliations (
  document_id uuid primary key references documents(document_id) on delete cascade,
  quarter_end date,
  revenue jsonb,
  reconciliations jsonb not null check (jsonb_typeof(reconciliations) = 'array'),
  read_at timestamptz not null default now()
);
