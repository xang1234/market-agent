// Read model for the symbol-detail "News & filings" rail: the most recent
// documents that mention an issuer (filings, transcripts, news), newest first.
// EXISTS against mentions (rather than a join) so a document with several
// mention rows for the same issuer is returned once.

import type { DocumentKind } from "./document-repo.ts";
import type { QueryExecutor } from "./types.ts";
import { assertUuidV4 } from "./validators.ts";

export type IssuerNewsItem = {
  document_id: string;
  kind: DocumentKind;
  title: string | null;
  published_at: string | null;
  provider: string;
  provider_doc_id: string | null;
};

const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 25;

export function clampNewsLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isInteger(limit) || limit < 1) return DEFAULT_LIMIT;
  return Math.min(limit, MAX_LIMIT);
}

export async function listIssuerNews(
  db: QueryExecutor,
  input: { issuerId: string; limit?: number },
): Promise<IssuerNewsItem[]> {
  assertUuidV4(input.issuerId, "issuer_id");
  const limit = clampNewsLimit(input.limit);
  const { rows } = await db.query<IssuerNewsItem>(
    `select d.document_id::text as document_id,
            d.kind,
            d.title,
            d.published_at,
            d.provider_doc_id,
            s.provider
       from documents d
       join sources s on s.source_id = d.source_id
      where d.deleted_at is null
        and exists (
          select 1
            from mentions m
           where m.document_id = d.document_id
             and m.subject_kind = 'issuer'
             and m.subject_id = $1
        )
      order by d.published_at desc nulls last, d.created_at desc
      limit $2`,
    [input.issuerId, limit],
  );
  return rows.map((row) => ({
    document_id: row.document_id,
    kind: row.kind,
    title: row.title,
    published_at: row.published_at,
    provider: row.provider,
    provider_doc_id: row.provider_doc_id,
  }));
}
