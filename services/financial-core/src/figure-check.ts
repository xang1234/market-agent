// The figure check's core (#781, #800): every numeral a text states, and each one's
// verdict against the values its label points at. Generic over the pointer R: the eval
// points at the golden dataset, and chat is to point at its evidence packet. A labeller
// decides what each numeral is; this module only reads numerals and compares.
//
// ponytail: float arithmetic with a precision tolerance. It judges prose against data and
// publishes no value, so it stays off rational.ts.

import type { PresentedPayload } from "./presentation.ts";

// --- numerals ----------------------------------------------------------------------

export type NumeralId = string & { readonly brand: "NumeralId" };
// amount: a plain number, a currency amount or one with a B/M/K scale; points:
// percentage points; bps: basis points; multiple: 3.2x.
export type NumeralUnit = "amount" | "percent" | "points" | "bps" | "multiple" | "date";
export type Numeral = Readonly<{
  // n1, n2... in the order the text states them.
  id: NumeralId;
  text: string;
  start: number;
  end: number;
  // As written, its own scale applied; negative only when the text gives it a sign.
  value: number;
  // One unit of the last digit shown, scaled like value: the precision the text claims.
  step: number;
  unit: NumeralUnit;
  // The text carries a sign, minus or plus. Parentheses don't sign a number: in prose they
  // hold an aside ("previous close ($176.10)") far more often than an accounting negative.
  signed: boolean;
  // The text carries its own B/M/K scale, so a table's "in millions" doesn't apply.
  scaled: boolean;
  // A hedge right before it ("about", "roughly", "nearly", "~"): it claims no exact value.
  hedged: boolean;
}>;

const NUMBER = String.raw`\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?|\.\d+`;
const SUFFIX = String.raw`\s?(?:%|percent\b|percentage points?\b|pp\b|ppts?\b|points?\b|bps\b|bp\b|basis points\b|trillion\b|billion\b|million\b|thousand\b|tn\b|bn\b|mn\b|mm\b|[tbmk]\b)|(?:x\b|×)`;
const NUMERAL = new RegExp(
  String.raw`(?<date>\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z?)?)`
  + String.raw`|(?<sign>(?<![\w.])[-−+](?=(?:US)?\$?\d|\.\d))?(?:US)?\$?(?<number>${NUMBER})(?<suffix>${SUFFIX})?`,
  "giu",
);
// ponytail: these words only. "Over" and "more than" are bounds, which the trailing-zero
// rule already reads loosely ("over $60B" matches 62.1 billion).
const HEDGE = /(?:\b(?:about|approximately|around|roughly|nearly|almost|close to)\s+|[~≈]\s?)$/iu;
const SCALES: Record<string, number> = { t: 1e12, tn: 1e12, trillion: 1e12, b: 1e9, bn: 1e9, billion: 1e9, m: 1e6, mn: 1e6, mm: 1e6, million: 1e6, k: 1e3, thousand: 1e3 };

function unitOf(suffix: string): { unit: NumeralUnit; scale: number } {
  const word = suffix.trim().toLowerCase();
  if (word === "") return { unit: "amount", scale: 1 };
  if (word === "%" || word === "percent") return { unit: "percent", scale: 1 };
  if (word === "x" || word === "×") return { unit: "multiple", scale: 1 };
  if (word === "bps" || word === "bp" || word === "basis points") return { unit: "bps", scale: 1 };
  if (word in SCALES) return { unit: "amount", scale: SCALES[word]! };
  return { unit: "points", scale: 1 };
}

// The last digit's place. ponytail: a whole number's trailing zeros are read as not
// significant ("$60B", "60%" round to tens), so "$200B" matches 209.9B; a strict reading
// would flag every round number a model writes.
function stepOf(digits: string): number {
  const [whole, fraction] = digits.replaceAll(",", "").split(".");
  if (fraction !== undefined) return 10 ** -fraction.length;
  const significant = whole!.replace(/0+$/u, "");
  return significant === "" ? 1 : 10 ** (whole!.length - significant.length);
}

