import { useEffect, useState } from 'react'
import {
  fetchQuoteSnapshot,
  formatQuotePrice,
  formatSignedNumber,
  formatSignedPercent,
  issuerProfileFromSubject,
  listingIdForQuote,
  quoteDirection,
  subjectDisplayName,
  type QuoteSnapshot as QuoteSnapshotData,
  type ResolvedSubject,
} from './quote.ts'

type QuoteSnapshotProps = {
  subject: ResolvedSubject
}

type FetchState =
  | { status: 'loading' }
  | { status: 'unavailable'; reason: string }
  | { status: 'ready'; quote: QuoteSnapshotData }

export function QuoteSnapshot({ subject }: QuoteSnapshotProps) {
  const listingId = listingIdForQuote(subject)
  const [state, setState] = useState<FetchState>(
    listingId
      ? { status: 'loading' }
      : { status: 'unavailable', reason: 'no listing context for this subject' },
  )

  useEffect(() => {
    if (!listingId) {
      setState({ status: 'unavailable', reason: 'no listing context for this subject' })
      return
    }
    const controller = new AbortController()
    setState({ status: 'loading' })
    fetchQuoteSnapshot(listingId, { signal: controller.signal })
      .then((quote) => {
        if (controller.signal.aborted) return
        setState({ status: 'ready', quote })
      })
      .catch((err) => {
        if (controller.signal.aborted) return
        setState({
          status: 'unavailable',
          reason: err instanceof Error ? err.message : 'quote fetch failed',
        })
      })
    return () => controller.abort()
  }, [listingId])

  const issuerProfile = issuerProfileFromSubject(subject)

  if (state.status !== 'ready') {
    return (
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(260px,360px)]">
        <section className="min-w-0">
          <h1 className="min-w-0 truncate text-2xl font-semibold text-neutral-950 dark:text-neutral-50">
            {subjectDisplayName(subject)}
          </h1>
          <p className="mt-3 text-sm text-neutral-500 dark:text-neutral-400">
            {state.status === 'loading' ? 'Loading quote…' : `Quote unavailable: ${state.reason}`}
          </p>
          <IssuerProfileLine profile={issuerProfile} />
        </section>
      </div>
    )
  }

  const quote = state.quote
  const direction = quoteDirection(quote)
  const moveClassName =
    direction === 'up'
      ? 'text-emerald-700 dark:text-emerald-400'
      : direction === 'down'
        ? 'text-red-700 dark:text-red-400'
        : 'text-neutral-600 dark:text-neutral-400'

  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(260px,360px)]">
      <section className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="min-w-0 truncate text-2xl font-semibold text-neutral-950 dark:text-neutral-50">
            {subjectDisplayName(subject)}
          </h1>
          <span className="rounded border border-neutral-200 px-2 py-0.5 text-xs font-medium text-neutral-600 dark:border-neutral-700 dark:text-neutral-300">
            {quote.listing.ticker}
          </span>
          <span className="text-xs text-neutral-500 dark:text-neutral-400">
            {quote.listing.mic} · {quote.currency}
          </span>
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-x-4 gap-y-2">
          <div className="text-3xl font-semibold tabular-nums text-neutral-950 dark:text-neutral-50">
            {formatQuotePrice(quote.latest_price, quote.currency)}
          </div>
          <div className={`pb-1 text-sm font-medium tabular-nums ${moveClassName}`}>
            {formatSignedNumber(quote.absolute_move)} ({formatSignedPercent(quote.percent_move)})
          </div>
          <div className="pb-1 text-xs text-neutral-500 dark:text-neutral-400">
            {quote.session_state.replaceAll('_', ' ')} · {quote.delay_class.replaceAll('_', ' ')} · {formatQuoteTime(quote.as_of, quote.listing.timezone)}
          </div>
        </div>
        <IssuerProfileLine profile={issuerProfile} />
      </section>
      <section
        aria-label="Quote provenance"
        className="flex min-h-28 flex-col justify-between rounded-md border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900"
      >
        <div className="flex items-center justify-between text-xs text-neutral-500 dark:text-neutral-400">
          <span>Source</span>
          <span className="truncate" title={quote.source_id}>{quote.source_id.slice(0, 8)}…</span>
        </div>
        <div className="mt-2 text-xs text-neutral-600 dark:text-neutral-400">
          Prev close: <span className="tabular-nums">{formatQuotePrice(quote.prev_close, quote.currency)}</span>
        </div>
      </section>
    </div>
  )
}

function IssuerProfileLine({
  profile,
}: {
  profile: { legal_name: string; sector?: string; industry?: string } | null
}) {
  if (!profile) return null
  return (
    <p className="mt-3 max-w-2xl text-sm text-neutral-600 dark:text-neutral-400">
      {profile.legal_name}
      {profile.sector ? ` · ${profile.sector}` : ''}
      {profile.industry ? ` · ${profile.industry}` : ''}
    </p>
  )
}

function formatQuoteTime(asOf: string, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
    ...(timeZone ? { timeZone } : {}),
  }).format(new Date(asOf))
}
