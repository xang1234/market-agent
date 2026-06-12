// Pure plumbing for the live perf_comparison chart: block → range options,
// range label → day span, block+range → ONE batched series query
// (pct_return normalization so multi-subject series share a % y-axis), and
// response → SeriesChart-ready series named by listing.

import type { GetSeriesResponse, NormalizedSeriesQuery } from '../symbol/series.ts'
import { formatSubjectRefShort } from './subjectRef.ts'
import type { PerfComparisonBlock, Series, SubjectRef } from './types.ts'

const DEFAULT_RANGES: ReadonlyArray<string> = ['1M', '3M', '6M', 'YTD', '1Y']

const FIXED_RANGE_DAYS: Readonly<Record<string, number>> = {
  '5D': 7,
  '1M': 30,
  '3M': 90,
  '6M': 180,
  '1Y': 365,
  '5Y': 1825,
}

const DAY_MS = 24 * 60 * 60 * 1000

export function perfRangeOptions(block: PerfComparisonBlock): ReadonlyArray<string> {
  const ranges = block.interactive?.ranges
  return ranges !== undefined && ranges.length > 0 ? ranges : DEFAULT_RANGES
}

export function perfRangeDays(range: string, now: Date): number | null {
  if (range === 'YTD') {
    const yearStart = Date.UTC(now.getUTCFullYear(), 0, 1)
    return Math.max(7, Math.floor((now.getTime() - yearStart) / DAY_MS))
  }
  return FIXED_RANGE_DAYS[range] ?? null
}

export function perfSeriesQuery(
  block: PerfComparisonBlock,
  range: string,
  now: Date,
): NormalizedSeriesQuery | null {
  const listings = block.subject_refs.filter(
    (ref): ref is SubjectRef & { kind: 'listing' } => ref.kind === 'listing',
  )
  const days = perfRangeDays(range, now)
  if (listings.length === 0 || days === null) return null
  return {
    subject_refs: listings,
    range: {
      start: new Date(now.getTime() - days * DAY_MS).toISOString(),
      end: now.toISOString(),
    },
    interval: '1d',
    basis: 'split_and_div_adjusted',
    normalization: 'pct_return',
  }
}

export function seriesFromPerfResponse(response: GetSeriesResponse): ReadonlyArray<Series> {
  const series: Series[] = []
  for (const entry of response.results) {
    if (entry.outcome.outcome !== 'available') continue
    series.push({
      name: formatSubjectRefShort(entry.listing),
      unit: '%',
      points: entry.outcome.data.bars.map((bar) => ({
        x: bar.ts.slice(0, 10),
        y: bar.close,
      })),
    })
  }
  return series
}
