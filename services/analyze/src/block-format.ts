// Shared display formatting for analyze blocks. Compact currency (e.g. "$3.2B")
// matches the metric_row / metrics_comparison / revenue_bars contract: the block
// carries the rendered string so the web stays a dumb renderer.

export function formatCompactCurrency(value: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    notation: "compact",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value);
}
