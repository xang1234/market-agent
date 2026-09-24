// Exact finite decimals shared by the financial core and legacy
// callers. BigInt stays internal; JSON and APIs carry decimal strings.
//
// Two layers:
//   * Legacy (moved verbatim from services/agents): the strict public
//     threshold-write contract and its bounded multiply/compare. Re-exported
//     unchanged by the services/agents compatibility facade.
//   * Financial (numeric-policy.v1 limits): lossless source-token parsing and
//     canonical rendering. Financial arithmetic is exact rational arithmetic
//     in rational.ts; this layer only converts between text and values.
//
// This module must stay dependency-free: the web build type-checks it through
// the agents facade.

export type DecimalInput = number | string;

/** A local-only canonical decimal. BigInt never crosses a JSON or API boundary. */
export type ExactDecimal = Readonly<{ coefficient: bigint; scale: number }>;

export const MAX_DECIMAL_DIGITS = 100;
export const MAX_DECIMAL_SCALE = 100;
export const EXACT_DECIMAL_STRING_PATTERN = "^-?(?=.{1,101}(?![\\s\\S]))(?:0|[1-9][0-9]{0,99})(?:\\.[0-9]{1,100})?(?![\\s\\S])";
const MAX_PRODUCT_DIGITS = MAX_DECIMAL_DIGITS * 2;
const MAX_PRODUCT_SCALE = MAX_DECIMAL_SCALE * 2;
const DECIMAL_LITERAL = /^(-?)(?=.{1,101}(?![\s\S]))(?:(0|[1-9]\d{0,99})(?:\.(\d{1,100}))?)(?![\s\S])/u;
const LEGACY_DECIMAL_LITERAL = /^([+-]?)(?:(\d+)(?:\.(\d+))?|\.(\d+))$/u;

/** Public thresholds use exact decimal text; JSON numbers are limited to safe integers. */
export function isExactThresholdInput(value: unknown): value is DecimalInput {
  return typeof value === "string"
    ? DECIMAL_LITERAL.test(value)
    : typeof value === "number" && Number.isSafeInteger(value);
}

export function parseExactDecimal(value: unknown): ExactDecimal | null {
  const literal = decimalLiteral(value);
  if (literal === null) return null;
  const match = DECIMAL_LITERAL.exec(literal);
  if (match === null) return null;

  const integer = match[2] ?? "";
  const fraction = match[3] ?? "";
  if (integer.length + fraction.length > MAX_DECIMAL_DIGITS || fraction.length > MAX_DECIMAL_SCALE) return null;
  const digits = `${integer}${fraction}`.replace(/^0+/u, "");
  if (digits.length === 0) return Object.freeze({ coefficient: 0n, scale: 0 });

  const significant = digits.replace(/0+$/u, "");
  const trailingZeros = digits.length - significant.length;
  const coefficient = BigInt(`${match[1] === "-" ? "-" : ""}${significant}`);
  return Object.freeze({ coefficient, scale: fraction.length - trailingZeros });
}

export function multiplyExactDecimals(left: ExactDecimal, right: ExactDecimal): ExactDecimal | null {
  const coefficient = left.coefficient * right.coefficient;
  const scale = left.scale + right.scale;
  if (scale > MAX_PRODUCT_SCALE) return null;
  if (coefficient === 0n) return Object.freeze({ coefficient: 0n, scale: 0 });
  let normalizedCoefficient = coefficient;
  let normalizedScale = scale;
  while (normalizedScale > 0 && normalizedCoefficient % 10n === 0n) {
    normalizedCoefficient /= 10n;
    normalizedScale -= 1;
  }
  if (unsignedDigits(normalizedCoefficient).length > MAX_PRODUCT_DIGITS) return null;
  return Object.freeze({ coefficient: normalizedCoefficient, scale: normalizedScale });
}

