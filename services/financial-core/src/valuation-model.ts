// The valuation model a Call runs on (ADR 0006, #603): per-share free cash
// flow over five years plus a year-5 exit multiple, discounted at the owner's
// required return, plus net cash per share; and the reverse solve for the
// growth a price requires.
//
// The planner cannot name these functions: they are not plan operations, so
// the engine's `forecast` refusal still holds for every factual answer. Only
// the Call (#604) calls them, with inputs its caller has already certified.

import type { DecimalString, IsoDate, ReasonCode } from "./contracts.ts";
import { fixed } from "./value-text.ts";
import { addRationals, compareRationals, divideRationals, multiplyRationals, rationalSign, roundRational, subtractRationals, type ExactRational } from "./rational.ts";
import { isSessionDate } from "./session-calendar.ts";

/** Every reason the model shows no number, with the reason code ADR 0006 names for it, and what the Call says instead. */
export const VALUATION_OUTCOMES = {
  incompatible_currency: { reason_code: "incompatible_currency", text: "The reporting or price currency is not USD; nothing is converted." },
  non_positive_free_cash_flow: { reason_code: "non_positive_base", text: "The model needs positive free cash flow." },
  stale_filing: { reason_code: "stale_input", text: "The latest 10-K period ended more than 15 months before the Call date." },
  shares_missing: { reason_code: "missing_input", text: "No shares outstanding, so there is no value per share." },
  price_missing: { reason_code: "missing_input", text: "No price on or before the Call date." },
  stale_price: { reason_code: "stale_input", text: "No price within 5 trading days of the Call date." },
  required_return_out_of_range: { reason_code: null, text: "The required return must be above 0." },
  exit_multiple_out_of_range: { reason_code: null, text: "The exit multiple must be above 0." },
  share_change_out_of_range: { reason_code: null, text: "The annual share change must be above -100%." },
  growth_out_of_range: { reason_code: null, text: "Annual growth must be above -100%." },
  no_multiple_today: { reason_code: "non_positive_base", text: "Net cash is at least the market cap, so there is no positive multiple today and required growth at today's multiple is not computed." },
  below_domain: { reason_code: null, text: "The price requires free cash flow per share to shrink faster than 50% a year." },
  above_domain: { reason_code: null, text: "The price requires free cash flow per share to grow faster than 100% a year." },
  numeric_limit_exceeded: { reason_code: "numeric_limit_exceeded", text: "The calculation exceeds the exact-arithmetic limits, so no number is shown." },
  no_positive_hurdle_price: { reason_code: null, text: "Base or bear value per share is zero or negative, so there is no positive hurdle price." },
  hurdle_setting_out_of_range: { reason_code: null, text: "A hurdle setting is outside its range: margin of safety at least 1, bear-loss limit above 0 and below 1." },
  no_consensus: { reason_code: null, text: "no consensus within 7 days" },
} as const satisfies Record<string, Readonly<{ reason_code: ReasonCode | null; text: string }>>;

export type ValuationOutcome = keyof typeof VALUATION_OUTCOMES;
export type ValuationOutcomeResult = Readonly<{ kind: "outcome"; outcome: ValuationOutcome; reason_code: ReasonCode | null; text: string }>;
export type ValuationValue = Readonly<{ kind: "value"; value: ExactRational; text: string }>;
export type RequiredGrowth = Readonly<{ kind: "value"; growth: ExactRational; steps: number; text: string }>;

/** A Call's reported inputs and the owner's required return, each already certified upstream (ADR 0006's input table). */
export type ValuationInputs = Readonly<{
  call_date: IsoDate;
  /** The listing's time zone: the Call and price dates are its calendar dates, and its exchange's sessions age the price. */
  listing_timezone: string;
  /** F0: FY free cash flow, USD, from the latest 10-K filed by the Call date. */
  free_cash_flow: ExactRational;
  /** The fiscal year end of F0's 10-K. */
  period_end: IsoDate;
  /** S0: shares outstanding. */
  shares: ExactRational;
  /** N: net cash, USD, from the same 10-K. */
  net_cash: ExactRational;
  /** P: the close on or before the Call date, USD per share. */
  price: ExactRational;
  price_date: IsoDate;
  currency: Readonly<{ reporting: string; price: string }>;
  /** r: the owner's required return, annual. */
  required_return: ExactRational;
}>;

