// Pure plumbing for the live perf_comparison chart: block → range options,
// block+range → ONE batched series query (pct_return normalization so
// multi-subject series share a % y-axis), and response → SeriesChart-ready
// series named by listing.
//
// The query is anchored at the block's pinned moment — interactive.range_end_max
// when the analyst granted one, otherwise as_of — never "now". Range switching
// stays inside pinned history, so the same sealed block renders the same chart
// on any future day, and anything fresher must go through the explicit refresh
// flow.

import { defineResource } from '../fetch/resource.ts'
import type { AdjustmentBasis, GetSeriesResponse, NormalizedSeriesQuery } from '../symbol/series.ts'
import { dailySeriesQuery, fetchSeries } from '../symbol/series.ts'
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
  return dailySeriesQuery(listings, range, 'pct_return', perfAnchor(block), blockBasis(block))
}

const BASES: ReadonlyArray<AdjustmentBasis> = ['unadjusted', 'split_adjusted', 'split_and_div_adjusted']

// The basis the block displays, so its live series are fetched on it (#191).
function blockBasis(block: PerfComparisonBlock): AdjustmentBasis | undefined {
  return BASES.find((basis) => basis === block.basis)
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

export const perfComparisonSeries = defineResource({
  freshness: 'pinned',
  load: async (query: NormalizedSeriesQuery, signal) => {
    const response = await fetchSeries(query, { signal })
    const series = seriesFromPerfResponse(response)
    if (series.length === 0) return { kind: 'unavailable', reason: 'no series available' }
    return series.length < query.subject_refs.length
      ? { kind: 'ready', data: series, incomplete: true }
      : { kind: 'ready', data: series }
  },
})
