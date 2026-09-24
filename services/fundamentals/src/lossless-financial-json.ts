// Lossless parsing for external financial JSON. Numbers are kept as their
// exact source tokens (SourceNumber) instead of JavaScript numbers, so a value
// like 9007199254740993 or 0.1000000000000000000001 reaches storage unchanged.
// This must run on the raw response text: a wrapper after response.json()
// would be too late, because precision is lost during that parse.
//
// Limits are checked before allocation: the body size first, then each token
// against the numeric-policy.v1 limits. Conflicting duplicate keys are
// rejected (identical duplicates are not ambiguous and are accepted).

import { parse } from "lossless-json";
import { parseFinancialDecimal } from "../../financial-core/src/exact-decimal.ts";

export const DEFAULT_MAX_FINANCIAL_JSON_BYTES = 64 * 1024 * 1024;

export type FinancialJsonErrorCode = "response_too_large" | "malformed_json" | "duplicate_key" | "numeric_limit_exceeded";

export class FinancialJsonError extends Error {
  readonly code: FinancialJsonErrorCode;
  constructor(code: FinancialJsonErrorCode, message: string) {
    super(message);
    this.name = "FinancialJsonError";
    this.code = code;
  }
}

/** An exact numeric token from a source document. */
export class SourceNumber {
  readonly token: string;
  constructor(token: string) {
    this.token = token;
    Object.freeze(this);
  }
}

export function isSourceNumber(value: unknown): value is SourceNumber {
  return value instanceof SourceNumber;
}

export function parseFinancialJson(text: string, options: { maxBytes?: number } = {}): unknown {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_FINANCIAL_JSON_BYTES;
  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    throw new FinancialJsonError("response_too_large", `financial JSON exceeds ${maxBytes} bytes`);
  }
  try {
    return parse(text, null, (token) => {
      const decimal = parseFinancialDecimal(token);
      if (!decimal.ok) throw new FinancialJsonError("numeric_limit_exceeded", `numeric token exceeds supported limits (${decimal.reason})`);
      return new SourceNumber(token);
    });
  } catch (error) {
    if (error instanceof FinancialJsonError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new FinancialJsonError(/duplicate key/i.test(message) ? "duplicate_key" : "malformed_json", message);
  }
}

/**
 * Converts a validated integral token (or a safe-integer number from a legacy
 * fixture) to a bounded JavaScript integer. Only identifiers, years, and
 * counts go through here — never financial amounts.
 */
export function boundedInteger(value: unknown, label: string, range: { min: number; max: number }): number {
  let integer: number;
  if (isSourceNumber(value)) {
    if (!/^-?(0|[1-9][0-9]{0,15})$/u.test(value.token)) throw new RangeError(`${label}: must be an integer token`);
    integer = Number(value.token);
  } else if (typeof value === "number" && Number.isSafeInteger(value)) {
    integer = value;
  } else {
    throw new RangeError(`${label}: must be an integer`);
  }
  if (!Number.isSafeInteger(integer) || integer < range.min || integer > range.max) {
    throw new RangeError(`${label}: out of range ${range.min}..${range.max}`);
  }
  return integer;
}
