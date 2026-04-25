const ISO_8601_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;
const CURRENCY_4217 = /^[A-Z]{3}$/;
const UUID_V4 =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;

export function assertFinitePositive(n: unknown, label: string): asserts n is number {
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) {
    throw new Error(`${label}: must be a finite positive number; received ${String(n)}`);
  }
}

export function assertFiniteNonNegative(n: unknown, label: string): asserts n is number {
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) {
    throw new Error(`${label}: must be a finite non-negative number; received ${String(n)}`);
  }
}

export function assertIso8601Utc(s: unknown, label: string): asserts s is string {
  if (typeof s !== "string" || !ISO_8601_UTC.test(s) || !Number.isFinite(Date.parse(s))) {
    throw new Error(`${label}: must be an ISO-8601 timestamp with explicit Z or offset; received ${String(s)}`);
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

export function assertBoolean(b: unknown, label: string): asserts b is boolean {
  if (typeof b !== "boolean") {
    throw new Error(`${label}: must be a boolean; received ${String(b)}`);
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