// Every numeral in the text, in order, with ids n1, n2... An ISO date or timestamp is one
// numeral; digits inside a word (FY2026, Q4, MI308) are numerals too, for the labeller.
export function enumerateNumerals(text: string): Numeral[] {
  return [...text.matchAll(NUMERAL)].map((match, i) => {
    const groups = match.groups!;
    const base = {
      id: `n${i + 1}` as NumeralId,
      text: match[0],
      start: match.index,
      end: match.index + match[0].length,
      hedged: HEDGE.test(text.slice(Math.max(0, match.index - 24), match.index)),
    };
    if (groups.date) return { ...base, value: Number.NaN, step: Number.NaN, unit: "date" as const, signed: false, scaled: false };
    const digits = groups.number!;
    const { unit, scale } = unitOf(groups.suffix ?? "");
    const signed = groups.sign !== undefined;
    const magnitude = Number(digits.replaceAll(",", "")) * scale;
    return { ...base, value: signed && groups.sign !== "+" ? -magnitude : magnitude, step: stepOf(digits) * scale, unit, signed, scaled: scale !== 1 };
  });
}

// The figures a source's text states, in order: its numerals but dates and the digits of a
// name ("MI308", "FY2026", "Q2"), which no answer cites as a figure. A claim's k-th figure
// is entry k - 1, in chat's evidence packet and at the seal (#800).
export const statedFigures = (text: string): Numeral[] =>
  enumerateNumerals(text).filter((numeral) => numeral.unit !== "date" && !/\p{L}$/u.test(text.slice(0, numeral.start)));

// --- labels ------------------------------------------------------------------------

// A value as the data holds it: an amount (dollars, shares), a fraction (a margin, a
// growth rate, a share), points (a change between two fractions, as a fraction: a margin
// up 3.3 points is 0.033, never a percent) or a ratio (a multiple).
export type Quantity = Readonly<{ kind: "amount" | "fraction" | "points" | "ratio"; value: number }>;

// An engine result's value as the figure check reads it, in chat's packet and at the seal.
// A ratio reads as a multiple exactly when the presentation wrote it as one
// (readsAsMultiple, so "3.5x" in full); the plan that decides it can be absent here. A
// percent moves its decimal point ("74.4e-2"), so 74.4% reads as the double nearest 0.744,
// not 74.4 / 100.
export function presentedQuantity(presented: Extract<PresentedPayload, { kind: "value" }>): Quantity {
  const value = Number(presented.value);
  switch (presented.unit.kind) {
    case "ratio":
      return { kind: presented.full_text.endsWith("x") ? "ratio" : "fraction", value };
    case "percent":
      return { kind: "fraction", value: Number(`${presented.value}e-2`) };
    case "percentage_points":
      return { kind: "points", value: Number(`${presented.value}e-2`) };
    case "basis_points":
      return { kind: "fraction", value: Number(`${presented.value}e-4`) };
    case "currency":
    case "currency_per_share":
    case "shares":
    case "count":
      return { kind: "amount", value };
  }
}
export const DERIVATIONS = ["margin", "growth", "difference", "ratio", "share_of_total", "sum"] as const;
export type Derivation = (typeof DERIVATIONS)[number];
// The values in add, less those in subtract, over the sum of those in over when it is
// given. One value is add [it]; a trailing four-quarter total adds four quarters; operating
// expenses are add [gross profit] subtract [operating income]; a margin, as an operand of
// a margin change, has its revenue in over.
export type Operand<R> = Readonly<{ add: ReadonlyArray<R>; subtract: ReadonlyArray<R>; over: ReadonlyArray<R> | null }>;
export type Sign = "+" | "-" | null;
export type Scale = "thousands" | "millions" | "billions" | null;
export type FigureLabel<R> =
  | Readonly<{ basis: "reported"; source: R; sign: Sign; scale: Scale }>
  | Readonly<{ basis: "derived"; derivation: Derivation; operands: ReadonlyArray<Operand<R>>; sign: Sign; scale: Scale }>
  // About a value the data does not hold: another metric, period or company.
  | Readonly<{ basis: "off_file"; what: string }>;
export type ValueOf<R> = (ref: R) => Quantity | undefined;

