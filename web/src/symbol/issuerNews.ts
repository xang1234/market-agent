// Client for the issuer News & filings rail. Hits the public evidence read
// `/v1/evidence/issuer-news` (no session required — subject detail is public).

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

// Compact "2h ago" / "3d ago" relative label; null published_at → empty string.
export function formatRelativeTime(iso: string | null, now: Date = new Date()): string {
  if (iso === null) return ''
  const then = Date.parse(iso)
  if (!Number.isFinite(then)) return ''
  const seconds = Math.max(0, Math.floor((now.getTime() - then) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  return `${Math.floor(months / 12)}y ago`
}