/** One case's assumptions besides growth: base, bear and bull each set their own (ADR 0006). */
export type ValuationAssumptions = Readonly<{
  /** d: annual share change. */
  share_change: ExactRational;
  /** X: the exit multiple of year-5 free cash flow; today's multiple for the checkable row. */
  exit_multiple: ExactRational;
}>;

export type HurdleSettings = Readonly<{ margin_of_safety: ExactRational; bear_loss_limit: ExactRational }>;
export type ConsensusCapture = Readonly<{ captured_on: IsoDate; eps_growth_next_5y: DecimalString | null }>;

const ZERO = ratio(0n);
const ONE = ratio(1n);
const MINUS_ONE = ratio(-1n);
const DOMAIN_LOW = ratio(-1n, 2n);
const DOMAIN_HIGH = ONE;
const BRACKET = ratio(1n, 10_000n);
const MAX_STEPS = 100;
const DAY_MS = 86_400_000;

// Ordered as ADR 0006's outcome table lists them: the first that fails is the one shown.
const INPUT_RULES: ReadonlyArray<readonly [ValuationOutcome, (inputs: ValuationInputs) => boolean]> = [
  ["non_positive_free_cash_flow", (i) => rationalSign(i.free_cash_flow) <= 0],
  ["stale_filing", (i) => i.call_date > monthsAfter(i.period_end, 15)],
  ["shares_missing", (i) => rationalSign(i.shares) <= 0],
  ["price_missing", (i) => i.price_date > i.call_date],
  ["stale_price", (i) => sessionsAfter(i.price_date, i.call_date, i.listing_timezone) > 5],
  ["incompatible_currency", (i) => i.currency.reporting !== "USD" || i.currency.price !== "USD"],
  ["required_return_out_of_range", (i) => rationalSign(i.required_return) <= 0],
];

const ASSUMPTION_RULES: ReadonlyArray<readonly [ValuationOutcome, (assumptions: ValuationAssumptions) => boolean]> = [
  ["exit_multiple_out_of_range", (a) => rationalSign(a.exit_multiple) <= 0],
  ["share_change_out_of_range", (a) => compareRationals(a.share_change, MINUS_ONE) <= 0],
];

/** V(g): value per share at the Call date for annual growth `g`. */
export function valuePerShare(inputs: ValuationInputs, assumptions: ValuationAssumptions, g: ExactRational): ValuationValue | ValuationOutcomeResult {
  const declined = check(inputs, assumptions);
  if (declined !== null) return declined;
  if (compareRationals(g, MINUS_ONE) <= 0) return outcome("growth_out_of_range");
  const value = model(inputs, assumptions, g);
  return value === null ? outcome("numeric_limit_exceeded") : { kind: "value", value, text: fixed(roundRational(value, 2), 2) };
}

/** Today's multiple, (P·S0 − N) / F0. */
export function todaysMultiple(inputs: ValuationInputs): ValuationValue | ValuationOutcomeResult {
  const declined = check(inputs, null);
  if (declined !== null) return declined;
  const enterprise = sub(mul(inputs.price, inputs.shares), inputs.net_cash);
  if (enterprise !== null && rationalSign(enterprise) <= 0) return outcome("no_multiple_today");
  const multiple = div(enterprise, inputs.free_cash_flow);
  return multiple === null ? outcome("numeric_limit_exceeded") : { kind: "value", value: multiple, text: `${fixed(roundRational(multiple, 2), 2)}x` };
}

/**
 * The g in [−50%, +100%] with V(g) = P, by bisection to a bracket under
 * 0.0001. For the row at today's multiple, pass todaysMultiple's value as the
 * exit multiple.
 */
