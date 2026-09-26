import type { BlockRegistry } from './Registry.ts'
import { LineChart } from './LineChart.tsx'
import { MentionVolume } from './MentionVolume.tsx'
import { MetricsComparison } from './MetricsComparison.tsx'
import { PerfComparison } from './PerfComparison.tsx'
import { RevenueBars } from './RevenueBars.tsx'
import { SegmentDonut } from './SegmentDonut.tsx'
import { SegmentTrajectory } from './SegmentTrajectory.tsx'
import { SentimentTrend } from './SentimentTrend.tsx'

export function registerChartBlockRenderers(registry: BlockRegistry): void {
  // Financial and market figures charted from stored facts and quotes, not certified calculations.
  registry.register('line_chart', LineChart, 'legacy')
  registry.register('revenue_bars', RevenueBars, 'legacy')
  registry.register('perf_comparison', PerfComparison, 'legacy')
  registry.register('segment_donut', SegmentDonut, 'legacy')
  registry.register('segment_trajectory', SegmentTrajectory, 'legacy')
  registry.register('metrics_comparison', MetricsComparison, 'legacy')
  registry.register('sentiment_trend', SentimentTrend)
  registry.register('mention_volume', MentionVolume)
}
