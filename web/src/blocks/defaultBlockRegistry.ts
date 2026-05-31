import { createBlockRegistry, type BlockRegistry } from './Registry.ts'
import { registerNarrativeBlockRenderers } from './registerNarrativeBlocks.ts'
import { registerChartBlockRenderers } from './registerChartBlocks.ts'
import { registerResearchEvidenceBlockRenderers } from './registerResearchEvidenceBlocks.ts'
import { registerTrustProvenanceBlockRenderers } from './registerTrustProvenanceBlocks.ts'
import { registerCommoditiesBlockRenderers } from './registerCommoditiesBlocks.ts'

export function createDefaultBlockRegistry(): BlockRegistry {
  const registry = createBlockRegistry()
  registerNarrativeBlockRenderers(registry)
  registerChartBlockRenderers(registry)
  registerResearchEvidenceBlockRenderers(registry)
  registerTrustProvenanceBlockRenderers(registry)
  registerCommoditiesBlockRenderers(registry)
  return registry
}
