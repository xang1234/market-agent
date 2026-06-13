import {
  formatProviderName,
  formatQuotePrice,
  formatSignedNumber,
  formatSignedPercent,
  issuerProfileFromSubject,
  quoteDirection,
  SIGNED_BY_QUOTE_DIRECTION,
  subjectDisplayName,
  type ResolvedSubject,
  type RouteResolvedSubject,
} from './quote.ts'
import type { VisibleQuoteState } from './useSubjectQuote.ts'
import { ChangePill } from './ChangePill.tsx'

type QuoteSnapshotProps = {
  subject: ResolvedSubject | RouteResolvedSubject
  // The quote is fetched once by the shell (useSubjectQuote) and shared with
  // the Overview grid via context — QuoteSnapshot is purely presentational.
  quoteState: VisibleQuoteState
}

export function QuoteSnapshot({ subject, quoteState }: QuoteSnapshotProps) {
  const issuerProfile = issuerProfileFromSubject(subject)

  if (quoteState.status !== 'ready') {
    return (
      <section className="min-w-0">
        <h1 className="min-w-0 truncate text-2xl font-semibold text-fg">
          {subjectDisplayName(subject)}
        </h1>
        <p className="mt-3 text-sm text-muted">
          {quoteState.status === 'loading'
            ? 'Loading quote…'
            : `Quote unavailable: ${quoteState.reason}`}
        </p>
        <IssuerProfileLine profile={issuerProfile} />
      </section>
    )
  }

  const quote = quoteState.quote
  const direction = SIGNED_BY_QUOTE_DIRECTION[quoteDirection(quote)]

  return (
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
        {/* Provenance is one inline token on the meta line — the source name
            (source_id on hover) — not a hero card. Prev close lives in the
            symbol's key-stats grid. */}
        <div className="pb-1 text-xs text-muted">
          {quote.session_state.replaceAll('_', ' ')} · {quote.delay_class.replaceAll('_', ' ')} ·{' '}
          {formatQuoteTime(quote.as_of, quote.listing.timezone)} ·{' '}
          <span title={quote.source_id}>{formatProviderName(quote.provider, quote.source_id)}</span>
        </div>
      </div>
      <IssuerProfileLine profile={issuerProfile} />
    </section>
  )
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