export function compareExactDecimals(left: ExactDecimal, right: ExactDecimal): -1 | 0 | 1 {
  if (left.scale === right.scale) return compareBigInts(left.coefficient, right.coefficient);
  if (left.scale > right.scale) return compareBigInts(left.coefficient, right.coefficient * powerOfTen(left.scale - right.scale));
  return compareBigInts(left.coefficient * powerOfTen(right.scale - left.scale), right.coefficient);
}

export function exactDecimalNumericToken(value: ExactDecimal): string {
  return `number:${value.coefficient.toString()}e${-value.scale}`;
}

/**
 * Converts old fractional JSON number payloads to canonical decimal text on
 * durable reads. New public writes must use isExactThresholdInput instead.
 */
export function normalizeLegacyExactThreshold(value: DecimalInput): DecimalInput | null {
  if (isExactThresholdInput(value)) return value;
  if (typeof value === "string") return normalizeLegacyDecimalText(value);
  if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) return null;
  const literal = expandNumberExponent(String(Object.is(value, -0) ? 0 : value));
  return literal === null ? null : normalizeLegacyDecimalText(literal);
}

function decimalLiteral(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (Number.isInteger(value) && !Number.isSafeInteger(value)) return null;
  const literal = String(Object.is(value, -0) ? 0 : value);
  return literal.includes("e") || literal.includes("E") ? null : literal;
}