export function requiredGrowth(inputs: ValuationInputs, assumptions: ValuationAssumptions): RequiredGrowth | ValuationOutcomeResult {
  const declined = check(inputs, assumptions);
  if (declined !== null) return declined;
  const lowest = model(inputs, assumptions, DOMAIN_LOW);
  const highest = model(inputs, assumptions, DOMAIN_HIGH);
  if (lowest === null || highest === null) return outcome("numeric_limit_exceeded");
  if (compareRationals(lowest, inputs.price) > 0) return outcome("below_domain");
  if (compareRationals(highest, inputs.price) < 0) return outcome("above_domain");

  // Midpoints stay exact: even after 100 halvings, a midpoint's denominator is 2^101, about 150 digits in its fifth power, against the 4096-digit limit.
  let low = DOMAIN_LOW;
  let high = DOMAIN_HIGH;
  for (let steps = 1; steps <= MAX_STEPS; steps += 1) {
    const middle = half(add(low, high));
    const value = model(inputs, assumptions, middle);
    if (middle === null || value === null) return outcome("numeric_limit_exceeded");
    if (compareRationals(value, inputs.price) <= 0) low = middle;
    else high = middle;
    const width = sub(high, low);
    if (width === null) return outcome("numeric_limit_exceeded");
    if (compareRationals(width, BRACKET) < 0) {
      const growth = half(add(low, high));
      const percent = mul(growth, ratio(100n));
      if (growth === null || percent === null) return outcome("numeric_limit_exceeded");
      return { kind: "value", growth, steps, text: `${fixed(roundRational(percent, 1), 1)}%` };
    }
  }
  return outcome("numeric_limit_exceeded");
}

/** ADR 0005's hurdle price, min(V / margin_of_safety, B / (1 − bear_loss_limit)), for base value V and bear value B. */
export function hurdlePrice(base: ExactRational, bear: ExactRational, settings: HurdleSettings): ValuationValue | ValuationOutcomeResult {
  if (compareRationals(settings.margin_of_safety, ONE) < 0 || rationalSign(settings.bear_loss_limit) <= 0 || compareRationals(settings.bear_loss_limit, ONE) >= 0) {
    return outcome("hurdle_setting_out_of_range");
  }
  if (rationalSign(base) <= 0 || rationalSign(bear) <= 0) return outcome("no_positive_hurdle_price");
  const valueTest = div(base, settings.margin_of_safety);
  const bearTest = div(bear, sub(ONE, settings.bear_loss_limit));
  if (valueTest === null || bearTest === null) return outcome("numeric_limit_exceeded");
  const hurdle = compareRationals(valueTest, bearTest) <= 0 ? valueTest : bearTest;
  return { kind: "value", value: hurdle, text: fixed(roundRational(hurdle, 2), 2) };
}

/** One case's assumption set (ADR 0006): its growth, share change and exit multiple. */
export type ValuationCase = ValuationAssumptions & Readonly<{ growth: ExactRational }>;
export type StanceSettings = HurdleSettings & Readonly<{ near_band: ExactRational }>;

/** ADR 0005's stance wording, by the rule that states it. */
export const STANCE_TEXT = { 4: "Clears your hurdle.", 5: "Near your hurdle.", 6: "Falls short of your hurdle." } as const;

export type StanceMove = Readonly<{ input: "growth" | "share_change" | "required_return" | "exit_multiple"; direction: "up" | "down" }>;
/** The financial tests at one set of inputs: V, B, the hurdle price, and the rule 4 to 6 the price meets. */
export type StanceTests = Readonly<{ rule: 4 | 5 | 6; base: ExactRational; bear: ExactRational; hurdle: ExactRational }>;
/** V or B has no value: an input outcome (ADR 0006's rule 0). */
export type InputOutcome = Readonly<{ kind: "declined"; rule: 0; outcome: ValuationOutcomeResult }>;
export type NoHurdle = Readonly<{ kind: "declined"; rule: 2; base: ExactRational; bear: ExactRational }>;
/** One stability move and the tests at its inputs: null when the move leaves its valid range, so it is untested. A result whose rule differs from the unmoved one flips the stance. */
export type StanceMoveResult = Readonly<{ move: StanceMove; result: StanceTests | InputOutcome | NoHurdle | null }>;

export type StanceResult =
  | InputOutcome
  | NoHurdle
  | Readonly<{ kind: "declined"; rule: 3; tests: StanceTests; moves: ReadonlyArray<StanceMoveResult> }>
  | (StanceTests & Readonly<{ kind: "stated"; text: (typeof STANCE_TEXT)[4 | 5 | 6]; moves: ReadonlyArray<StanceMoveResult> }>);

