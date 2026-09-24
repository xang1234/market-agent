// Dimensional scope, basis, and unit compatibility. No silent normalization:
// incompatible inputs produce a named reason, and the only conversions are the
// exact, typed dimensionless rescalings below. Currency conversion is outside v1.

import type { BoundFinancialInputV1, FinancialUnit, ReasonCode } from "./contracts.ts";
import { multiplyFinancialDecimals, parseFinancialDecimal, type ExactDecimal } from "./exact-decimal.ts";

export type DimensionalScope = BoundFinancialInputV1["dimensions"];
export type FinancialBasis = BoundFinancialInputV1["basis"];
export type DimensionlessUnit = "ratio" | "percent" | "basis_points";

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
export function unitIncompatibility(left: FinancialUnit, right: FinancialUnit): ReasonCode | null {
  if (left.kind !== right.kind) return "incompatible_unit";
  if ("currency" in left && "currency" in right && left.currency !== right.currency) return "incompatible_currency";
  return null;
}

export function isDimensionless(unit: FinancialUnit): unit is { kind: DimensionlessUnit } {
  return unit.kind === "ratio" || unit.kind === "percent" || unit.kind === "basis_points";
}

// Exact multipliers: ratio 1 = percent 100 = basis points 10000.
const PER_RATIO: Record<DimensionlessUnit, string> = { ratio: "1", percent: "100", basis_points: "10000" };
const PER_UNIT_AS_RATIO: Record<DimensionlessUnit, string> = { ratio: "1", percent: "0.01", basis_points: "0.0001" };

/**
 * Exact rescaling between dimensionless level units. Percentage points are a
 * difference unit and are deliberately not convertible from a level.
 */
export function convertDimensionless(value: ExactDecimal, from: DimensionlessUnit, to: DimensionlessUnit): ExactDecimal {
  const asRatio = multiplyFinancialDecimals(value, constant(PER_UNIT_AS_RATIO[from]));
  if (!asRatio.ok) throw new RangeError(asRatio.reason);
  const converted = multiplyFinancialDecimals(asRatio.value, constant(PER_RATIO[to]));
  if (!converted.ok) throw new RangeError(converted.reason);
  return converted.value;
}

function constant(token: string): ExactDecimal {
  const parsed = parseFinancialDecimal(token);
  if (!parsed.ok) throw new Error(`invalid constant ${token}`);
  return parsed.value;
}
