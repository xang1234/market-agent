// Client for the issuer News & filings rail. Hits the public evidence read
// `/v1/evidence/issuer-news` (no session required — subject detail is public).

import { defineResource } from '../fetch/resource.ts'

export type IssuerNewsKind =
  | 'filing'
  | 'transcript'
  | 'article'
  | 'research_note'
  | 'social_post'
  | 'thread'
  | 'upload'

export type IssuerNewsItem = {
  document_id: string
  kind: IssuerNewsKind
  title: string | null
  published_at: string | null
  provider: string
  provider_doc_id: string | null
}

type FetchImpl = typeof fetch

export async function fetchIssuerNews(
  issuerId: string,
  init: { signal?: AbortSignal; limit?: number; fetchImpl?: FetchImpl } = {},
): Promise<IssuerNewsItem[]> {
  const fetchFn = init.fetchImpl ?? fetch
  const params = new URLSearchParams({ issuer_id: issuerId })
  if (init.limit !== undefined) params.set('limit', String(init.limit))
  const res = await fetchFn(`/v1/evidence/issuer-news?${params.toString()}`, { signal: init.signal })
  if (!res.ok) throw new Error(`issuer news fetch failed: HTTP ${res.status}`)
  const body = (await res.json()) as { items: IssuerNewsItem[] }
  return body.items
}

// "Filing"-class kinds get the filing treatment; everything else reads as news.
const FILING_KINDS: ReadonlySet<IssuerNewsKind> = new Set(['filing', 'transcript'])

export function isFilingKind(kind: IssuerNewsKind): boolean {
  return FILING_KINDS.has(kind)
}

const NEWS_RAIL_LIMIT = 8

export const recentIssuerNews = defineResource({
  freshness: 'intraday',
  load: async (issuerId: string, signal) => ({
    kind: 'ready',
    data: await fetchIssuerNews(issuerId, { signal, limit: NEWS_RAIL_LIMIT }),
  }),
})
