import type { ReactNode } from 'react'

import { useFetched } from '../symbol/useFetched.ts'
import {
  fetchIssuerNews,
  formatRelativeTime,
  isFilingKind,
  type IssuerNewsItem,
} from '../symbol/issuerNews.ts'

type SubjectNewsRailProps = {
  issuerId: string | null
}

// Context-aware right rail for subject detail: the most recent documents that
// mention this issuer (filings, transcripts, news), newest first. Replaces the
// consensus rail that duplicated the Overview body — this column now carries
// information that changes per subject.
export function SubjectNewsRail({ issuerId }: SubjectNewsRailProps) {
  const news = useFetched<IssuerNewsItem[]>(issuerId, async (id, signal) => {
    const items = await fetchIssuerNews(id, { signal, limit: 8 })
    return { kind: 'ready', data: items }
  })

  return (
    <div className="flex flex-col gap-3 p-4" data-testid="subject-news-rail">
      <h2 className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-muted">
        News &amp; filings
        <span className="text-[10px] font-normal normal-case text-faint">last 7d</span>
      </h2>
      {news.status === 'idle' ? (
        <RailStatus>Issuer context unavailable.</RailStatus>
      ) : news.status === 'loading' ? (
        <RailStatus>Loading recent documents…</RailStatus>
      ) : news.status === 'unavailable' ? (
        <RailStatus>News unavailable: {news.reason}</RailStatus>
      ) : news.data.length === 0 ? (
        <RailStatus>No recent news or filings for this issuer.</RailStatus>
      ) : (
        <ul className="flex flex-col">
          {news.data.map((item) => (
            <NewsRow key={item.document_id} item={item} />
          ))}
        </ul>
      )}
    </div>
  )
}

function NewsRow({ item }: { item: IssuerNewsItem }) {
  const filing = isFilingKind(item.kind)
  return (
    <li className="flex flex-col gap-1.5 border-t border-line py-3 first:border-t-0 first:pt-0">
      <div className="flex items-center justify-between text-[10px] num text-faint">
        <span className="truncate" title={item.provider}>
          {item.provider}
        </span>
        <span>{formatRelativeTime(item.published_at)}</span>
      </div>
      <p className="text-xs leading-snug text-fg-soft">{item.title ?? 'Untitled document'}</p>
      <div>
        <span
          className={`rounded px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide ${
            filing ? 'bg-warning-soft text-warning' : 'bg-accent-soft text-accent'
          }`}
        >
          {filing ? item.kind : 'news'}
        </span>
      </div>
    </li>
  )
}

function RailStatus({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted">{children}</p>
}
