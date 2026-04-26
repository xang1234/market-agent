const ISO_8601_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const CURRENCY_4217 = /^[A-Z]{3}$/;
const UUID_V4 =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;
const METRIC_KEY = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$/;

export function assertFiniteNumber(n: unknown, label: string): asserts n is number {
  if (typeof n !== "number" || !Number.isFinite(n)) {
    throw new Error(`${label}: must be a finite number; received ${String(n)}`);
  }
}

export function assertFinitePositive(n: unknown, label: string): asserts n is number {
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) {
    throw new Error(`${label}: must be a finite positive number; received ${String(n)}`);
  }
}

export function assertIso8601Utc(s: unknown, label: string): asserts s is string {
  if (typeof s !== "string" || !ISO_8601_UTC.test(s) || !Number.isFinite(Date.parse(s))) {
    throw new Error(`${label}: must be an ISO-8601 timestamp with explicit Z or offset; received ${String(s)}`);
  }
}

export function assertIsoDate(s: unknown, label: string): asserts s is string {
  if (typeof s !== "string" || !ISO_DATE.test(s)) {
    throw new Error(`${label}: must be an ISO-8601 date (YYYY-MM-DD); received ${String(s)}`);
  }
  const m = ISO_DATE.exec(s)!;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  // Round-trip through Date.UTC catches calendar-impossible dates the regex admits (2024-02-30).
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== mo - 1 ||
    dt.getUTCDate() !== d
  ) {
    throw new Error(`${label}: must be a valid calendar date; received ${String(s)}`);
  }
}

export function assertCurrency(s: unknown, label = "currency"): asserts s is string {
  if (typeof s !== "string" || !CURRENCY_4217.test(s)) {
    throw new Error(`${label}: must be a 3-letter ISO 4217 code; received ${String(s)}`);
  }
}

export function assertUuid(s: unknown, label: string): asserts s is string {
  if (typeof s !== "string" || !UUID_V4.test(s)) {
    throw new Error(`${label}: must be a UUID v4; received ${String(s)}`);
  }
}

export function assertOneOf<T extends string>(
  s: unknown,
  values: ReadonlyArray<T>,
  label: string,
): asserts s is T {
  if (typeof s !== "string" || !values.includes(s as T)) {
    throw new Error(`${label}: must be one of ${values.join(", ")}; received ${String(s)}`);
  }
}

export function assertInteger(n: unknown, label: string): asserts n is number {
  if (typeof n !== "number" || !Number.isInteger(n)) {
    throw new Error(`${label}: must be an integer; received ${String(n)}`);
  }
}

export function assertPositiveInteger(n: unknown, label: string): asserts n is number {
  if (typeof n !== "number" || !Number.isInteger(n) || n < 1) {
    throw new Error(`${label}: must be a positive integer; received ${String(n)}`);
  }
}

export function assertNonNegativeInteger(n: unknown, label: string): asserts n is number {
  if (typeof n !== "number" || !Number.isInteger(n) || n < 0) {
    throw new Error(`${label}: must be a non-negative integer; received ${String(n)}`);
  }
}

export function assertMetricKey(s: unknown, label: string): asserts s is string {
  // Dotted lowercase segments, e.g. `revenue.total`, `eps.diluted`.
  if (typeof s !== "string" || !METRIC_KEY.test(s)) {
    throw new Error(`${label}: must be a dotted lowercase metric key; received ${String(s)}`);
  }
}
