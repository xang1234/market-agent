import {
  formatProviderName,
  formatQuotePrice,
  formatSignedNumber,
  formatSignedPercent,
  issuerProfileFromSubject,
  quoteDirection,
  SIGNED_BY_QUOTE_DIRECTION,
  type QuoteSnapshot as QuoteSnapshotData,
  type ResolvedSubject,
  type RouteResolvedSubject,
} from './quote.ts'
import { isCanonicalResolvedSubject } from './search.ts'
import type { VisibleFetchState } from '../fetch/resource.ts'
import { ChangePill } from './ChangePill.tsx'
import { RefreshFailedNote } from './FetchStateView.tsx'
import { FailureNotice } from '../ui/FailureNotice.tsx'
import { Skeleton } from '../ui/Skeleton.tsx'

type QuoteSnapshotProps = {
  subject: ResolvedSubject | RouteResolvedSubject
  // Null while the name is still loading.
  title: string | null
  quoteState: VisibleFetchState<QuoteSnapshotData>
}

export function QuoteSnapshot({ subject, title, quoteState }: QuoteSnapshotProps) {
  const issuerProfile = issuerProfileFromSubject(subject)
  // The ticker and venue sit beside the heading, so it names the company alone.
  const heading = issuerProfile?.legal_name ?? title
  const pendingListing = isCanonicalResolvedSubject(subject) ? subject.context?.listing : undefined

  if (quoteState.status !== 'ready') {
    return (
      <section className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <SnapshotTitle title={heading} />
          {pendingListing ? (
            <ListingChips ticker={pendingListing.ticker} mic={pendingListing.mic} currency={pendingListing.trading_currency} />
          ) : null}
        </div>
        <div className="mt-3">
          {quoteState.status === 'loading' ? (
            <Skeleton label="Loading quote" className="h-9 w-48" />
          ) : quoteState.status === 'unavailable' ? (
            <FailureNotice message="Couldn't load the quote." detail={quoteState.reason} onRetry={quoteState.retry} />
          ) : (
            <p className="text-sm text-muted">Quote unavailable</p>
          )}
        </div>
        <IssuerProfileLine profile={issuerProfile} />
      </section>
    )
  }

  const quote = quoteState.data
  const direction = SIGNED_BY_QUOTE_DIRECTION[quoteDirection(quote)]

  return (
    <section className="min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <SnapshotTitle title={heading} />
        <ListingChips ticker={quote.listing.ticker} mic={quote.listing.mic} currency={quote.currency} />
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-x-4 gap-y-2">
        <div className="num text-3xl font-semibold text-fg">
          {formatQuotePrice(quote.latest_price, quote.currency)}
        </div>
        <ChangePill direction={direction} withArrow={false} className="pb-1 text-sm">
          {formatSignedNumber(quote.absolute_move)} ({formatSignedPercent(quote.percent_move)})
        </ChangePill>
        {/* Provenance is one inline token on the meta line — the source name
            (source_id on hover) — not a hero card. Prev close lives in the
            symbol's key-stats grid. */}
        <div className="pb-1 text-xs text-muted">
          {quote.session_state.replaceAll('_', ' ')} · {quote.delay_class.replaceAll('_', ' ')} ·{' '}
          {formatQuoteTime(quote.as_of, quote.listing.timezone)} ·{' '}
          <span title={quote.source_id}>{formatProviderName(quote.provider, quote.source_id)}</span>
        </div>
      </div>
      {quoteState.refreshError !== null && <RefreshFailedNote noun="quote" error={quoteState.refreshError} />}
      <IssuerProfileLine profile={issuerProfile} />
    </section>
  )
}

function ListingChips({ ticker, mic, currency }: { ticker: string; mic: string; currency: string }) {
  return (
    <>
      <span className="rounded border border-line px-2 py-0.5 text-xs font-medium text-muted">{ticker}</span>
      <span className="text-xs text-muted">
        {mic} · {currency}
      </span>
    </>
  )
}

function SnapshotTitle({ title }: { title: string | null }) {
  return (
    <h1 className="min-w-0 truncate text-2xl font-semibold text-fg">
      {title ?? <Skeleton label="Loading symbol name" className="h-8 w-56" />}
    </h1>
  )
}

function IssuerProfileLine({
  profile,
}: {
  profile: { sector?: string; industry?: string } | null
}) {
  const parts = [profile?.sector, profile?.industry].filter(Boolean)
  if (parts.length === 0) return null
  return <p className="mt-2 max-w-2xl text-sm text-muted">{parts.join(' · ')}</p>
}

function formatQuoteTime(asOf: string, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
    ...(timeZone ? { timeZone } : {}),
  }).format(new Date(asOf))
}
