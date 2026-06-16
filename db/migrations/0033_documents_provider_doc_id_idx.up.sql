-- Supports the accession dedup lookup (findLiveDocumentIdByAccession) used by the
-- per-issuer SEC backfill and the daily EDGAR crawl:
--   where provider_doc_id = $1 and deleted_at is null
-- Without it each check is a sequential scan of documents; a daily Form 4 crawl
-- issues thousands of these. Partial index keeps it small (live, identified docs).
create index documents_provider_doc_id_idx
  on documents(provider_doc_id)
  where deleted_at is null and provider_doc_id is not null;