// --- verdicts ------------------------------------------------------------------------

export type Verdict =
  | Readonly<{ kind: "matched" }>
  | Readonly<{ kind: "derived_ok" }>
  // Within one and a half units of the last digit shown, and either off in that digit or
  // hedged ("about 25%"): linked, never sent back for a rewrite.
  | Readonly<{ kind: "near"; expected: Quantity }>
  | Readonly<{ kind: "wrong"; expected: Quantity }>
  | Readonly<{ kind: "not_checkable"; reason: string }>;

// The numbers a quantity reads as in a unit. A fraction (margin, growth, share) or points
// read as percent, points or basis points (verdictFor refuses points as a percent); a
// ratio as a multiple; an amount only as an amount. A bare table number may be a percent or
// a plain fraction, so it's read both ways.
export function writtenAs({ kind, value }: Quantity, unit: NumeralUnit): number[] {
  if (kind === "amount") return unit === "amount" ? [value] : [];
  if (unit === "percent" || unit === "points") return [value * 100];
  if (unit === "bps") return [value * 10_000];
  if (unit === "multiple") return kind === "ratio" ? [value] : [];
  return [value * 100, value];
}

// The quantity a numeral states, as writtenAs would write it: a percent, points or basis
// points as a fraction, a multiple as a ratio, anything else as an amount. A date states none.
export function statedQuantity({ unit, value }: Numeral): Quantity | undefined {
  switch (unit) {
    case "date":
      return undefined;
    case "percent":
      return { kind: "fraction", value: value / 100 };
    case "points":
      return { kind: "points", value: value / 100 };
    // ponytail: basis points state a level as often as a change (a 150 bps spread), so they
    // stay a fraction; a percent on a claim's bps change then matches.
    case "bps":
      return { kind: "fraction", value: value / 10_000 };
    case "multiple":
      return { kind: "ratio", value };
    case "amount":
      return { kind: "amount", value };
  }
}

// The data's value in the figure's unit. A bare number reads a fraction two ways ("41",
// "0.41"), so this keeps the one nearer the figure's size.
export function writtenLike(numeral: Numeral, expected: Quantity): number | undefined {
  const size = (option: number) => Math.abs(Math.abs(option) - Math.abs(numeral.value));
  return writtenAs(expected, numeral.unit).sort((a, b) => size(a) - size(b))[0];
}

// Equal at the precision shown: within half the last digit's place.
export const withinPrecision = (shown: number, actual: number, step: number) =>
  Math.abs(shown - actual) <= step / 2 + 1e-9 * Math.max(Math.abs(shown), Math.abs(actual), step);

const oneKind = (values: ReadonlyArray<Quantity>) => new Set(values.map((value) => value.kind)).size <= 1;

function operandValue<R>(operand: Operand<R>, valueOf: ValueOf<R>): Quantity | string {
  const read = (refs: ReadonlyArray<R>) => refs.map(valueOf);
  const [add, subtract, over] = [read(operand.add), read(operand.subtract), read(operand.over ?? [])];
  const known = (values: ReadonlyArray<Quantity | undefined>): values is Quantity[] => values.every((value) => value !== undefined);
  if (add.length === 0 || !known(add) || !known(subtract) || !known(over)) return "an operand isn't in the data";
  if (!oneKind([...add, ...subtract]) || !oneKind(over)) return "an operand mixes amounts and ratios";
  const value = add.reduce((sum, term) => sum + term.value, 0) - subtract.reduce((sum, term) => sum + term.value, 0);
  if (operand.over === null) return { kind: add[0]!.kind, value };
  const denominator = over.reduce((sum, term) => sum + term.value, 0);
  return denominator === 0 ? "it divides by zero" : { kind: "fraction", value: value / denominator };
}

