import { useState, type ReactNode } from 'react'
import { useSubjectDetailContext } from '../../shell/subjectDetailOutletContext.ts'
import { Card } from '../../symbol/Card.tsx'
import { FetchStateView } from '../../symbol/FetchStateView.tsx'
import { useFetched } from '../../symbol/useFetched.ts'
import {
  fetchIssuerProfile,
  issuerIdFromSubject,
  profileBelongsToIssuer,
  type IssuerProfile,
  type IssuerProfileExchange,
} from '../../symbol/profile.ts'
import {
  fetchKeyStats,
  statsBelongToIssuer,
  type KeyStatsEnvelope,
} from '../../symbol/stats.ts'
import { listingIdForQuote } from '../../symbol/quote.ts'
import {
  dailySeriesQuery,
  fetchSeries,
  singleListingOutcome,
  type NormalizedBar,
  type PriceWindow,
} from '../../symbol/series.ts'
import { SeriesChart } from '../../blocks/SeriesChart.tsx'
import { SegmentedToggle } from '../../symbol/SegmentedToggle.tsx'
import { SectorChip } from '../../symbol/SectorChip.tsx'
import { useConsensus } from '../../symbol/useConsensus.ts'
import { ConsensusBody, PriceTargetBody } from '../../symbol/consensusViews.tsx'
import { buildKeyStatsGrid } from './keyStatsGrid.ts'
import { KeyStatsGrid } from './KeyStatsGrid.tsx'
import { SECTION_STACK_CLASS } from './sectionLayout.ts'

type PriceSeries = { bars: NormalizedBar[]; currency: string }

const PRICE_WINDOW_OPTIONS: ReadonlyArray<{ value: PriceWindow; label: string }> = [
  { value: '5D', label: '5D' },
  { value: '1M', label: '1M' },
  { value: '6M', label: '6M' },
  { value: 'YTD', label: 'YTD' },
  { value: '1Y', label: '1Y' },
  { value: '5Y', label: '5Y' },
]

export function OverviewSection() {
  const { subject, quote } = useSubjectDetailContext()
  const issuerId = issuerIdFromSubject(subject)
  const listingId = listingIdForQuote(subject)

  const profile = useFetched<IssuerProfile>(issuerId, async (id, signal) => {
    const data = await fetchIssuerProfile(id, { signal })
    if (!profileBelongsToIssuer(data, id)) {
      return { kind: 'unavailable', reason: 'profile response did not match requested issuer' }
    }
    return { kind: 'ready', data }
  })

  const stats = useFetched<KeyStatsEnvelope>(issuerId, async (id, signal) => {
    const data = await fetchKeyStats(id, { signal })
    if (!statsBelongToIssuer(data, id)) {
      return { kind: 'unavailable', reason: 'stats response did not match requested issuer' }
    }
    return { kind: 'ready', data }
  })

  const [priceWindow, setPriceWindow] = useState<PriceWindow>('1M')
  // Window lives in the key so a toggle is one intentional re-fetch and a
  // return visit to the same window is a cache hit — not a per-render re-key.
  const seriesKey = listingId === null ? null : `${listingId}|${priceWindow}`

  const series = useFetched<PriceSeries>(seriesKey, async (_key, signal) => {
    if (listingId === null) {
      return { kind: 'unavailable', reason: 'no listing context for this subject' }
    }
    // Live surface: anchored at "now" by contract (sealed blocks pin as_of).
    const query = dailySeriesQuery([{ kind: 'listing', id: listingId }], priceWindow, 'raw', new Date())
    if (query === null) {
      return { kind: 'unavailable', reason: 'unknown price window' }
    }
    const response = await fetchSeries(query, { signal })
    const outcome = singleListingOutcome(response, listingId)
    if (outcome === null) {
      return { kind: 'unavailable', reason: 'series response did not include this listing' }
    }
    if (outcome.outcome === 'unavailable') {
      return { kind: 'unavailable', reason: outcome.detail ?? outcome.reason }
    }
    return { kind: 'ready', data: { bars: outcome.data.bars, currency: outcome.data.currency } }
  })

  // Analyst consensus + price target are surfaced on the landing tab (not only
  // under Earnings), matching the reference design — same shared fetch.
  const consensus = useConsensus(issuerId)

  // The dense stats grid renders from whatever's loaded — prev close/currency
  // from the shared quote, intraday cells from the latest bars, fundamentals
  // from the key-stats envelope — dashing the rest. Not gated behind a single
  // fetch so a slow stats call doesn't hide the price cells (and vice-versa).
  const priceSeries = series.status === 'ready' ? series.data : null
  const statsEnvelope = stats.status === 'ready' ? stats.data : null
  const statCells = buildKeyStatsGrid({
    bars: priceSeries?.bars ?? null,
    stats: statsEnvelope,
    prevClose: quote?.prev_close ?? null,
    currency: quote?.currency ?? priceSeries?.currency ?? 'USD',
  })

  return (
    <div
      data-testid="section-overview"
      className={SECTION_STACK_CLASS}
    >
      <Card
        testId="overview-performance"
        headingId="overview-performance-heading"
        heading={`Performance · ${priceWindow}`}
        action={
          <SegmentedToggle
            options={PRICE_WINDOW_OPTIONS}
            value={priceWindow}
            onChange={setPriceWindow}
            ariaLabel="Price range"
            testIdPrefix="price-window"
          />
        }
      >
        <FetchStateView
          state={series}
          noun="series"
          idleMessage="No listing context for this subject."
        >
          {({ bars }) =>
            bars.length < 2 ? (
              <p className="text-sm text-muted">
                Not enough bars in the requested range to draw a line.
              </p>
            ) : (
              <PriceSparkline bars={bars} windowLabel={priceWindow} />
            )
          }
        </FetchStateView>
      </Card>
      <KeyStatsGrid cells={statCells} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
        <Card testId="overview-profile" headingId="overview-profile-heading" heading="Company profile">
          <FetchStateView
            state={profile}
            noun="profile"
            idleMessage="Issuer context unavailable for this entry. Open this symbol from search to load the company profile."
          >
            {(data) => <ProfileBody profile={data} />}
          </FetchStateView>
        </Card>
        <Card
          testId="overview-consensus"
          headingId="overview-consensus-heading"
          heading="Analyst consensus"
        >
          <FetchStateView
            state={consensus}
            noun="consensus"
            idleMessage="Issuer context unavailable for this entry. Open this symbol from search to load consensus."
          >
            {(envelope) => <ConsensusBody envelope={envelope} />}
          </FetchStateView>
        </Card>
      </div>
      <Card
        testId="overview-price-target"
        headingId="overview-price-target-heading"
        heading="Price target"
      >
        <FetchStateView
          state={consensus}
          noun="price target"
          idleMessage="Issuer context unavailable for this entry."
        >
          {(envelope) =>
            envelope.price_target ? (
              <PriceTargetBody target={envelope.price_target} />
            ) : (
              <p className="text-sm text-muted">No price target in this consensus envelope.</p>
            )
          }
        </FetchStateView>
      </Card>
    </div>
  )
}

