const ISO_8601_WITH_OFFSET =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,9})?(Z|([+-])(\d{2}):(\d{2}))$/;
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
  if (typeof value !== "string") {
    throw new Error(`${label}: must be an ISO-8601 timestamp with explicit Z or offset`);
  }

  const match = ISO_8601_WITH_OFFSET.exec(value);
  if (!match || !isValidTimestampMatch(match) || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${label}: must be an ISO-8601 timestamp with explicit Z or offset`);
  }
}

export function assertUuidV4(value: unknown, label: string): asserts value is string {
  if (!isUuidV4(value)) {
    throw new Error(`${label}: must be a UUID v4`);
  }
}

export function isUuidV4(value: unknown): value is string {
  return typeof value === "string" && UUID_V4.test(value);
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

export function assertPositiveInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new Error(`${label}: must be a positive integer; received ${String(value)}`);
  }
}

function isValidTimestampMatch(match: RegExpExecArray): boolean {
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHourText = match[10];
  const offsetMinuteText = match[11];

  if (
    !isValidDate(year, month, day) ||
    !isInRange(hour, 0, 23) ||
    !isInRange(minute, 0, 59) ||
    !isInRange(second, 0, 59)
  ) {
    return false;
  }

  if (offsetHourText === undefined || offsetMinuteText === undefined) {
    return true;
  }

  return (
    isInRange(Number(offsetHourText), 0, 23) &&
    isInRange(Number(offsetMinuteText), 0, 59)
  );
}

function isValidDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !isInRange(month, 1, 12)) {
    return false;
  }

  return isInRange(day, 1, daysInMonth(year, month));
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28;
  }

  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function isInRange(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}
