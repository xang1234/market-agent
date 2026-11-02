-- The newest filing date in any SEC companyfacts download stored for an
-- issuer. An older download may lack a noncontrolling interest a newer one
-- reported, so it stores no figure inferred from that absence (#342).
create table sec_issuer_downloads (
  issuer_id uuid primary key references issuers(issuer_id) on delete cascade,
  newest_filed date not null
);
