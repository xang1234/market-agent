import type { BlockRegistry } from './Registry.ts'
import { FinancialAnswer } from './FinancialAnswer.tsx'
import { ScenarioPriceComparison } from './ScenarioPriceComparison.tsx'
import { Call } from './Call.tsx'

export function registerCertifiedFinancialBlockRenderers(registry: BlockRegistry): void {
  registry.register('financial_answer', FinancialAnswer)
  registry.register('scenario_price_comparison', ScenarioPriceComparison)
  registry.register('call', Call)
}
