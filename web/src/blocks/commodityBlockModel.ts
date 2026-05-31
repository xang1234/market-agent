import type { CommoditiesBlock } from './types.ts'

export type CommodityDisplayRow = ReadonlyArray<string>

export function commodityBlockDisplayRows(block: CommoditiesBlock): ReadonlyArray<CommodityDisplayRow> {
  switch (block.kind) {
    case 'daily_call_summary':
      return [
        ['Horizons', block.horizons.join(', ')],
        ['Confidence', percent(block.confidence)],
      ]
    case 'driver_board':
      return block.drivers.map((driver) => [
        [driver.channel, driver.direction, driver.horizon].join(' / '),
        driver.summary,
        percent(driver.confidence),
      ])
    case 'curve_chart':
      return block.points.map((point) => [
        point.tenor,
        `${point.price} ${block.currency}/${block.unit}`,
      ])
    case 'spread_table':
      return block.spreads.map((spread) => [
        spread.label,
        `${spread.value} ${spread.currency}/${spread.unit}`,
      ])
    case 'inventory_bridge':
      return block.rows.map((row) => [
        row.label,
        row.delta === undefined ? `${row.value} ${row.unit}` : `${row.value} ${row.unit} (${signed(row.delta)})`,
      ])
    case 'impact_matrix':
      return block.rows.map((row) => [
        [row.channel, row.direction, row.horizon].join(' / '),
        row.summary,
        percent(row.confidence),
      ])
    case 'report_delta':
      return block.deltas.map((delta) => [
        delta.horizon,
        delta.summary,
        percent(delta.confidence),
      ])
    case 'watch_item_table':
      return block.items.map((item) => [item.label, item.trigger, item.horizon])
    case 'forecast_vs_market':
      return block.rows.map((row) => [
        row.label,
        row.gap_ref === undefined
          ? `${row.market_ref} / ${row.forecast_ref}`
          : `${row.market_ref} / ${row.forecast_ref} / ${row.gap_ref}`,
      ])
    case 'source_pack':
      return block.sources.map((source) => [
        source.label,
        source.entitlement ?? 'standard',
        source.url ?? source.source_id,
      ])
  }
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value)
}