// A derived figure recomputed from its operands: two, in their order; any number for a sum;
// one for a margin, share or ratio whose operand already has its denominator in over.
export function derive<R>(label: Extract<FigureLabel<R>, { basis: "derived" }>, valueOf: ValueOf<R>): Quantity | string {
  const { derivation, operands } = label;
  const values = operands.map((operand) => operandValue(operand, valueOf));
  const failed = values.find((value) => typeof value === "string");
  const quantities = values.filter((value): value is Quantity => typeof value !== "string");
  if (derivation === "sum") {
    if (operands.length === 0) return "sum needs an operand";
    if (failed !== undefined) return failed;
    if (!oneKind(quantities)) return "a sum of ratios and amounts";
    return { kind: quantities[0]!.kind, value: quantities.reduce((sum, term) => sum + term.value, 0) };
  }
  const level = derivation === "margin" || derivation === "share_of_total" || derivation === "ratio";
  if (level && operands.length === 1 && operands[0]!.over?.length) {
    return failed ?? { kind: derivation === "ratio" ? "ratio" : "fraction", value: quantities[0]!.value };
  }
  if (operands.length !== 2) return `${derivation} needs two operands, got ${operands.length}`;
  if (failed !== undefined) return failed;
  const [a, b] = quantities as [Quantity, Quantity];
  if (derivation === "difference" && a.kind !== b.kind) return "a difference between a ratio and an amount";
  // A difference between two fractions is a change, in points, unless both are shares of one
  // total: gross margin less operating margin is operating costs' share of revenue.
  const total = (operand: Operand<R>) => operand.over?.reduce((sum, ref) => sum + valueOf(ref)!.value, 0);
  const [over0, over1] = [total(operands[0]!), total(operands[1]!)];
  const share = over0 !== undefined && over1 !== undefined && withinPrecision(over0, over1, 0);
  const result: Quantity = {
    margin: { kind: "fraction", value: a.value / b.value },
    share_of_total: { kind: "fraction", value: a.value / b.value },
    growth: { kind: "fraction", value: (b.value - a.value) / Math.abs(a.value) },
    ratio: { kind: "ratio", value: a.value / b.value },
    difference: { kind: a.kind === "fraction" && !share ? "points" : a.kind, value: a.value - b.value },
  }[derivation] as Quantity;
  return Number.isFinite(result.value) ? result : "it divides by zero";
}

const SCALE_WORDS = { thousands: 1e3, millions: 1e6, billions: 1e9 } as const;
const tableScale = (numeral: Numeral, scale: Scale) => (numeral.unit === "amount" && !numeral.scaled && scale ? SCALE_WORDS[scale] : 1);

// One numeral's verdict. The text's own sign wins; failing that the sign its words give;
// with neither, only the size is compared ("a loss of $134M" against -134M). A difference
// honours only its text's own sign ("+3.3 points"), its operands being [first, the value
// subtracted from it]. Its words' sign is left to the relation check, since "AMD's margin is
// 12.5 points lower" names the operands in either order. A change in points shown as a
// percent is wrong at any value, so its correction names points.
export function verdictFor<R>(numeral: Numeral, label: FigureLabel<R>, valueOf: ValueOf<R>): Verdict {
  if (numeral.unit === "date") return { kind: "not_checkable", reason: "a date labelled as a figure" };
  if (label.basis === "off_file") return { kind: "not_checkable", reason: `${label.what} isn't in the data` };
  const scale = tableScale(numeral, label.scale);
  const step = numeral.step * scale;
  // A margin, share or ratio is a level: "fell to 60.5%" says how it moved, not that it is
  // negative, so only the text's own sign counts. ponytail: an unsigned negative margin
  // ("an operating loss of 1.7% of revenue") is then compared by size.
  const derivation = label.basis === "derived" ? label.derivation : null;
  const sign = derivation === "margin" || derivation === "share_of_total" || derivation === "ratio" ? null : label.sign;
  const shown = numeral.value * scale * (!numeral.signed && sign === "-" ? -1 : 1);
  const bySign = numeral.signed || (sign !== null && derivation !== "difference");
  const fits = (actual: number, places = step) => withinPrecision(bySign ? shown : Math.abs(shown), bySign ? actual : Math.abs(actual), places);
  const judged = (expected: Quantity, what: string, ok: "matched" | "derived_ok"): Verdict => {
    const options = writtenAs(expected, numeral.unit);
    if (options.length === 0) return { kind: "not_checkable", reason: `a ${what} shown as ${numeral.unit}` };
    if (expected.kind === "points" && numeral.unit === "percent") return { kind: "wrong", expected };
    if (!numeral.hedged && options.some((actual) => fits(actual))) return { kind: ok };
    return options.some((actual) => fits(actual, step * 3)) ? { kind: "near", expected } : { kind: "wrong", expected };
  };
  if (label.basis === "reported") {
    const actual = valueOf(label.source);
    return actual === undefined ? { kind: "not_checkable", reason: "its source isn't in the data" } : judged(actual, `reported ${actual.kind}`, "matched");
  }
  const result = derive(label, valueOf);
  return typeof result === "string" ? { kind: "not_checkable", reason: result } : judged(result, label.derivation, "derived_ok");
}

