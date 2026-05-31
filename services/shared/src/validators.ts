const UUID_V4 = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;
const ISO_DATE_TIME_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;
const ISO_4217 = /^[A-Z]{3}$/;

export function assertUuid(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !UUID_V4.test(value)) {
    throw new Error(`${label} must be a UUID v4`);
  }
}

export function assertIsoDateTime(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !ISO_DATE_TIME_WITH_ZONE.test(value) || Number.isNaN(Date.parse(value))) {
    throw new Error(`${label} must be an ISO timestamp with explicit timezone`);
  }
}

export function assertCurrency(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !ISO_4217.test(value)) {
    throw new Error(`${label} must be a 3-letter ISO 4217 code`);
  }
}

export function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string`);
  }
}

export function assertFiniteNumber(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
}

export function assertFinitePositive(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a finite positive number`);
  }
}

export function assertUnitInterval(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${label} must be in [0, 1]`);
  }
}

export function assertOneOf<T extends string>(
  value: unknown,
  choices: ReadonlyArray<T>,
  label: string,
): asserts value is T {
  if (typeof value !== "string" || !choices.includes(value as T)) {
    throw new Error(`${label} must be one of ${choices.join(", ")}`);
  }
}

export function freezeUuidArray(value: unknown, label: string): ReadonlyArray<string> {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return Object.freeze(value.map((item, index) => {
    assertUuid(item, `${label}[${index}]`);
    return item;
  }));
}

export function roundTo(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
