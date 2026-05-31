import type { ReactNode } from 'react'
import type {
  CurveChartBlock,
  DailyCallSummaryBlock,
  DriverBoardBlock,
  ForecastVsMarketBlock,
  ImpactMatrixBlock,
  InventoryBridgeBlock,
  ReportDeltaBlock,
  SourcePackBlock,
  SpreadTableBlock,
  WatchItemTableBlock,
} from './types.ts'

type ShellProps = {
  kind: string
  title?: string
  children: ReactNode
}

export function DailyCallSummary({ block }: { block: DailyCallSummaryBlock }) {
  return (
    <CommodityShell kind={block.kind} title={block.title}>
      <p className="text-sm text-neutral-700 dark:text-neutral-300">{block.narrative}</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <Metric label="Horizons" value={block.horizons.join(', ')} />
        <Metric label="Confidence" value={percent(block.confidence)} />
      </div>
    </CommodityShell>
  )
}

export function DriverBoard({ block }: { block: DriverBoardBlock }) {
  return (
    <CommodityShell kind={block.kind} title={block.title}>
      <div className="grid gap-2">
        {block.drivers.map((driver) => (
          <div key={driver.driver_id} className="rounded border border-neutral-200 p-2 dark:border-neutral-800">
            <div className="text-xs font-medium uppercase text-neutral-500 dark:text-neutral-400">
              {driver.channel} / {driver.direction} / {driver.horizon}
            </div>
            <p className="mt-1 text-sm text-neutral-800 dark:text-neutral-200">{driver.summary}</p>
            <div className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">{percent(driver.confidence)} confidence</div>
          </div>
        ))}
      </div>
    </CommodityShell>
  )
}

export function CurveChart({ block }: { block: CurveChartBlock }) {
  const maxPrice = Math.max(...block.points.map((point) => point.price))
  return (
    <CommodityShell kind={block.kind} title={block.title}>
      <div className="grid gap-2">
        {block.points.map((point) => (
          <div key={point.tenor} className="grid grid-cols-[5rem_1fr_auto] items-center gap-2 text-sm">
            <span className="font-medium text-neutral-800 dark:text-neutral-100">{point.tenor}</span>
            <span className="h-2 overflow-hidden rounded bg-neutral-100 dark:bg-neutral-800">
              <span
                className="block h-full bg-emerald-600"
                style={{ width: `${Math.max(8, Math.round((point.price / maxPrice) * 100))}%` }}
              />
            </span>
            <span className="tabular-nums text-neutral-600 dark:text-neutral-300">
              {formatNumber(point.price)} {block.currency}/{block.unit}
            </span>
          </div>
        ))}
      </div>
    </CommodityShell>
  )
}

