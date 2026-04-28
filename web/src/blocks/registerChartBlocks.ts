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
  registry.register('line_chart', LineChart)
  registry.register('revenue_bars', RevenueBars)
  registry.register('perf_comparison', PerfComparison)
  registry.register('segment_donut', SegmentDonut)
  registry.register('segment_trajectory', SegmentTrajectory)
  registry.register('metrics_comparison', MetricsComparison)
  registry.register('sentiment_trend', SentimentTrend)
  registry.register('mention_volume', MentionVolume)
}
