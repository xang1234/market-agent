// Pure plumbing for the live perf_comparison chart: block → range options,
// block+range → ONE batched series query (pct_return normalization so
// multi-subject series share a % y-axis), and response → SeriesChart-ready
// series named by listing.
//
// The query is anchored at the block's pinned moment — interactive.range_end_max
// when the analyst granted one, otherwise as_of — never "now". Range switching
// is an approved transform over pinned history (stock-agent-v2 §sealed
// snapshots): the same sealed block renders the same chart on any future day,
// and anything fresher must go through the explicit refresh flow.

import type { GetSeriesResponse, NormalizedSeriesQuery } from '../symbol/series.ts'
import { dailySeriesQuery } from '../symbol/series.ts'
import { formatSubjectRefShort } from './subjectRef.ts'
import type { PerfComparisonBlock, Series, SubjectRef } from './types.ts'

const DEFAULT_RANGES: ReadonlyArray<string> = ['1M', '3M', '6M', 'YTD', '1Y']

export function perfRangeOptions(block: PerfComparisonBlock): ReadonlyArray<string> {
  const ranges = block.interactive?.ranges
  return ranges !== undefined && ranges.length > 0 ? ranges : DEFAULT_RANGES
}

// The pinned end-of-range moment for this block's series fetches.
export function perfAnchor(block: PerfComparisonBlock): Date {
  return new Date(block.interactive?.range_end_max ?? block.as_of)
}

export function perfSeriesQuery(
  block: PerfComparisonBlock,
  range: string,
): NormalizedSeriesQuery | null {
  const listings = block.subject_refs.filter(
    (ref): ref is SubjectRef & { kind: 'listing' } => ref.kind === 'listing',
  )
  return dailySeriesQuery(listings, range, 'pct_return', perfAnchor(block))
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
