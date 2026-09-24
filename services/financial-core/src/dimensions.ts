// Dimensional scope, basis, and unit compatibility. No silent normalization:
// incompatible inputs produce a named reason, and the only conversions are the
// exact, typed dimensionless rescalings below. Currency conversion is outside v1.

import type { BoundFinancialInputV1, FinancialUnit } from "./contracts.ts";
import { parseFinancialDecimal } from "./exact-decimal.ts";
import { multiplyRationals, rationalFromDecimal, type ExactRational } from "./rational.ts";

export type DimensionalScope = BoundFinancialInputV1["dimensions"];
export type FinancialBasis = BoundFinancialInputV1["basis"];
export type DimensionlessUnit = "ratio" | "percent" | "basis_points";

export type MeasurementReason = "incompatible_unit" | "incompatible_currency" | "incompatible_scope" | "incompatible_basis";

/** How two values are measured: unit, dimensional scope, and basis. */
export type Measurement = { unit: FinancialUnit; dimensions: DimensionalScope; basis: FinancialBasis };

/** Null when both are measured identically; otherwise the first specific incompatibility. */
export function measurementIncompatibility(left: Measurement, right: Measurement): MeasurementReason | null {
  return (
    unitIncompatibility(left.unit, right.unit) ??
    (sameDimensions(left.dimensions, right.dimensions) ? null : "incompatible_scope") ??
    (sameBasis(left.basis, right.basis) ? null : "incompatible_basis")
  );
}

export function sameDimensions(left: DimensionalScope, right: DimensionalScope): boolean {
  if (left.scope !== right.scope || left.members.length !== right.members.length) return false;
  const key = (members: DimensionalScope["members"]) =>
    members.map((member) => `${member.axis}\u0000${member.member}`).sort().join("\u0001");
  return key(left.members) === key(right.members);
}

export function sameBasis(left: FinancialBasis, right: FinancialBasis): boolean {
  return left.reporting === right.reporting && left.adjustment === right.adjustment && left.share_basis === right.share_basis;
}

/** Null when identical; otherwise the specific incompatibility. */
export function unitIncompatibility(left: FinancialUnit, right: FinancialUnit): "incompatible_unit" | "incompatible_currency" | null {
  if (left.kind !== right.kind) return "incompatible_unit";
  if ("currency" in left && "currency" in right && left.currency !== right.currency) return "incompatible_currency";
  return null;
}

export function isDimensionless(unit: FinancialUnit): unit is { kind: DimensionlessUnit } {
  return unit.kind === "ratio" || unit.kind === "percent" || unit.kind === "basis_points";
}

// Units per ratio: ratio 1 = percent 100 = basis points 10000.
const UNITS_PER_RATIO: Record<DimensionlessUnit, ExactRational> = {
  ratio: constant("1"),
  percent: constant("100"),
  basis_points: constant("10000"),
};

/**
 * Exact rescaling between dimensionless level units. Percentage points are a
 * difference unit and are deliberately not convertible from a level.
 */
export function convertDimensionless(value: ExactRational, from: DimensionlessUnit, to: DimensionlessUnit): ExactRational {
  const toRatio = multiplyRationals(UNITS_PER_RATIO[to], invert(UNITS_PER_RATIO[from]));
  const converted = toRatio === null ? null : multiplyRationals(value, toRatio);
  if (converted === null) throw new RangeError("numeric_limit_exceeded");
  return converted;
}

function invert(value: ExactRational): ExactRational {
  return { numerator: value.denominator, denominator: value.numerator };
}

function constant(token: string): ExactRational {
  const parsed = parseFinancialDecimal(token);
  const rational = parsed.ok ? rationalFromDecimal(parsed.value) : null;
  if (rational === null) throw new Error(`invalid constant ${token}`);
  return rational;
}
