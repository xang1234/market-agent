import { createBlockRegistry, type BlockRegistry } from './Registry.ts'
import { registerNarrativeBlockRenderers } from './registerNarrativeBlocks.ts'
import { registerChartBlockRenderers } from './registerChartBlocks.ts'
import { registerResearchEvidenceBlockRenderers } from './registerResearchEvidenceBlocks.ts'
import { registerTrustProvenanceBlockRenderers } from './registerTrustProvenanceBlocks.ts'

// Single composition seam for the catalog: chat, Analyze, Home, and findings
// all consume the registry produced here (mounted once at the App root via
// BlockRegistryProvider). Adding a new block kind is a single-place change in
// the matching register*BlockRenderers helper — no surface-level wiring change.
export function createDefaultBlockRegistry(): BlockRegistry {
  const registry = createBlockRegistry()
  registerNarrativeBlockRenderers(registry)
  registerChartBlockRenderers(registry)
  registerResearchEvidenceBlockRenderers(registry)
  registerTrustProvenanceBlockRenderers(registry)
  return registry
}
