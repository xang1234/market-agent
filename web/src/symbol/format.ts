// Currency-aware number formatters shared by symbol-detail surfaces.
// USD is the only currency our dev fixtures cover; other currencies render
// as bare numbers. When real multi-currency data lands, swap the prefix
// table for Intl.NumberFormat — keeping the function shape lets call sites
// stay unchanged.

const CURRENCY_PREFIX: Readonly<Record<string, string>> = {
  USD: '$',
}

export function currencyPrefix(currency: string): string {
  return CURRENCY_PREFIX[currency] ?? ''
}

export function formatCurrency2(value: number, currency: string): string {
  // Sign goes outside the currency prefix so negatives render as "-$12.34",
  // not "$-12.34" (the conventional placement; matches what Intl.NumberFormat
  // would produce when we eventually swap to it).
  const sign = value < 0 ? '-' : ''
  return `${sign}${currencyPrefix(currency)}${Math.abs(value).toFixed(2)}`
}

export function formatCompactDollars(value: number): string {
  const abs = Math.abs(value)
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `${(value / 1_000).toFixed(0)}K`
  return value.toFixed(0)
}
