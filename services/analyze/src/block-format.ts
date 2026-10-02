// Shared display formatting for analyze blocks. Compact currency (e.g. "$3.2B")
// matches the metric_row / metrics_comparison / revenue_bars contract: the block
// carries the rendered string so the web stays a dumb renderer.

export function formatCompactCurrency(value: number, currency: string): string {
  return currencyFormat(currency, {
    notation: "compact",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value);
}

// A ratio (0.708) as a percentage to one decimal ("70.8%"): margins and growth,
// in comparison cells and chat's metric rows alike.
export function formatPercent(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

// Precise currency for price points (e.g. "$214.50") — unlike formatCompactCurrency,
// which compacts large statement values (e.g. "$3.2B").
export function formatCurrency(value: number, currency: string): string {
  return currencyFormat(currency, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

// A currency whose symbol contains a dot (XCG's "Cg.") is written with its ISO
// code instead ("-XCG 3.1B"): a dotted prefix reads as a sentence end to chat's
// narrative guard (#150).
function currencyFormat(currency: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const symbol = new Intl.NumberFormat("en-US", { style: "currency", currency, ...options });
  const dotted = symbol.formatToParts(1).some((part) => part.type === "currency" && part.value.includes("."));
  return dotted ? new Intl.NumberFormat("en-US", { style: "currency", currency, currencyDisplay: "code", ...options }) : symbol;
}
