import { useState, type ReactElement } from 'react'
import { fetchSeries } from '../symbol/series.ts'
import { SegmentedToggle } from '../symbol/SegmentedToggle.tsx'
import { useFetched } from '../symbol/useFetched.ts'
import { ChartCard } from './ChartCard.tsx'
import { LabelValueCell } from './LabelValueCell.tsx'
import { perfNormalizationLabel } from './perfComparison.ts'
import {
  perfRangeOptions,
  perfSeriesQuery,
  seriesFromPerfResponse,
} from './perfComparisonSeries.ts'
import { SeriesChart } from './SeriesChart.tsx'
import { SubjectChipList } from './SubjectChipList.tsx'
import type { PerfComparisonBlock, Series } from './types.ts'

type PerfComparisonProps = { block: PerfComparisonBlock }

// Multi-series performance chart (the reference terminal's centerpiece). A
// sealed block (a chat answer) carries its series and is drawn exactly as
// sealed. Otherwise the client fetches the normalized %-return series from
// /v1/market/series per selected range; when no series is fetchable
// (non-listing subjects, missing coverage, tests without a network) the block
// falls back to the original metadata card.
export function PerfComparison({ block }: PerfComparisonProps): ReactElement {
  // `series` present (even empty) marks a sealed block: never fall back to live data.
  if (block.series !== undefined) {
    return <SealedPerfComparison block={block} series={block.series} />
  }
  return <LivePerfComparison block={block} />
}

// Only the sealed window exists, so there is no range toggle and no fetch.
function SealedPerfComparison({
  block,
  series,
}: {
  block: PerfComparisonBlock
  series: ReadonlyArray<Series>
}): ReactElement {
  return (
    <ChartCard
      testId={`block-perf-comparison-${block.id}`}
      blockKind="perf_comparison"
      title={block.title}
      dataAttrs={{
        'data-default-range': block.default_range,
        'data-basis': block.basis,
        'data-normalization': block.normalization,
        'data-active-range': block.default_range,
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SubjectChipList
          testId={`block-perf-comparison-${block.id}-subjects`}
          keyPrefix={`${block.id}-subj`}
          subjects={block.subject_refs}
          labels={block.subject_labels}
          dense
        />
        <span className="text-xs text-muted">{block.default_range}</span>
      </div>
      {series.length > 0 ? (
        <SeriesChart
          testId={`block-perf-comparison-${block.id}-chart`}
          ariaLabel={`${block.default_range} performance comparison`}
          series={series}
        />
      ) : (
        <p className="text-xs text-muted">No sealed price data for this comparison.</p>
      )}
    </ChartCard>
  )
}

function LivePerfComparison({ block }: PerfComparisonProps): ReactElement {
  const ranges = perfRangeOptions(block)
  const [range, setRange] = useState<string>(
    ranges.includes(block.default_range) ? block.default_range : ranges[0],
  )
  const state = useFetched<ReadonlyArray<Series>>(
    `${block.id}|${range}`,
    async (_key, signal) => {
      const query = perfSeriesQuery(block, range)
      if (query === null) return { kind: 'unavailable', reason: 'no listing subjects in block' }
      const response = await fetchSeries(query, { signal })
      const series = seriesFromPerfResponse(response)
      if (series.length === 0) return { kind: 'unavailable', reason: 'no series available' }
      return { kind: 'ready', data: series }
    },
  )

  return (
    <ChartCard
      testId={`block-perf-comparison-${block.id}`}
      blockKind="perf_comparison"
      title={block.title}
      dataAttrs={{
        'data-default-range': block.default_range,
        'data-basis': block.basis,
        'data-normalization': block.normalization,
        'data-active-range': range,
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SubjectChipList
          testId={`block-perf-comparison-${block.id}-subjects`}
          keyPrefix={`${block.id}-subj`}
          subjects={block.subject_refs}
          labels={block.subject_labels}
          dense
        />
        <SegmentedToggle
          options={ranges.map((value) => ({ value, label: value }))}
          value={range}
          onChange={setRange}
          ariaLabel="Performance range"
          testIdPrefix={`block-perf-comparison-${block.id}-range`}
        />
      </div>
      {state.status === 'ready' ? (
        <SeriesChart
          testId={`block-perf-comparison-${block.id}-chart`}
          ariaLabel={`${range} performance comparison`}
          series={state.data}
        />
      ) : (
        <dl className="grid grid-cols-3 gap-2 text-xs text-muted">
          <LabelValueCell label="Range">{range}</LabelValueCell>
          <LabelValueCell label="Basis">{block.basis}</LabelValueCell>
          <LabelValueCell label="Normalization">{perfNormalizationLabel(block.normalization)}</LabelValueCell>
        </dl>
      )}
    </ChartCard>
  )
}
