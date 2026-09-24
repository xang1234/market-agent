import { createBlockRegistry, type BlockRegistry } from './Registry.ts'
import { registerNarrativeBlockRenderers } from './registerNarrativeBlocks.ts'
import { registerChartBlockRenderers } from './registerChartBlocks.ts'
import { registerResearchEvidenceBlockRenderers } from './registerResearchEvidenceBlocks.ts'
import { registerTrustProvenanceBlockRenderers } from './registerTrustProvenanceBlocks.ts'
import { registerCertifiedFinancialBlockRenderers } from './registerCertifiedFinancialBlocks.ts'

export function createDefaultBlockRegistry(): BlockRegistry {
  const registry = createBlockRegistry()
  registerNarrativeBlockRenderers(registry)
  registerChartBlockRenderers(registry)
  registerResearchEvidenceBlockRenderers(registry)
  registerTrustProvenanceBlockRenderers(registry)
  registerCertifiedFinancialBlockRenderers(registry)
  return registry
}