// The data's value as the figure would have written it, for a request to correct it: at
// the figure's precision, with its currency sign, scale and unit ("34%" for an answer's
// "41%", not "34.45%"). An unsigned figure gets the size, since its words carry the sign.
// scale is the label's, for a bare amount in a table "in millions". Points shown as a
// percent are written in points ("3.3 percentage points" for "3.3%").
export function atPrecisionOf(numeral: Numeral, expected: Quantity, scale: Scale = null): string {
  const value = writtenLike(numeral, expected);
  const digits = new RegExp(NUMBER, "u").exec(numeral.text);
  if (value === undefined || numeral.unit === "date" || digits === null) return String(expected.value);
  const step = stepOf(digits[0]);
  const own = 10 ** Math.round(Math.log10(numeral.step / step));
  const rounded = Math.round(Math.abs(value) / (own * tableScale(numeral, scale)) / step) * step;
  const decimals = digits[0].split(".")[1]?.length ?? 0;
  const written = rounded.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: digits[0].includes(",") });
  const minus = /^[-−]/u.test(numeral.text) ? numeral.text[0]! : "-";
  const sign = !numeral.signed || rounded === 0 ? "" : value < 0 ? minus : numeral.text.startsWith("+") ? "+" : "";
  const unit = expected.kind === "points" && numeral.unit === "percent" ? " percentage points" : numeral.text.slice(digits.index + digits[0].length);
  return `${sign}${numeral.text.slice(numeral.signed ? 1 : 0, digits.index)}${written}${unit}`;
}

// --- linked figures ------------------------------------------------------------------

// A figure as a rich_text figure segment links it (#800): its text as the answer wrote it,
// and, when derived, its derivation over its sources by index. Without a derivation it
// reports its one source. Chat links a figure only when this verdict lets it, and the seal
// recomputes it from the values it verifies.
export type LinkedFigure = Readonly<{ text: string; sources: ReadonlyArray<unknown>; derivation?: Derivation; operands?: ReadonlyArray<Operand<number>>; near?: boolean }>;

export function linkedVerdict(figure: LinkedFigure, valueOf: ValueOf<number>): Verdict {
  const numerals = enumerateNumerals(figure.text);
  if (numerals.length !== 1) return { kind: "not_checkable", reason: `its text states ${numerals.length} figures` };
  const { derivation, operands } = figure;
  if (derivation === undefined) {
    if (operands !== undefined) return { kind: "not_checkable", reason: "operands without a derivation" };
    if (figure.sources.length !== 1) return { kind: "not_checkable", reason: `a reported figure has one source, not ${figure.sources.length}` };
    return verdictFor(numerals[0]!, { basis: "reported", source: 0, sign: null, scale: null }, valueOf);
  }
  if (operands === undefined) return { kind: "not_checkable", reason: "a derivation without operands" };
  return verdictFor(numerals[0]!, { basis: "derived", derivation, operands, sign: null, scale: null }, valueOf);
}

// Whether a verdict lets a figure show as verified: equal at its precision, or near
// (a last digit off, or hedged) when the figure says so.
export const linksAs = (figure: Pick<LinkedFigure, "near">, verdict: Verdict) =>
  verdict.kind === "matched" || verdict.kind === "derived_ok" || (verdict.kind === "near" && figure.near === true);
