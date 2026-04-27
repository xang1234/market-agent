// Local subset of the cross-service validator vocabulary. Keeping a copy
// per service avoids cross-service imports across the package boundary —
// each service's contract surface is self-contained (spec §6).

const ISO_8601_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;
const CURRENCY_4217 = /^[A-Z]{3}$/;
const UUID_V4 =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;

export function assertOneOf<T extends string>(
  s: unknown,
  values: ReadonlyArray<T>,
  label: string,
): asserts s is T {
  if (typeof s !== "string" || !values.includes(s as T)) {
    throw new Error(`${label}: must be one of ${values.join(", ")}; received ${String(s)}`);
  }
}

export function assertFiniteNumber(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label}: must be a finite number; received ${String(value)}`);
  }
}

export function assertNullableFiniteNumber(
  value: unknown,
  label: string,
): asserts value is number | null {
  if (value === null) return;
  assertFiniteNumber(value, label);
}

export function assertFinitePositive(value: unknown, label: string): asserts value is number {
  assertFiniteNumber(value, label);
  if ((value as number) <= 0) {
    throw new Error(`${label}: must be a finite positive number; received ${String(value)}`);
  }
}

export function assertNullableFinitePositive(
  value: unknown,
  label: string,
): asserts value is number | null {
  if (value === null) return;
  assertFinitePositive(value, label);
}

export function assertFiniteNonNegative(
  value: unknown,
  label: string,
): asserts value is number {
  assertFiniteNumber(value, label);
  if ((value as number) < 0) {
    throw new Error(`${label}: must be a finite non-negative number; received ${String(value)}`);
  }
}

export function assertNullableFiniteNonNegative(
  value: unknown,
  label: string,
): asserts value is number | null {
  if (value === null) return;
  assertFiniteNonNegative(value, label);
}

export function assertBoolean(value: unknown, label: string): asserts value is boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${label}: must be a boolean; received ${String(value)}`);
  }
}

export function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label}: must be a non-empty string; received ${String(value)}`);
  }
}

export function assertIso8601Utc(value: unknown, label: string): asserts value is string {
  if (
    typeof value !== "string" ||
    !ISO_8601_UTC.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    throw new Error(
      `${label}: must be an ISO-8601 timestamp with explicit Z or offset; received ${String(value)}`,
    );
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

export function assertInteger(value: unknown, label: string): asserts value is number {
  assertFiniteNumber(value, label);
  if (!Number.isInteger(value)) {
    throw new Error(`${label}: must be an integer; received ${String(value)}`);
  }
}

export function assertIntegerInRange(
  value: unknown,
  label: string,
  min: number,
  max: number,
): asserts value is number {
  assertInteger(value, label);
  if ((value as number) < min || (value as number) > max) {
    throw new Error(`${label}: must be in [${min}, ${max}]; received ${String(value)}`);
  }
}

export function assertNonNegativeInteger(
  value: unknown,
  label: string,
): asserts value is number {
  assertInteger(value, label);
  if ((value as number) < 0) {
    throw new Error(`${label}: must be a non-negative integer; received ${String(value)}`);
  }
}

export function assertPositiveInteger(
  value: unknown,
  label: string,
): asserts value is number {
  assertInteger(value, label);
  if ((value as number) < 1) {
    throw new Error(`${label}: must be a positive integer; received ${String(value)}`);
  }
}

export function assertHasFields(
  raw: Record<string, unknown>,
  fields: ReadonlyArray<string>,
  label: string,
): void {
  for (const field of fields) {
    if (!Object.hasOwn(raw, field)) {
      throw new Error(`${label}.${field}: required field`);
    }
  }
}
