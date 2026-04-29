const ISO_8601_WITH_OFFSET =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;
const UUID_V4 =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;

export function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label}: must be a non-empty string`);
  }
}

export function assertOptionalNonEmptyString(
  value: unknown,
  label: string,
): asserts value is string | null | undefined {
  if (value == null) return;
  assertNonEmptyString(value, label);
}

export function assertIso8601WithOffset(value: unknown, label: string): asserts value is string {
  if (
    typeof value !== "string" ||
    !ISO_8601_WITH_OFFSET.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    throw new Error(`${label}: must be an ISO-8601 timestamp with explicit Z or offset`);
  }
}

export function assertUuidV4(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !UUID_V4.test(value)) {
    throw new Error(`${label}: must be a UUID v4`);
  }
}

export function assertOneOf<T extends string>(
  value: unknown,
  allowed: ReadonlyArray<T>,
  label: string,
): asserts value is T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new Error(`${label}: must be one of ${allowed.join(", ")}`);
  }
}
