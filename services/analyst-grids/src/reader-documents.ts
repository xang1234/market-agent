import type { QueryExecutor } from "./types.ts";

export type ReaderDocumentRow = {
  document_id: string;
  source_id: string;
  raw_blob_id: string;
  doc_kind: string;
  published_at: string | null;
};

export const READER_DOCUMENT_WINDOW_DAYS = 180;
export const READER_DOCUMENTS_PER_CELL = 5;

// Recent, non-ephemeral documents mentioning the issuer, preferring primary
// document kinds. Ranking: kind preference (filing > transcript >
// press_release > article > everything else), then recency. The ephemeral
// filter excludes metadata-only ingests (GDELT) whose raw text we may not
// store or display.
export async function selectReaderDocuments(
  db: QueryExecutor,
  issuerId: string,
  limit: number = READER_DOCUMENTS_PER_CELL,
): Promise<ReaderDocumentRow[]> {
  const { rows } = await db.query<ReaderDocumentRow>(
    `select distinct on (d.document_id)
            d.document_id::text as document_id,
            d.source_id::text as source_id,
            d.raw_blob_id,
            d.kind::text as doc_kind,
            d.published_at::text as published_at
       from mentions m
       join documents d on d.document_id = m.document_id
       join sources s on s.source_id = d.source_id
      where m.subject_kind = 'issuer'
        and m.subject_id = $1
        and d.deleted_at is null
        and s.license_class <> 'ephemeral'
        and d.raw_blob_id not like 'ephemeral:%'
        and coalesce(d.published_at, d.created_at) >= now() - ($2 || ' days')::interval
      order by d.document_id
      limit 200`,
    [issuerId, String(READER_DOCUMENT_WINDOW_DAYS)],
  );
  const kindRank = (kind: string): number =>
    ({ filing: 0, transcript: 1, press_release: 2, article: 3 } as Record<string, number>)[kind] ?? 4;
  return rows
    .sort(
      (a, b) =>
        kindRank(a.doc_kind) - kindRank(b.doc_kind) ||
        (b.published_at ?? "").localeCompare(a.published_at ?? ""),
    )
    .slice(0, limit);
}
