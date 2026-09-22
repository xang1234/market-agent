export type DecimalInput = number | string;

/** A local-only canonical decimal. BigInt never crosses a JSON or API boundary. */
export type ExactDecimal = Readonly<{ coefficient: bigint; scale: number }>;

export const MAX_DECIMAL_DIGITS = 100;
export const MAX_DECIMAL_SCALE = 100;
const MAX_PRODUCT_DIGITS = MAX_DECIMAL_DIGITS * 2;
const MAX_PRODUCT_SCALE = MAX_DECIMAL_SCALE * 2;
const DECIMAL_LITERAL = /^([+-]?)(?:(\d+)(?:\.(\d+))?|\.(\d+))$/u;

export function parseExactDecimal(value: unknown): ExactDecimal | null {
  const literal = decimalLiteral(value);
  if (literal === null) return null;
  const match = DECIMAL_LITERAL.exec(literal);
  if (match === null) return null;

  const integer = match[2] ?? "";
  const fraction = match[3] ?? match[4] ?? "";
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

function decimalLiteral(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (Number.isInteger(value) && !Number.isSafeInteger(value)) return null;
  const literal = String(Object.is(value, -0) ? 0 : value);
  return literal.includes("e") || literal.includes("E") ? null : literal;
}

function unsignedDigits(value: bigint): string { return (value < 0n ? -value : value).toString(); }
function powerOfTen(power: number): bigint { return 10n ** BigInt(power); }
function compareBigInts(left: bigint, right: bigint): -1 | 0 | 1 { return left < right ? -1 : left > right ? 1 : 0; }