const POINT = ratio(1n, 100n);

/**
 * ADR 0005's stance rules 2 to 6 for a Call whose deciding inputs are
 * anchored (rule 1 is the caller's): V and B under the base and bear cases,
 * the hurdle price H = min(V / margin_of_safety, B / (1 − bear_loss_limit)),
 * and the stance P ≤ H, P ≤ H·(1 + near_band) or above. Rule 3 moves growth,
 * share change and required return one point and the exit multiple 1x, each
 * up and down and in both cases at once; a stance any move changes is
 * declined. Each move's tests are returned, and a move that leaves its valid
 * range has none: it is untested.
 */
export function callStance(inputs: ValuationInputs, base: ValuationCase, bear: ValuationCase, settings: StanceSettings): StanceResult {
  const first = tests(inputs, base, bear, settings);
  if ("kind" in first) return first;
  const step = (value: ExactRational, by: ExactRational, up: boolean) => (up ? addRationals : subtractRationals)(value, by);
  const moves: ReadonlyArray<readonly [StanceMove, () => Parameters<typeof tests>]> = (["up", "down"] as const).flatMap((direction) => {
    const up = direction === "up";
    const moved = (one: ValuationCase, key: "growth" | "share_change" | "exit_multiple", by: ExactRational) => ({ ...one, [key]: step(one[key], by, up)! });
    return [
      [{ input: "growth", direction }, () => [inputs, moved(base, "growth", POINT), moved(bear, "growth", POINT), settings]],
      [{ input: "share_change", direction }, () => [inputs, moved(base, "share_change", POINT), moved(bear, "share_change", POINT), settings]],
      [{ input: "required_return", direction }, () => [{ ...inputs, required_return: step(inputs.required_return, POINT, up)! }, base, bear, settings]],
      [{ input: "exit_multiple", direction }, () => [inputs, moved(base, "exit_multiple", ONE), moved(bear, "exit_multiple", ONE), settings]],
    ] as const;
  });
  const results = moves.map(([move, argumentsOf]): StanceMoveResult => {
    const [movedInputs, movedBase, movedBear] = argumentsOf();
    // A growth or share change at or below -100%, a required return at or below 0, or an exit multiple at or below 0 leaves its range.
    const outOfRange = [movedBase.growth, movedBear.growth, movedBase.share_change, movedBear.share_change].some((value) => compareRationals(value, MINUS_ONE) <= 0)
      || rationalSign(movedInputs.required_return) <= 0 || rationalSign(movedBase.exit_multiple) <= 0 || rationalSign(movedBear.exit_multiple) <= 0;
    return { move, result: outOfRange ? null : tests(movedInputs, movedBase, movedBear, settings) };
  });
  return results.some(({ result }) => result !== null && result.rule !== first.rule)
    ? { kind: "declined", rule: 3, tests: first, moves: results }
    : { kind: "stated", ...first, text: STANCE_TEXT[first.rule], moves: results };
}

// Rules 2 and 4 to 6 at one set of inputs, or the outcome that leaves V or B without a value.
function tests(inputs: ValuationInputs, base: ValuationCase, bear: ValuationCase, settings: StanceSettings): StanceTests | InputOutcome | NoHurdle {
  const v = valuePerShare(inputs, base, base.growth);
  if (v.kind === "outcome") return { kind: "declined", rule: 0, outcome: v };
  const b = valuePerShare(inputs, bear, bear.growth);
  if (b.kind === "outcome") return { kind: "declined", rule: 0, outcome: b };
  const hurdle = hurdlePrice(v.value, b.value, settings);
  if (hurdle.kind === "outcome") {
    return hurdle.outcome === "no_positive_hurdle_price" ? { kind: "declined", rule: 2, base: v.value, bear: b.value } : { kind: "declined", rule: 0, outcome: hurdle };
  }
  const near = mul(hurdle.value, add(ONE, settings.near_band));
  if (near === null) return { kind: "declined", rule: 0, outcome: outcome("numeric_limit_exceeded") };
  const rule = compareRationals(inputs.price, hurdle.value) <= 0 ? 4 : compareRationals(inputs.price, near) <= 0 ? 5 : 6;
  return { rule, base: v.value, bear: b.value, hurdle: hurdle.value };
}