function ProfileBody({ profile }: { profile: IssuerProfile }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
      <ProfileRow label="Legal name" value={profile.legal_name} />
      {profile.sector && (
        <div className="flex flex-col">
          <ProfileLabel>Sector</ProfileLabel>
          <dd className="mt-1">
            <SectorChip>{profile.sector}</SectorChip>
          </dd>
        </div>
      )}
      {profile.industry && <ProfileRow label="Industry" value={profile.industry} />}
      {profile.domicile && <ProfileRow label="Domicile" value={profile.domicile} />}
      {profile.cik && <ProfileRow label="CIK" value={profile.cik} mono />}
      {profile.lei && <ProfileRow label="LEI" value={profile.lei} mono />}
      {profile.exchanges.length > 0 && (
        <div className="sm:col-span-2">
          <ProfileLabel>Listed on</ProfileLabel>
          <ul className="mt-1 flex flex-wrap gap-2">
            {profile.exchanges.map((exchange) => (
              <ExchangeBadge key={exchange.listing.id} exchange={exchange} />
            ))}
          </ul>
        </div>
      )}
      {profile.former_names.length > 0 && (
        <div className="sm:col-span-2">
          <ProfileLabel>Former names</ProfileLabel>
          <p className="mt-1 text-fg">{profile.former_names.join(', ')}</p>
        </div>
      )}
    </dl>
  )
}

function ProfileRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col">
      <ProfileLabel>{label}</ProfileLabel>
      <dd
        className={
          mono
            ? 'mt-0.5 font-mono text-xs text-fg'
            : 'mt-0.5 text-fg'
        }
      >
        {value}
      </dd>
    </div>
  )
}

function ProfileLabel({ children }: { children: ReactNode }) {
  return (
    <dt className="text-xs uppercase tracking-wide text-muted">
      {children}
    </dt>
  )
}

function ExchangeBadge({ exchange }: { exchange: IssuerProfileExchange }) {
  return (
    <li className="inline-flex items-center gap-1.5 rounded-md border border-line px-2 py-0.5 text-xs text-fg">
      <span className="font-medium">{exchange.ticker}</span>
      <span className="text-muted">·</span>
      <span>{exchange.mic}</span>
      <span className="text-muted">·</span>
      <span>{exchange.trading_currency}</span>
    </li>
  )
}

// Hero price chart: SeriesChart brings the gradient area fill and the
// crosshair hover readout (reference-terminal interaction) that the bare
// Sparkline lacked.
function PriceSparkline({ bars, windowLabel }: { bars: NormalizedBar[]; windowLabel: string }) {
  const first = bars[0].close
  const last = bars[bars.length - 1].close
  return (
    <div className="flex flex-col gap-2">
      <SeriesChart
        testId="overview-hero-chart"
        ariaLabel={`${windowLabel} price line from ${formatPrice(first)} to ${formatPrice(last)}`}
        series={[
          {
            name: 'Close',
            points: bars.map((bar) => ({ x: bar.ts.slice(0, 10), y: bar.close })),
          },
        ]}
      />
      <div className="flex items-center justify-between text-xs num text-muted">
        <span>{formatPrice(first)}</span>
        <span>{bars.length} bars</span>
        <span>{formatPrice(last)}</span>
      </div>
    </div>
  )
}

function formatPrice(value: number): string {
  return value.toFixed(2)
}

