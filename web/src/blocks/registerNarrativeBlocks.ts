import type { BlockRegistry } from './Registry.ts'
import { RichText } from './RichText.tsx'
import { Section } from './Section.tsx'
import { MetricRow } from './MetricRow.tsx'
import { Table } from './Table.tsx'

export function registerNarrativeBlockRenderers(registry: BlockRegistry): void {
  registry.register('rich_text', RichText)
  registry.register('section', Section)
  registry.register('metric_row', MetricRow)
  registry.register('table', Table)
}
