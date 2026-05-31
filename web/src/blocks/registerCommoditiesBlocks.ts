import type { BlockRegistry } from './Registry.ts'
import {
  CurveChart,
  DailyCallSummary,
  DriverBoard,
  ForecastVsMarket,
  ImpactMatrix,
  InventoryBridge,
  ReportDelta,
  SourcePack,
  SpreadTable,
  WatchItemTable,
} from './CommodityBlocks.tsx'

export function registerCommoditiesBlockRenderers(registry: BlockRegistry): void {
  registry.register('daily_call_summary', DailyCallSummary)
  registry.register('driver_board', DriverBoard)
  registry.register('curve_chart', CurveChart)
  registry.register('spread_table', SpreadTable)
  registry.register('inventory_bridge', InventoryBridge)
  registry.register('impact_matrix', ImpactMatrix)
  registry.register('report_delta', ReportDelta)
  registry.register('watch_item_table', WatchItemTable)
  registry.register('forecast_vs_market', ForecastVsMarket)
  registry.register('source_pack', SourcePack)
}
