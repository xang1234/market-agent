// Local subset of the cross-service validator vocabulary. Keeping a copy
// per service avoids cross-service imports across the package boundary —
// each service's contract surface is self-contained (spec §6).

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
