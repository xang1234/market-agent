// Display-only readings of what the inspector receives: values as the answer
// prints them, dates in words, and identifiers shortened. Nothing here changes
// what is copied or certified; the full text stays in each element's title.

import type { FinancialUnit } from '../../../services/financial-core/src/contracts.ts'
import { parseDerivedDecimalText } from '../../../services/financial-core/src/exact-decimal.ts'
import { formatValue } from '../../../services/financial-core/src/value-text.ts'

const UNIT_KINDS: ReadonlySet<string> = new Set(['currency', 'currency_per_share', 'shares', 'ratio', 'percent', 'percentage_points', 'basis_points', 'count'])

function isUnit(unit: unknown): unit is FinancialUnit {
  if (unit === null || typeof unit !== 'object') return false
  const { kind, currency } = unit as { kind?: unknown; currency?: unknown }
  if (typeof kind !== 'string' || !UNIT_KINDS.has(kind)) return false
  return (kind !== 'currency' && kind !== 'currency_per_share') || typeof currency === 'string'
}

/** A canonical decimal as the answer prints it ("$54.2B") and in full ("USD 54229000000"); null when this client cannot read it. `multiple` is the server's reads_as_multiple. */
export function valueText(value: string, unit: unknown, multiple = false): { text: string; full_text: string } | null {
  // Plain decimal text only: an exponent form is not what the server certifies, so it is shown as sent.
  const parsed = /^-?\d+(\.\d+)?$/u.test(value) ? parseDerivedDecimalText(value) : null
  if (!parsed?.ok || !isUnit(unit)) return null
  return formatValue(parsed.value, unit, multiple)
}

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DATE_ONLY = /^(\d{4})-(0[1-9]|1[0-2])-(\d{2})$/u
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/u

export function isTimestamp(text: string): boolean {
  return DATE_ONLY.test(text) || TIMESTAMP.test(text)
}

// A stored midnight UTC is how a date is kept as an instant (sec-facts-repository.ts reported_at), so it reads as that date.
const MIDNIGHT_UTC = /T00:00(:00(\.0+)?)?Z$/u

/**
 * "2026-10-09" reads "Oct 9, 2026"; a timestamp reads "Nov 14, 2026, 09:50" in
 * `timeZone` (the viewer's by default), or with `day` only the day it falls on
 * there. Anything else is returned as given.
 */
export function readableDate(text: string, { timeZone, day = false }: { timeZone?: string; day?: boolean } = {}): string {
  const date = DATE_ONLY.exec(text)
  if (date) return `${MONTHS[Number(date[2]) - 1]} ${Number(date[3])}, ${date[1]}`
  if (!TIMESTAMP.test(text)) return text
  const at = new Date(text)
  if (Number.isNaN(at.getTime())) return text
  const dateOnly = day || MIDNIGHT_UTC.test(text)
  return new Intl.DateTimeFormat('en-US', {
    timeZone: MIDNIGHT_UTC.test(text) ? 'UTC' : timeZone,
    month: 'short', day: 'numeric', year: 'numeric',
    ...(dateOnly ? {} : { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }),
  }).format(at)
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu

/** Whether a value is an identifier, hash, or reference a reader scans rather than reads: one token, long or a UUID. */
export function isIdentifier(text: string): boolean {
  return !/\s/u.test(text) && !isTimestamp(text) && !/^https?:\/\//u.test(text) && !/^[+-]?\d+(\.\d+)?$/u.test(text) && (UUID.test(text) || text.length >= 24)
}

/** A UUID as its first eight characters ("51bb2a4d…"); another long reference keeps its head and tail ("sec_edgar:…2026-09-03"). */
export function shortId(text: string): string {
  if (UUID.test(text)) return `${text.slice(0, 8)}…`
  return text.length > 24 ? `${text.slice(0, 12)}…${text.slice(-8)}` : text
}

/** Server prose with each embedded UUID shortened and each timestamp in words. */
export function readableText(text: string, options: { timeZone?: string } = {}): string {
  return text
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/giu, (id) => shortId(id))
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})( \(UTC\))?/gu, (stamp, _s, _f, _z, utc: string | undefined) =>
      readableDate(utc ? stamp.slice(0, -' (UTC)'.length) : stamp, options))
}

/** A snake_case key in words, first letter capitalised ("gross_profit" reads "Gross profit"). */
export function humanize(key: string): string {
  const words = key.replaceAll('_', ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}