function expandNumberExponent(literal: string): string | null {
  const match = /^(-?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/u.exec(literal);
  if (match === null) return literal;
  const exponent = Number(match[4]);
  if (!Number.isSafeInteger(exponent)) return null;
  const integer = match[2] ?? "";
  const fraction = match[3] ?? "";
  const digits = `${integer}${fraction}`;
  const point = integer.length + exponent;
  const unsigned = point <= 0
    ? `0.${"0".repeat(-point)}${digits}`
    : point >= digits.length
      ? `${digits}${"0".repeat(point - digits.length)}`
      : `${digits.slice(0, point)}.${digits.slice(point)}`;
  return `${match[1]}${unsigned}`;
}

function normalizeLegacyDecimalText(value: string): string | null {
  const match = LEGACY_DECIMAL_LITERAL.exec(value);
  if (match === null) return null;
  const integer = match[2] ?? "0";
  const fraction = match[3] ?? match[4] ?? "";
  if (integer.length + fraction.length > MAX_DECIMAL_DIGITS || fraction.length > MAX_DECIMAL_SCALE) return null;
  const normalizedInteger = integer.replace(/^0+/u, "") || "0";
  const sign = match[1] === "-" ? "-" : "";
  const normalized = `${sign}${normalizedInteger}${fraction === "" ? "" : `.${fraction}`}`;
  return DECIMAL_LITERAL.test(normalized) ? normalized : null;
}

function unsignedDigits(value: bigint): string { return (value < 0n ? -value : value).toString(); }
function powerOfTen(power: number): bigint { return 10n ** BigInt(power); }
function compareBigInts(left: bigint, right: bigint): -1 | 0 | 1 { return left < right ? -1 : left > right ? 1 : 0; }

// ---------------------------------------------------------------------------
// Financial decimals (numeric-policy.v1 limits)

export const FINANCIAL_DECIMAL_LIMITS = Object.freeze({
  max_source_token_length: 256,
  max_abs_exponent: 1000,
  max_coefficient_digits: 4096,
});

export type FinancialDecimalFailure = "malformed_decimal" | "numeric_limit_exceeded";
export type FinancialDecimalResult = { ok: true; value: ExactDecimal } | { ok: false; reason: FinancialDecimalFailure };

// JSON number grammar only: no leading "+", leading zeros, bare dots, or
// non-ASCII digits. Exponent digits are length-checked before conversion.
const FINANCIAL_TOKEN = /^(-?)(0|[1-9][0-9]*)(?:\.([0-9]+))?(?:[eE]([+-]?)([0-9]+))?$/u;
const MAX_EXPONENT_TOKEN_DIGITS = 5;
const ZERO: ExactDecimal = Object.freeze({ coefficient: 0n, scale: 0 });

/** Parses a source numeric token exactly. Never passes through Number. */
export function parseFinancialDecimal(token: string): FinancialDecimalResult {
  if (typeof token !== "string") return { ok: false, reason: "malformed_decimal" };
  if (token.length > FINANCIAL_DECIMAL_LIMITS.max_source_token_length) return limitExceeded();
  return parseDecimalText(token);
}

/** Renders plain canonical decimal text: no exponent, no trailing fractional zeros, no "-0". */
export function canonicalDecimalString(value: ExactDecimal): string {
  assertFinancialBounds(value);
  if (value.coefficient === 0n) return "0";
  const negative = value.coefficient < 0n;
  const digits = unsignedDigits(value.coefficient);
  let text: string;
  if (value.scale <= 0) {
    text = `${digits}${"0".repeat(-value.scale)}`;
  } else if (digits.length > value.scale) {
    text = `${digits.slice(0, digits.length - value.scale)}.${digits.slice(digits.length - value.scale)}`;
  } else {
    text = `0.${"0".repeat(value.scale - digits.length)}${digits}`;
  }
  if (text.includes(".")) text = text.replace(/0+$/u, "").replace(/\.$/u, "");
  return negative ? `-${text}` : text;
}

/**
 * Parses plain or exponent decimal text under the exponent/coefficient limits
 * without the source-token length limit. For derived values (e.g. rounded
 * quotients) produced inside the core; source tokens use parseFinancialDecimal.
 */
export function parseDerivedDecimalText(text: string): FinancialDecimalResult {
  if (typeof text !== "string") return { ok: false, reason: "malformed_decimal" };
  if (text.length > FINANCIAL_DECIMAL_LIMITS.max_coefficient_digits + FINANCIAL_DECIMAL_LIMITS.max_abs_exponent + 16) {
    return limitExceeded();
  }
  return parseDecimalText(text);
}

export function withinFinancialBounds(value: ExactDecimal): boolean {
  return (
    Number.isSafeInteger(value.scale) &&
    Math.abs(value.scale) <= FINANCIAL_DECIMAL_LIMITS.max_abs_exponent &&
    unsignedDigits(value.coefficient).length <= FINANCIAL_DECIMAL_LIMITS.max_coefficient_digits
  );
}

function parseDecimalText(text: string): FinancialDecimalResult {
  const match = FINANCIAL_TOKEN.exec(text);
  if (match === null) return { ok: false, reason: "malformed_decimal" };
  const [, sign, integer = "", fraction = "", exponentSign, exponentDigits] = match;
  let exponent = 0;
  if (exponentDigits !== undefined) {
    const trimmed = exponentDigits.replace(/^0+/u, "");
    if (trimmed.length > MAX_EXPONENT_TOKEN_DIGITS) return limitExceeded();
    exponent = Number(trimmed || "0") * (exponentSign === "-" ? -1 : 1);
  }
  const digits = `${integer}${fraction}`.replace(/^0+/u, "");
  if (digits.length === 0) return { ok: true, value: ZERO };
  if (digits.length > FINANCIAL_DECIMAL_LIMITS.max_coefficient_digits) return limitExceeded();
  const significant = digits.replace(/0+$/u, "");
  const scale = fraction.length - exponent - (digits.length - significant.length);
  if (Math.abs(scale) > FINANCIAL_DECIMAL_LIMITS.max_abs_exponent) return limitExceeded();
  const coefficient = BigInt(`${sign === "-" ? "-" : ""}${significant}`);
  return { ok: true, value: Object.freeze({ coefficient, scale }) };
}

function assertFinancialBounds(value: ExactDecimal): void {
  if (!withinFinancialBounds(value)) throw new RangeError("numeric_limit_exceeded");
}

function limitExceeded(): FinancialDecimalResult {
  return { ok: false, reason: "numeric_limit_exceeded" };
}
