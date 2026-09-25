import type { BlockRegistry } from './Registry.ts'
import { FinancialAnswer } from './FinancialAnswer.tsx'

export function registerCertifiedFinancialBlockRenderers(registry: BlockRegistry): void {
  registry.register('financial_answer', FinancialAnswer)
}
