// How a certified value reads: the short text an answer prints and the full
// canonical text behind it. Dependency-free past exact-decimal, so the web
// inspector formats a value exactly as the answer did.

import type { FinancialPlan, FinancialUnit, OperationNode } from "./contracts.ts";
import { canonicalDecimalString, compareExactDecimals, type ExactDecimal } from "./exact-decimal.ts";

/** A value as the answer prints it ("$133.2B", "3.50x") and in full ("USD 133188000000", "3.5x"); `multiple` is readsAsMultiple's answer for the value's node. */
export function formatValue(value: ExactDecimal, unit: FinancialUnit, multiple = false): { text: string; full_text: string } {
  if (multiple && unit.kind === "ratio") return { text: `${fixed(value, 2)}x`, full_text: `${canonicalDecimalString(value)}x` };
  switch (unit.kind) {
    case "currency": {
      const short = compact(value);
      const symbol = unit.currency === "USD" ? "$" : `${unit.currency} `;
      return { text: short === null ? `${unit.currency} ${fixed(value, 2)}` : `${short.sign}${symbol}${short.text}`, full_text: `${unit.currency} ${canonicalDecimalString(value)}` };
    }
    case "currency_per_share":
      return { text: `${unit.currency} ${fixed(value, 2)} per share`, full_text: `${unit.currency} ${canonicalDecimalString(value)} per share` };
    case "ratio": {
      const percent = { coefficient: value.coefficient, scale: value.scale - 2 };
      return { text: `${fixed(percent, 2)}%`, full_text: `${canonicalDecimalString(percent)}%` };
    }
    case "percent":
      return { text: `${fixed(value, 2)}%`, full_text: `${canonicalDecimalString(value)}%` };
    case "percentage_points":
      return { text: `${fixed(value, 2)} pp`, full_text: `${canonicalDecimalString(value)} pp` };
    case "basis_points":
      return { text: `${fixed(value, 0)} bp`, full_text: `${canonicalDecimalString(value)} bp` };
    case "shares": {
      const short = compact(value);
      return { text: `${short === null ? fixed(value, 0) : `${short.sign}${short.text}`} shares`, full_text: `${canonicalDecimalString(value)} shares` };
    }
    case "count":
      return { text: fixed(value, 0), full_text: canonicalDecimalString(value) };
  }
}

// An approved ratio (leverage, cash conversion) and P/E are multiples, and so is a change in one; margins and percent changes are percentages.
export function readsAsMultiple(plan: FinancialPlan, node: OperationNode): boolean {
  return node.operation === "absolute_change"
    ? readsAsMultiple(plan, plan.operations.find((entry) => entry.node_id === node.current)!)
    : node.operation === "ratio" || node.operation === "pe_ratio";
}

const SCALES = [[12, "T"], [9, "B"], [6, "M"]] as const;

/** A magnitude of a million or more at one decimal of its scale ("133.2B"); null below a million. */
function compact(value: ExactDecimal): { sign: string; text: string } | null {
  const magnitude = { coefficient: value.coefficient < 0n ? -value.coefficient : value.coefficient, scale: value.scale };
  const index = SCALES.findIndex(([power]) => compareExactDecimals(magnitude, { coefficient: 10n ** BigInt(power), scale: 0 }) >= 0);
  if (index === -1) return null;
  const [power, suffix] = SCALES[index]!;
  const text = fixed({ coefficient: magnitude.coefficient, scale: magnitude.scale + power }, 1);
  return { sign: value.coefficient < 0n ? "-" : "", text: text === "1,000.0" && index > 0 ? `1.0${SCALES[index - 1]![1]}` : `${text}${suffix}` };
}

/** Half-even rounding to `places` fraction digits, with thousands separators. */
export function fixed(value: ExactDecimal, places: number): string {
  let coefficient: bigint;
  if (value.scale <= places) {
    coefficient = value.coefficient * 10n ** BigInt(places - value.scale);
  } else {
    const divisor = 10n ** BigInt(value.scale - places);
    const negative = value.coefficient < 0n;
    const magnitude = negative ? -value.coefficient : value.coefficient;
    let quotient = magnitude / divisor;
    const twice = 2n * (magnitude % divisor);
    if (twice > divisor || (twice === divisor && quotient % 2n === 1n)) quotient += 1n;
    coefficient = negative ? -quotient : quotient;
  }
  const negative = coefficient < 0n;
  const digits = (negative ? -coefficient : coefficient).toString().padStart(places + 1, "0");
  const whole = digits.slice(0, digits.length - places).replace(/\B(?=(\d{3})+(?!\d))/gu, ",");
  const fraction = places > 0 ? `.${digits.slice(-places)}` : "";
  const text = `${whole}${fraction}`;
  return negative && /[1-9]/u.test(text) ? `-${text}` : text;
}
