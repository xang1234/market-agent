import type { BlockRegistry } from './Registry.ts'
import { AnalystConsensus } from './AnalystConsensus.tsx'
import { EpsSurprise } from './EpsSurprise.tsx'
import { FilingsList } from './FilingsList.tsx'
import { FindingCard } from './FindingCard.tsx'
import { NewsCluster } from './NewsCluster.tsx'
import { PriceTargetRange } from './PriceTargetRange.tsx'

export function registerResearchEvidenceBlockRenderers(registry: BlockRegistry): void {
  registry.register('analyst_consensus', AnalystConsensus)
  registry.register('price_target_range', PriceTargetRange)
  registry.register('eps_surprise', EpsSurprise)
  registry.register('filings_list', FilingsList)
  registry.register('news_cluster', NewsCluster)
  registry.register('finding_card', FindingCard)
}
