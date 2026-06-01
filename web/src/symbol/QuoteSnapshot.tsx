import { useEffect, useState } from 'react'
import { CARD_CLASS } from './surfaceStyles.ts'
import {
  fetchQuoteSnapshot,
  formatQuotePrice,
  formatSignedNumber,
  formatSignedPercent,
  issuerProfileFromSubject,
  listingIdForQuote,
  quoteBelongsToListing,
  quoteDirection,
  SIGNED_BY_QUOTE_DIRECTION,
  subjectDisplayName,
  type QuoteSnapshot as QuoteSnapshotData,
  type ResolvedSubject,
  type RouteResolvedSubject,
} from './quote.ts'
import { ChangePill } from './ChangePill.tsx'

type QuoteSnapshotProps = {
  subject: ResolvedSubject | RouteResolvedSubject
}

type FetchState =
  | { status: 'idle' }
  | { status: 'unavailable'; listingId: string; reason: string }
  | { status: 'ready'; listingId: string; quote: QuoteSnapshotData }

type VisibleFetchState =
  | { status: 'loading' }
  | { status: 'unavailable'; reason: string }
  | { status: 'ready'; quote: QuoteSnapshotData }

export function QuoteSnapshot({ subject }: QuoteSnapshotProps) {
  const listingId = listingIdForQuote(subject)
  const [state, setState] = useState<FetchState>({ status: 'idle' })

  useEffect(() => {
    if (!listingId) return
    const controller = new AbortController()
    fetchQuoteSnapshot(listingId, { signal: controller.signal })
      .then((quote) => {
        if (controller.signal.aborted) return
        if (!quoteBelongsToListing(quote, listingId)) {
          setState({
            status: 'unavailable',
            listingId,
            reason: 'quote response did not match requested listing',
          })
          return
        }
        setState({ status: 'ready', listingId, quote })
      })
      .catch((err) => {
        if (controller.signal.aborted) return
        setState({
          status: 'unavailable',
          listingId,
          reason: err instanceof Error ? err.message : 'quote fetch failed',
        })
      })
    return () => controller.abort()
  }, [listingId])

  const issuerProfile = issuerProfileFromSubject(subject)
  const visibleState = visibleQuoteState(state, listingId)

  if (visibleState.status !== 'ready') {
    return (
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(260px,360px)]">
        <section className="min-w-0">
          <h1 className="min-w-0 truncate text-2xl font-semibold text-fg">
            {subjectDisplayName(subject)}
          </h1>
          <p className="mt-3 text-sm text-muted">
            {visibleState.status === 'loading'
              ? 'Loading quote…'
              : `Quote unavailable: ${visibleState.reason}`}
          </p>
          <IssuerProfileLine profile={issuerProfile} />
        </section>
      </div>
    )
  }

  const quote = visibleState.quote
  const direction = SIGNED_BY_QUOTE_DIRECTION[quoteDirection(quote)]

  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(260px,360px)]">
      <section className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="min-w-0 truncate text-2xl font-semibold text-fg">
            {subjectDisplayName(subject)}
          </h1>
          <span className="rounded border border-line px-2 py-0.5 text-xs font-medium text-muted">
            {quote.listing.ticker}
          </span>
          <span className="text-xs text-muted">
            {quote.listing.mic} · {quote.currency}
          </span>
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-x-4 gap-y-2">
          <div className="num text-3xl font-semibold text-fg">
            {formatQuotePrice(quote.latest_price, quote.currency)}
          </div>
          <ChangePill direction={direction} withArrow={false} className="pb-1 text-sm">
            {formatSignedNumber(quote.absolute_move)} ({formatSignedPercent(quote.percent_move)})
          </ChangePill>
          <div className="pb-1 text-xs text-muted">
            {quote.session_state.replaceAll('_', ' ')} · {quote.delay_class.replaceAll('_', ' ')} · {formatQuoteTime(quote.as_of, quote.listing.timezone)}
          </div>
        </div>
        <IssuerProfileLine profile={issuerProfile} />
      </section>
      <section
        aria-label="Quote provenance"
        className={`flex min-h-28 flex-col justify-between ${CARD_CLASS} p-3`}
      >
        <div className="flex items-center justify-between text-xs text-muted">
          <span>Source</span>
          <span className="num truncate" title={quote.source_id}>{quote.source_id.slice(0, 8)}…</span>
        </div>
        <div className="mt-2 text-xs text-muted">
          Prev close: <span className="num">{formatQuotePrice(quote.prev_close, quote.currency)}</span>
        </div>
      </section>
    </div>
  )
}

function visibleQuoteState(state: FetchState, listingId: string | null): VisibleFetchState {
  if (!listingId) {
    return { status: 'unavailable', reason: 'no listing context for this subject' }
  }
  if (
    state.status === 'ready' &&
    state.listingId === listingId &&
    quoteBelongsToListing(state.quote, listingId)
  ) {
    return { status: 'ready', quote: state.quote }
  }
  if (state.status === 'unavailable' && state.listingId === listingId) {
    return { status: 'unavailable', reason: state.reason }
  }
  return { status: 'loading' }
}

function IssuerProfileLine({
  profile,
}: {
  profile: { legal_name: string; sector?: string; industry?: string } | null
}) {
  if (!profile) return null
  return (
    <p className="mt-3 max-w-2xl text-sm text-muted">
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
