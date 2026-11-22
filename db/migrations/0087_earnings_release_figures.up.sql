-- Earnings-release figures (#733). The quarter each release reports, and the
-- guides and actuals it states as numbers, so a guide is compared with the next
-- release's actual on the same basis (services/evidence/src/guidance-record.ts).

-- When the extraction (extract:earnings-releases) read an Item 2.02 claim's
-- release for its figures. A release read before figures existed has none, so
-- the next drain reads it once more. Apart from enriched_at, which it also sets.
alter table claims add column if not exists figures_read_at timestamptz;

-- The quarter a release reports, as its own dated headings give it, and when it
-- was filed. A release with no such quarter has no row and no figures.
create table if not exists earnings_release_quarters (
  document_id uuid primary key references documents(document_id) on delete cascade,
  issuer_id uuid not null references issuers(issuer_id),
  quarter_end date not null,
  filed_on date not null,
  created_at timestamptz not null default now(),
  check (quarter_end < filed_on)
);
create index if not exists earnings_release_quarters_issuer_idx on earnings_release_quarters(issuer_id, quarter_end);

-- A guide for the quarter after its release's (claim_id names the guidance claim
-- it binds), or an actual its release reports for its own quarter (low = high), in
-- dollars or percent, on the basis its sentence states. quote is the sentence,
-- as the exhibit has it.
create table if not exists earnings_release_figures (
  figure_id uuid primary key default gen_random_uuid(),
  document_id uuid not null references earnings_release_quarters(document_id) on delete cascade,
  claim_id uuid references claims(claim_id) on delete cascade,
  kind text not null check (kind in ('guidance', 'result')),
  metric text not null,
  basis text not null check (basis in ('gaap', 'non_gaap')),
  low numeric not null,
  high numeric not null,
  quote text not null,
  created_at timestamptz not null default now(),
  check (low <= high),
  check ((kind = 'guidance') = (claim_id is not null)),
  check (kind = 'guidance' or low = high),
  unique (document_id, kind, metric, basis, quote)
);

-- A figure the extraction could not read for sure waits in the fact review
-- queue as kind release_figure; approving it stores the figure.
alter table fact_review_queue add column if not exists kind text not null default 'fact' check (kind in ('fact', 'release_figure'));
alter table fact_review_queue add column if not exists release_figure_id uuid references earnings_release_figures(figure_id) on delete set null;
alter table fact_review_queue drop constraint if exists fact_review_queue_review_metadata_chk;
alter table fact_review_queue add constraint fact_review_queue_review_metadata_chk check (
  (
    status = 'queued'
    and reviewed_by is null
    and reviewed_at is null
    and fact_id is null
    and release_figure_id is null
  ) or (
    status = 'reviewed'
    and reviewed_by is not null
    and length(btrim(reviewed_by)) > 0
    and reviewed_at is not null
    -- A reviewed figure's id is cleared when its release is deleted.
    and (
      (kind = 'fact' and fact_id is not null and release_figure_id is null)
      or (kind = 'release_figure' and fact_id is null)
    )
  ) or (
    status = 'dismissed'
    and reviewed_by is not null
    and length(btrim(reviewed_by)) > 0
    and reviewed_at is not null
    and fact_id is null
    and release_figure_id is null
  )
);
