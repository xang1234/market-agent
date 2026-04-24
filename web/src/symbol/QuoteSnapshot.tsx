import {
  createQuoteSnapshotStub,
  formatQuotePrice,
  formatSignedNumber,
  formatSignedPercent,
  quoteDirection,
  subjectDisplayName,
  type ResolvedSubject,
} from './quote.ts'

type QuoteSnapshotProps = {
  subject: ResolvedSubject
}

export function QuoteSnapshot({ subject }: QuoteSnapshotProps) {
  const quote = createQuoteSnapshotStub(subject)
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
            {quote.session_state.replace('_', ' ')} · {quote.delay_class} · {formatQuoteTime(quote.as_of)}
          </div>
        </div>
        {quote.issuer_profile ? (
          <p className="mt-3 max-w-2xl text-sm text-neutral-600 dark:text-neutral-400">
            {quote.issuer_profile.legal_name}
            {quote.issuer_profile.sector ? ` · ${quote.issuer_profile.sector}` : ''}
            {quote.issuer_profile.industry ? ` · ${quote.issuer_profile.industry}` : ''}
          </p>
        ) : null}
      </section>
      <section
        aria-label="Recent quote range"
        className="flex min-h-28 flex-col justify-between rounded-md border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900"
      >
        <div className="flex items-center justify-between text-xs text-neutral-500 dark:text-neutral-400">
          <span>Recent range</span>
          <span>{quote.source_id}</span>
        </div>
        <QuoteSparkline values={quote.recent_range} direction={direction} />
      </section>
    </div>
  )
}

function QuoteSparkline({
  values,
  direction,
}: {
  values: number[]
  direction: 'up' | 'down' | 'flat'
}) {
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = Math.max(max - min, 1)
  const points = values
    .map((value, index) => {
      const x = (index / Math.max(values.length - 1, 1)) * 280
      const y = 72 - ((value - min) / span) * 64
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  const stroke =
    direction === 'up' ? '#047857' : direction === 'down' ? '#b91c1c' : '#525252'

  return (
    <svg viewBox="0 0 280 80" role="img" aria-label="Small recent price chart" className="h-20 w-full">
      <polyline
        fill="none"
        stroke={stroke}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="3"
        points={points}
      />
    </svg>
  )
}

function formatQuoteTime(asOf: string): string {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(asOf))
}
