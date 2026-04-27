// Local subset of the cross-service validator vocabulary. Kept per-service
// (matching screener / watchlists / resolver) so each service's contract
// surface is self-contained — spec §6 deliberately avoids cross-service
// imports across the package boundary.

const CURRENCY_4217 = /^[A-Z]{3}$/;
const UUID_V4 =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;

export function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label}: must be a non-empty string; received ${String(value)}`);
  }
}

export function assertCurrency(value: unknown, label = "currency"): asserts value is string {
  if (typeof value !== "string" || !CURRENCY_4217.test(value)) {
    throw new Error(`${label}: must be a 3-letter ISO 4217 code; received ${String(value)}`);
  }
}

export function assertUuid(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !UUID_V4.test(value)) {
    throw new Error(`${label}: must be a UUID v4; received ${String(value)}`);
  }
}

export function isUuidV4(value: unknown): value is string {
  return typeof value === "string" && UUID_V4.test(value);
}
