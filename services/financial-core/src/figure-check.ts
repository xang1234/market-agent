// The figure check's core (#781, #800): every numeral a text states, and each one's
// verdict against the values its label points at. Generic over the pointer R: the eval
// points at the golden dataset, and chat is to point at its evidence packet. A labeller
// decides what each numeral is; this module only reads numerals and compares.
//
// ponytail: float arithmetic with a precision tolerance. It judges prose against data and
// publishes no value, so it stays off rational.ts.

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
}>;

const NUMBER = String.raw`\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?|\.\d+`;
const SUFFIX = String.raw`\s?(?:%|percent\b|percentage points?\b|pp\b|ppts?\b|points?\b|bps\b|bp\b|basis points\b|trillion\b|billion\b|million\b|thousand\b|tn\b|bn\b|mn\b|mm\b|[tbmk]\b)|(?:x\b|×)`;
const NUMERAL = new RegExp(
  String.raw`(?<date>\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z?)?)`
  + String.raw`|(?<sign>(?<![\w.])[-−+](?=(?:US)?\$?\d|\.\d))?(?:US)?\$?(?<number>${NUMBER})(?<suffix>${SUFFIX})?`,
  "giu",
);
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
    const base = { id: `n${i + 1}` as NumeralId, text: match[0], start: match.index, end: match.index + match[0].length };
    if (groups.date) return { ...base, value: Number.NaN, step: Number.NaN, unit: "date" as const, signed: false, scaled: false };
    const digits = groups.number!;
    const { unit, scale } = unitOf(groups.suffix ?? "");
    const signed = groups.sign !== undefined;
    const magnitude = Number(digits.replaceAll(",", "")) * scale;
    return { ...base, value: signed && groups.sign !== "+" ? -magnitude : magnitude, step: stepOf(digits) * scale, unit, signed, scaled: scale !== 1 };
  });
}

// --- labels ------------------------------------------------------------------------

// A value as the data holds it: an amount (dollars, shares), a fraction (a margin, a
// growth rate, a share) or a ratio (a multiple).
export type Quantity = Readonly<{ kind: "amount" | "fraction" | "ratio"; value: number }>;
export const DERIVATIONS = ["margin", "growth", "difference", "ratio", "share_of_total"] as const;
export type Derivation = (typeof DERIVATIONS)[number];
// One value, or one divided by another (a margin, as an operand of a margin change).
export type Operand<R> = Readonly<{ value: R; over: R | null }>;
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
  // lastDigit: within one and a half units of the last digit shown, a rounding slip told
  // apart from a misstatement.
  | Readonly<{ kind: "wrong"; expected: Quantity; lastDigit: boolean }>
  | Readonly<{ kind: "not_checkable"; reason: string }>;

// The numbers a quantity reads as in a unit. A fraction (margin, growth, share, a change
// between margins) reads as percent or points; a ratio as a multiple; an amount only as an
// amount. A bare table number may be a percent or a plain fraction, so it's read both ways.
export function writtenAs({ kind, value }: Quantity, unit: NumeralUnit): number[] {
  if (kind === "amount") return unit === "amount" ? [value] : [];
  if (unit === "percent" || unit === "points") return [value * 100];
  if (unit === "bps") return [value * 10_000];
  if (unit === "multiple") return kind === "ratio" ? [value] : [];
  return [value * 100, value];
}

// Equal at the precision shown: within half the last digit's place.
export const withinPrecision = (shown: number, actual: number, step: number) =>
  Math.abs(shown - actual) <= step / 2 + 1e-9 * Math.max(Math.abs(shown), Math.abs(actual), step);

function operandValue<R>(operand: Operand<R>, valueOf: ValueOf<R>): Quantity | undefined {
  const value = valueOf(operand.value);
  if (value === undefined || operand.over === null) return value;
  const over = valueOf(operand.over);
  return over === undefined || over.value === 0 ? undefined : { kind: "fraction", value: value.value / over.value };
}

// A derived figure recomputed from its two operands, in their order.
export function derive<R>(label: Extract<FigureLabel<R>, { basis: "derived" }>, valueOf: ValueOf<R>): Quantity | string {
  const { derivation, operands } = label;
  if (operands.length !== 2) return `${derivation} needs two operands, got ${operands.length}`;
  const [a, b] = operands.map((operand) => operandValue(operand, valueOf));
  if (!a || !b) return "an operand isn't in the data";
  if (derivation === "difference" && a.kind !== b.kind) return "a difference between a ratio and an amount";
  const result: Quantity = {
    margin: { kind: "fraction", value: a.value / b.value },
    share_of_total: { kind: "fraction", value: a.value / b.value },
    growth: { kind: "fraction", value: (b.value - a.value) / Math.abs(a.value) },
    ratio: { kind: "ratio", value: a.value / b.value },
    difference: { kind: a.kind, value: a.value - b.value },
  }[derivation] as Quantity;
  return Number.isFinite(result.value) ? result : "it divides by zero";
}

const SCALE_WORDS = { thousands: 1e3, millions: 1e6, billions: 1e9 } as const;

// One numeral's verdict. The text's own sign wins; failing that the sign its words give;
// with neither, only the size is compared ("a loss of $134M" against -134M). A difference is
// compared by size: its sign follows the operand order, which is the labeller's guess.
// ponytail: so "margin rose 12.5 points" passes for a fall; check direction when a
// labeller orders differences reliably.
export function verdictFor<R>(numeral: Numeral, label: FigureLabel<R>, valueOf: ValueOf<R>): Verdict {
  if (numeral.unit === "date") return { kind: "not_checkable", reason: "a date labelled as a figure" };
  if (label.basis === "off_file") return { kind: "not_checkable", reason: `${label.what} isn't in the data` };
  const scale = numeral.unit === "amount" && !numeral.scaled && label.scale ? SCALE_WORDS[label.scale] : 1;
  const step = numeral.step * scale;
  // A margin, share or ratio is a level: "fell to 60.5%" says how it moved, not that it is
  // negative, so only the text's own sign counts. ponytail: an unsigned negative margin
  // ("an operating loss of 1.7% of revenue") is then compared by size.
  const derivation = label.basis === "derived" ? label.derivation : null;
  const sign = derivation === "margin" || derivation === "share_of_total" || derivation === "ratio" ? null : label.sign;
  const shown = numeral.value * scale * (!numeral.signed && sign === "-" ? -1 : 1);
  const bySign = (numeral.signed || sign !== null) && derivation !== "difference";
  const fits = (actual: number, places = step) => withinPrecision(bySign ? shown : Math.abs(shown), bySign ? actual : Math.abs(actual), places);
  const judged = (expected: Quantity, what: string, ok: "matched" | "derived_ok"): Verdict => {
    const options = writtenAs(expected, numeral.unit);
    if (options.length === 0) return { kind: "not_checkable", reason: `a ${what} shown as ${numeral.unit}` };
    if (options.some((actual) => fits(actual))) return { kind: ok };
    return { kind: "wrong", expected, lastDigit: options.some((actual) => fits(actual, step * 3)) };
  };
  if (label.basis === "reported") {
    const actual = valueOf(label.source);
    return actual === undefined ? { kind: "not_checkable", reason: "its source isn't in the data" } : judged(actual, `reported ${actual.kind}`, "matched");
  }
  const result = derive(label, valueOf);
  return typeof result === "string" ? { kind: "not_checkable", reason: result } : judged(result, label.derivation, "derived_ok");
}
