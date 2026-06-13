import type { QueryExecutor } from "./types.ts";

export type ReaderDocumentRow = {
  document_id: string;
  source_id: string;
  raw_blob_id: string;
  doc_kind: string;
  published_at: string | null;
  created_at: string;
};

export const READER_DOCUMENT_WINDOW_DAYS = 180;
export const READER_DOCUMENTS_PER_CELL = 5;

// Recent, non-ephemeral documents visible to `userId` mentioning the issuer,
// preferring primary document kinds. Ranking: kind preference (filing >
// transcript > press_release > article > everything else), then recency. The
// ephemeral filter excludes metadata-only ingests (GDELT) whose raw text we
// may not store or display. Sources with a user_id must match `userId`
// (private uploads); sources with user_id IS NULL are public.
//
// Structure: inner subquery deduplicates by document_id (required by
// distinct on); outer query ranks and limits. least(limit, 200) backstops a
// caller passing an absurd limit.
export async function selectReaderDocuments(
  db: QueryExecutor,
  issuerId: string,
  userId: string,
  limit: number = READER_DOCUMENTS_PER_CELL,
): Promise<ReaderDocumentRow[]> {
  const { rows } = await db.query<ReaderDocumentRow>(
    `select document_id, source_id, raw_blob_id, doc_kind, published_at, created_at
       from (
         select distinct on (d.document_id)
                d.document_id::text as document_id,
                d.source_id::text as source_id,
                d.raw_blob_id,
                d.kind::text as doc_kind,
                d.published_at::text as published_at,
                d.created_at::text as created_at
           from mentions m
           join documents d on d.document_id = m.document_id
           join sources s on s.source_id = d.source_id
          where m.subject_kind = 'issuer'
            and m.subject_id = $1
            and d.deleted_at is null
            and s.license_class <> 'ephemeral'
            and d.raw_blob_id not like 'ephemeral:%'
            and coalesce(d.published_at, d.created_at) >= now() - ($2 || ' days')::interval
            and (s.user_id is null or s.user_id = $3::uuid)
          order by d.document_id
       ) deduped
      order by case doc_kind
                 when 'filing' then 0
                 when 'transcript' then 1
                 when 'press_release' then 2
                 when 'article' then 3
                 else 4
               end,
               coalesce(published_at, created_at) desc
      limit least($4::int, 200)`,
    [issuerId, String(READER_DOCUMENT_WINDOW_DAYS), userId, limit],
  );
  return rows;
}