export function SpreadTable({ block }: { block: SpreadTableBlock }) {
  return (
    <CommodityShell kind={block.kind} title={block.title}>
      <table className="w-full text-left text-sm">
        <thead className="text-xs uppercase text-neutral-500 dark:text-neutral-400">
          <tr>
            <th className="py-1 pr-2 font-medium">Spread</th>
            <th className="py-1 text-right font-medium">Value</th>
          </tr>
        </thead>
        <tbody>
          {block.spreads.map((spread) => (
            <tr key={spread.label} className="border-t border-neutral-200 dark:border-neutral-800">
              <td className="py-2 pr-2">{spread.label}</td>
              <td className="py-2 text-right tabular-nums">
                {formatNumber(spread.value)} {spread.currency}/{spread.unit}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </CommodityShell>
  )
}

export function InventoryBridge({ block }: { block: InventoryBridgeBlock }) {
  return (
    <CommodityShell kind={block.kind} title={block.title}>
      <div className="grid gap-2">
        {block.rows.map((row) => (
          <div key={row.label} className="grid grid-cols-[1fr_auto_auto] gap-3 text-sm">
            <span>{row.label}</span>
            <span className="tabular-nums text-neutral-700 dark:text-neutral-300">{formatNumber(row.value)} {row.unit}</span>
            <span className={signedClass(row.delta ?? 0)}>{row.delta === undefined ? 'flat' : signed(row.delta)}</span>
          </div>
        ))}
      </div>
    </CommodityShell>
  )
}

export function ImpactMatrix({ block }: { block: ImpactMatrixBlock }) {
  return (
    <CommodityShell kind={block.kind} title={block.title}>
      <div className="grid gap-2">
        {block.rows.map((row, index) => (
          <div key={`${row.channel}:${row.horizon}:${index}`} className="rounded border border-neutral-200 p-2 dark:border-neutral-800">
            <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
              <span>{row.channel}</span>
              <span>{row.direction}</span>
              <span>{row.horizon}</span>
              <span>{percent(row.confidence)}</span>
            </div>
            <p className="mt-1 text-sm">{row.summary}</p>
          </div>
        ))}
      </div>
    </CommodityShell>
  )
}

export function ReportDelta({ block }: { block: ReportDeltaBlock }) {
  return (
    <CommodityShell kind={block.kind} title={block.title}>
      <div className="grid gap-2">
        {block.deltas.map((delta) => (
          <div key={`${delta.source_id}:${delta.horizon}`} className="grid gap-1 border-b border-neutral-200 pb-2 last:border-b-0 dark:border-neutral-800">
            <div className="text-xs uppercase text-neutral-500 dark:text-neutral-400">{delta.horizon} / {percent(delta.confidence)}</div>
            <p className="text-sm">{delta.summary}</p>
          </div>
        ))}
      </div>
    </CommodityShell>
  )
}

export function WatchItemTable({ block }: { block: WatchItemTableBlock }) {
  return (
    <CommodityShell kind={block.kind} title={block.title}>
      <table className="w-full text-left text-sm">
        <thead className="text-xs uppercase text-neutral-500 dark:text-neutral-400">
          <tr>
            <th className="py-1 pr-2 font-medium">Watch</th>
            <th className="py-1 pr-2 font-medium">Trigger</th>
            <th className="py-1 text-right font-medium">Horizon</th>
          </tr>
        </thead>
        <tbody>
          {block.items.map((item) => (
            <tr key={`${item.label}:${item.horizon}`} className="border-t border-neutral-200 dark:border-neutral-800">
              <td className="py-2 pr-2">{item.label}</td>
              <td className="py-2 pr-2">{item.trigger}</td>
              <td className="py-2 text-right">{item.horizon}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </CommodityShell>
  )
}

export function ForecastVsMarket({ block }: { block: ForecastVsMarketBlock }) {
  return (
    <CommodityShell kind={block.kind} title={block.title}>
      <div className="grid gap-2">
        {block.rows.map((row) => (
          <div key={row.label} className="grid gap-1 rounded border border-neutral-200 p-2 text-sm dark:border-neutral-800">
            <span className="font-medium">{row.label}</span>
            <span className="text-neutral-600 dark:text-neutral-300">Market {row.market_ref}</span>
            <span className="text-neutral-600 dark:text-neutral-300">Forecast {row.forecast_ref}</span>
            {row.gap_ref ? <span className="text-neutral-600 dark:text-neutral-300">Gap {row.gap_ref}</span> : null}
          </div>
        ))}
      </div>
    </CommodityShell>
  )
}

export function SourcePack({ block }: { block: SourcePackBlock }) {
  return (
    <CommodityShell kind={block.kind} title={block.title}>
      <div className="grid gap-2">
        {block.sources.map((source) => (
          <div key={source.source_id} className="grid gap-1 rounded border border-neutral-200 p-2 text-sm dark:border-neutral-800">
            <span className="font-medium">{source.label}</span>
            <span className="text-xs uppercase text-neutral-500 dark:text-neutral-400">{source.entitlement ?? 'standard'}</span>
            {source.url ? (
              <a className="break-all text-emerald-700 hover:underline dark:text-emerald-300" href={source.url}>
                {source.url}
              </a>
            ) : (
              <span className="break-all text-neutral-500 dark:text-neutral-400">{source.source_id}</span>
            )}
          </div>
        ))}
      </div>
    </CommodityShell>
  )
}

function CommodityShell({ kind, title, children }: ShellProps) {
  return (
    <section className="rounded-md border border-neutral-200 bg-white p-3 text-sm dark:border-neutral-800 dark:bg-neutral-900">
      <div className="text-xs font-semibold uppercase text-neutral-500 dark:text-neutral-400">
        {kind.replaceAll('_', ' ')}
      </div>
      {title ? <h3 className="mt-1 text-sm font-semibold">{title}</h3> : null}
      <div className="mt-3">{children}</div>
    </section>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-neutral-200 p-2 dark:border-neutral-800">
      <div className="text-xs uppercase text-neutral-500 dark:text-neutral-400">{label}</div>
      <div className="mt-1 font-medium">{value}</div>
    </div>
  )
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`
}

function signed(value: number): string {
  return value > 0 ? `+${formatNumber(value)}` : formatNumber(value)
}

function signedClass(value: number): string {
  if (value > 0) return 'tabular-nums text-emerald-700 dark:text-emerald-300'
  if (value < 0) return 'tabular-nums text-red-700 dark:text-red-300'
  return 'tabular-nums text-neutral-500 dark:text-neutral-400'
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value)
}
