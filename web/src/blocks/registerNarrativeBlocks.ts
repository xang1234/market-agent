import type { BlockRegistry } from './Registry.ts'
import { RichText } from './RichText.tsx'
import { Section } from './Section.tsx'
import { MetricRow } from './MetricRow.tsx'
import { Table } from './Table.tsx'

export function registerNarrativeBlockRenderers(registry: BlockRegistry): void {
  // Prose that cites sources is narrative; uncited text (a gap or a question) makes no sourced claim to label.
  registry.register('rich_text', RichText, (block) => (block.source_refs.length > 0 ? 'narrative' : null))
  registry.register('section', Section)
  // Figures from stored facts or vendors, not certified calculations.
  registry.register('metric_row', MetricRow, 'legacy')
  registry.register('table', Table, 'legacy')
}