/** The consensus row shown beside required growth: never a model input. */
export function consensusRow(captures: ReadonlyArray<ConsensusCapture>, callDate: IsoDate): Readonly<{ kind: "value"; capture: ConsensusCapture; text: string }> | ValuationOutcomeResult {
  const newest = captures
    .filter((capture) => capture.eps_growth_next_5y !== null && capture.captured_on <= callDate)
    .reduce<ConsensusCapture | null>((best, capture) => (best === null || capture.captured_on > best.captured_on ? capture : best), null);
  if (newest === null || daysBetween(newest.captured_on, callDate) > 7) return outcome("no_consensus");
  return { kind: "value", capture: newest, text: `attributed consensus: Finviz EPS growth, next 5 years, captured ${newest.captured_on}: ${newest.eps_growth_next_5y}%` };
}

function check(inputs: ValuationInputs, assumptions: ValuationAssumptions | null): ValuationOutcomeResult | null {
  const failed = INPUT_RULES.find(([, fails]) => fails(inputs)) ?? (assumptions === null ? undefined : ASSUMPTION_RULES.find(([, fails]) => fails(assumptions)));
  return failed === undefined ? null : outcome(failed[0]);
}

function outcome(name: ValuationOutcome): ValuationOutcomeResult {
  return { kind: "outcome", outcome: name, ...VALUATION_OUTCOMES[name] };
}

// V(g) = Σ_{t=1..5} (F0/S0)·k^t + X·(F0/S0)·k^5 + N/S0, with k = (1+g) / ((1+d)(1+r)). Null past the numeric limits.
function model(inputs: ValuationInputs, assumptions: ValuationAssumptions, g: ExactRational | null): ExactRational | null {
  const perShare = div(inputs.free_cash_flow, inputs.shares);
  const yearly = div(add(ONE, g), mul(add(ONE, assumptions.share_change), add(ONE, inputs.required_return)));
  let factor: ExactRational | null = ONE;
  let sum: ExactRational | null = ZERO;
  for (let year = 1; year <= 5; year += 1) {
    factor = mul(factor, yearly);
    sum = add(sum, mul(perShare, factor));
  }
  return add(add(sum, mul(mul(assumptions.exit_multiple, perShare), factor)), div(inputs.net_cash, inputs.shares));
}

type Nullable = ExactRational | null;
const lift = (operation: (left: ExactRational, right: ExactRational) => Nullable) => (left: Nullable, right: Nullable): Nullable =>
  left === null || right === null ? null : operation(left, right);
const add = lift(addRationals);
const sub = lift(subtractRationals);
const mul = lift(multiplyRationals);
const div = lift(divideRationals);
const half = (value: Nullable) => div(value, ratio(2n));

function ratio(numerator: bigint, denominator = 1n): ExactRational {
  return divideRationals(integer(numerator), integer(denominator))!;
}

function integer(value: bigint): ExactRational {
  return { numerator: { coefficient: value, scale: 0 }, denominator: { coefficient: 1n, scale: 0 } };
}

// The same day `months` later, clamped to the end of a shorter month.
function monthsAfter(date: IsoDate, months: number): IsoDate {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const index = month - 1 + months;
  const lastDay = new Date(Date.UTC(year, index + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, index, Math.min(day, lastDay))).toISOString().slice(0, 10);
}

/** The sessions of the listing's exchange after `from` and on or before `to`, counted only up to 6. */
export function sessionsAfter(from: IsoDate, to: IsoDate, timeZone: string): number {
  let count = 0;
  for (let day = Date.parse(`${from}T00:00:00Z`) + DAY_MS; day <= Date.parse(`${to}T00:00:00Z`) && count <= 5; day += DAY_MS) {
    if (isSessionDate(new Date(day).toISOString().slice(0, 10), timeZone)) count += 1;
  }
  return count;
}

function daysBetween(from: IsoDate, to: IsoDate): number {
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS;
}
