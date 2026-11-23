// The figures of an earnings release (#733), the low and high of each guide for
// the next quarter, and the quarter's reported actuals, on their stated basis.
// As with its quotes (sec-earnings-release-extraction.ts), the model picks and
// the filing decides. The model copies each figure's phrases from the sentence
// ("$45.0 billion", "plus or minus 2%" as "2%"), and the figure is read from
// those phrases here, never from a number the model wrote. A parse the sentence
// does not bear out goes to the review queue.

import { createHash } from "node:crypto";

import type { IsoDate } from "../../financial-core/src/contracts.ts";
import { plainText, sentenceStarts } from "./canonical-text.ts";
import type { QueryExecutor } from "./types.ts";

// The metric a statement concerns. "other" keeps a real explanation whose
// subject is none of these (a segment, a product line).
export const RELEASE_METRICS = [
  "revenue",
  "gross_margin",
  "operating_expenses",
  "operating_income",
  "net_income",
  "eps",
  "operating_cash_flow",
  "free_cash_flow",
  "capex",
  "other",
] as const;
export type ReleaseMetric = (typeof RELEASE_METRICS)[number];

export const FIGURE_BASES = ["gaap", "non_gaap"] as const;
export type FigureBasis = (typeof FIGURE_BASES)[number];
export type FigureUnit = "usd" | "usd_per_share" | "percent";

// A figure's unit follows from its metric. A margin is a percent, EPS dollars a
// share, the rest dollars.
export function figureUnit(metric: ReleaseMetric): FigureUnit {
  return metric === "gross_margin" ? "percent" : metric === "eps" ? "usd_per_share" : "usd";
}

// A figure as the model gave it, its metric, its basis and the phrases it copied.
export type RawFigure = { metric?: unknown; basis?: unknown; value?: unknown; plus_minus?: unknown; low?: unknown; high?: unknown };
export type FigureRead = { basis: FigureBasis; low: number; high: number } | { review: string };

const UNIT_WORDS: Readonly<Record<FigureUnit, string>> = { usd: "dollars", usd_per_share: "dollars a share", percent: "percent" };

// The words in which a sentence states a negative figure as a positive amount
// ("negative $1.2 billion", "operating loss of $50 million", "cash used in
// operating activities"), per metric. A metric that may be negative takes any
// of them anywhere in its sentence. Revenue, costs and capex are never
// negative, so a negative one is misread, by its sign or by a negative word
// on its amount ("negative $50 million", not "a negative currency impact").
const SIGN_WORD = String.raw`\bnegative\b|(?<!\bplus\W+(?:or\W+)?)\bminus\b`;
const LOSS = String.raw`\bloss(?:es)?\b`;
const OUTFLOW = String.raw`\bused in\b|\boutflows?\b|\bburn\b`;
const negativeIn = (...words: string[]) => new RegExp([SIGN_WORD, ...words].join("|"), "i");
const NEGATIVE_AMOUNT = new RegExp(String.raw`(?:${SIGN_WORD}) \(?\$?\d`, "i");
const NEGATIVE: Readonly<Record<ReleaseMetric, RegExp>> = {
  revenue: NEGATIVE_AMOUNT,
  gross_margin: negativeIn(String.raw`\bgross loss\b`),
  operating_expenses: NEGATIVE_AMOUNT,
  operating_income: negativeIn(LOSS),
  net_income: negativeIn(LOSS),
  eps: negativeIn(LOSS),
  operating_cash_flow: negativeIn(OUTFLOW),
  free_cash_flow: negativeIn(OUTFLOW),
  capex: NEGATIVE_AMOUNT,
  other: NEGATIVE_AMOUNT,
};
const NEVER_NEGATIVE: ReadonlySet<ReleaseMetric> = new Set(["revenue", "operating_expenses", "capex", "other"]);
// EPS is diluted EPS.
const BASIC = /\bbasic\b/i;

// An amount as its plain text states it, with a minus sign or accounting
// parentheses, a dollar sign, a number, and its percent, basis points or scale
// in any case ("Billion", "BN"). It starts and ends outside any word or number,
// so no amount is read inside "72.5%" or "$45.0Bn", nor a minus sign in the
// range "$1.10-$1.20".
const UNIT = String.raw`%|percent\b|basis points?\b|bps\b|trillion\b|billion\b|million\b|thousand\b|tn\b|bn\b|mn\b|[bmk]\b`;
const NUMBER = String.raw`\d+(?:,\d{3})*(?:\.\d+)?(?![.,]?\d)`;
const AMOUNT = new RegExp(
  String.raw`(?<![\w.$%)])(?:(\$\s?)?\((\$\s?)?(${NUMBER})(?:\s?(${UNIT}))?\)(?:\s?(${UNIT}))?|(-)?(\$\s?)?(-)?(${NUMBER})(?:\s?(${UNIT}))?)(?![A-Za-z\d])`,
  "gi",
);
const SCALES: Readonly<Record<string, number>> = { trillion: 1e12, tn: 1e12, billion: 1e9, bn: 1e9, b: 1e9, million: 1e6, mn: 1e6, m: 1e6, thousand: 1e3, k: 1e3 };
type Amount = { start: number; end: number; n: number; dollars: boolean; mark: "%" | "bp" | null; scale: number | null };

function amountsIn(quote: string): Amount[] {
  return [...quote.matchAll(AMOUNT)].map((found) => {
    const [whole, outerDollar, innerDollar, parenthesized, innerUnit, outerUnit, minus, dollar, innerMinus, digits, unit] = found;
    const negative = parenthesized !== undefined || minus !== undefined || innerMinus !== undefined;
    const word = ((parenthesized === undefined ? unit : innerUnit ?? outerUnit) ?? "").toLowerCase();
    const n = Number((parenthesized ?? digits)!.replaceAll(",", ""));
    return {
      start: found.index,
      end: found.index + whole.length,
      n: negative ? -n : n,
      dollars: (outerDollar ?? innerDollar ?? dollar) !== undefined,
      mark: word === "%" || word === "percent" ? "%" : word.startsWith("basis") || word === "bps" ? "bp" : null,
      scale: SCALES[word] ?? null,
    };
  });
}

// The amount a phrase the model copied states, the one amount it holds whole,
// where its sentence has it once and no other amount runs into it. Or why it is
// no figure of the sentence.
function amountOf(quote: string, amounts: ReadonlyArray<Amount>, phrase: string): Amount | string {
  const start = quote.indexOf(phrase);
  if (start < 0) return `"${phrase}" is not in its sentence`;
  if (quote.indexOf(phrase, start + 1) >= 0) return `"${phrase}" is in its sentence more than once`;
  const end = start + phrase.length;
  const midWord = (at: number) => /[A-Za-z\d]/.test(quote[at - 1] ?? "") && /[A-Za-z\d]/.test(quote[at] ?? "");
  const touching = amounts.filter((amount) => amount.start < end && amount.end > start);
  const held = touching.filter((amount) => amount.start >= start && amount.end <= end);
  return midWord(start) || midWord(end) || touching.length !== 1 || held.length !== 1 ? `"${phrase}" is not one whole figure of its sentence` : held[0]!;
}

// Whether an amount is in a metric's unit. A margin is a percent, EPS dollars
// with no scale, the rest dollars.
function fits(amount: Amount, unit: FigureUnit): boolean {
  return unit === "percent"
    ? amount.mark === "%" && !amount.dollars && amount.scale === null
    : amount.dollars && amount.mark === null && (unit === "usd" || amount.scale === null);
}

// Measures that are neither plain GAAP nor plain non-GAAP ("constant currency
// revenue", "core EPS", "gross margin excl. H20"). A qualifier only sends a
// figure to review, and never settles a basis, whatever basis markers the
// sentence also has ("on a non-GAAP constant currency basis"). The words of an
// entry may be joined by a space, a hyphen or nothing ("pro forma",
// "pro-forma", "proforma").
const qualifierPattern = (entries: ReadonlyArray<string>, ...more: string[]) => new RegExp(
  [
    ...entries.map((entry) => String.raw`\b${entry.split(" ").map((word) => word.replace(".", String.raw`\.`)).join("[- ]?")}${entry.endsWith(".") ? "" : String.raw`\b`}`),
    ...more,
  ].join("|"),
  "gi",
);
// A measure with something taken out or put in, in any spelling ("excl.",
// "excl", "exc.", "ex.", "w/o", "ex-China", "ex SBC", not "ex-dividend"),
// qualifies every figure of its sentence.
const ADJUSTED = qualifierPattern(
  ["pro forma", "as adjusted", "adjusted for", "excluding", "excludes", "excluded", "exclusive of", "excl", "exc.", "ex.", "w/o"],
  String.raw`\bex[- ](?!dividends?\b)(?=[a-z])`,
);
// A measure restated another way. In a parenthesis that states a figure it
// qualifies only that parenthesis's figures ("$65.6 billion (up 16% in constant
// currency)"). Constant currency otherwise qualifies its whole sentence, and
// the others only the clause they name a measure in ("core EPS", "comparable
// store sales", "on an organic basis"), never ordinary prose ("core business",
// "the comparable period", "underlying demand", "Intel Core processors").
const RESTATED = qualifierPattern(["constant currency", "core", "underlying", "organic", "comparable", "normalized", "like for like"]);
const NAMES_MEASURE = /^(?:\W+\w+){0,2}?\W+(?:revenues?|sales|eps|earnings|income|profits?|margins?|ebitda|ebit|a?ffo|funds|cash|expenses|opex|costs?|loss(?:es)?|results|net|operating|diluted|gross|per|gaap|non|basis|figures|measures)\b/i;

// The qualifier in its sentence that qualifies the amount `at`, if any.
function qualifierOf(quote: string, amounts: ReadonlyArray<Amount>, at: Amount): string | null {
  const sentence = sentenceAt(quote, at.start);
  const adjusted = sentence.text.match(ADJUSTED);
  if (adjusted !== null) return adjusted[0];
  const { clauses, parens } = layout(quote, sentence.start, sentence.start + sentence.text.length, amounts);
  const clause = clauses.find((part) => part.start <= at.start && at.end <= part.end)!;
  for (const found of sentence.text.matchAll(RESTATED)) {
    const start = sentence.start + found.index;
    const paren = parens.find((span) => span.start < start && start < span.end);
    const inParen = (amount: Amount) => paren !== undefined && paren.start < amount.start && amount.end <= paren.end;
    if (paren !== undefined && amounts.some((amount) => isFigure(amount) && inParen(amount))) {
      if (inParen(at)) return found[0];
    } else if (/^constant/i.test(found[0])) return found[0];
    else if (NAMES_MEASURE.test(sentence.text.slice(found.index + found[0].length)) && clause.start <= start && start < clause.end) return found[0];
  }
  return null;
}

// A figure's basis is read from its own clause, and a phrasing these rules do
// not place goes to review. A sentence names a basis with a marker, which
// names one of:
// - GAAP, non-GAAP or adjusted, a label for the figures that follow it;
// - "on a … basis", for its whole clause when it opens the clause ("On a
//   non-GAAP (*) basis, gross margin was 56%, operating income was $3.9
//   billion"), else for the figures just before it, or with none, just after,
//   or naming neither basis or both, a basis no figure here is compared on.
const MARKER = /\bon an? ((?:[^\s,;.]+ ){0,4}?)basis\b(?! points?\b)|\bnon-? ?gaap\b|\bgaap\b|\badjusted\b/gi;
type Marker = { start: number; end: number; basis: FigureBasis | "other"; reach: "after" | "before" };

function markerAt(found: RegExpMatchArray, offset: number): Marker {
  const [word, inner] = found;
  const span = { start: offset + found.index!, end: offset + found.index! + word.length };
  if (inner !== undefined) {
    const nonGaap = /non-? ?gaap|\badjusted/i.test(inner);
    const gaap = /\bgaap\b|\bunadjusted\b/i.test(inner.replace(/non-? ?gaap/gi, ""));
    return { ...span, basis: nonGaap === gaap ? "other" : nonGaap ? "non_gaap" : "gaap", reach: "before" };
  }
  return { ...span, basis: /^gaap$/i.test(word) ? "gaap" : "non_gaap", reach: "after" };
}

// "GAAP and non-GAAP gross margins", a subject both bases share.
const SHARED = /\b(?:non-? ?gaap|gaap) and (?:non-? ?gaap|gaap)\b/i;
// A comma that starts a clause of its own.
const CONJUNCTION = /^ (?:and|while|but|compared)\b/i;
const OPENING_BASIS = /^\W*on an? (?:[^\s,;.]+ ){0,4}?basis,/i;
// A word that starts another clause with no comma before it ("$1.5 billion
// while on a non-GAAP basis ...").
const CLAUSE_WORD = /\b(?:and|while|but|whereas|compared|versus|vs\.)(?!\w)/i;
// What joins the amounts one noun phrase states: "$3.9 billion and $3.5
// billion", "$1.10-$1.20", "$4.0 to $4.1 billion". Not a bare comma or space,
// which a list of other subjects or a flattened table has.
const JOINED = /^ ?(?:and|or|to|-) ?$/i;

// The sentence of the quote an offset is in, and where it starts.
function sentenceAt(quote: string, at: number): { start: number; text: string } {
  const starts = sentenceStarts(quote);
  const start = starts.filter((begin) => begin <= at).at(-1) ?? 0;
  return { start, text: quote.slice(start, starts.find((begin) => begin > at) ?? quote.length) };
}

// An amount that is a figure, not a bare number such as a year or a date.
const isFigure = (amount: Amount) => amount.dollars || amount.mark !== null || amount.scale !== null;

// A sentence's clauses, split at a semicolon and at a comma before "and",
// "while", "but" or "compared", its amounts inside a parenthesis (an aside),
// where each parenthesis opens, and its other commas. An amount's own
// accounting parentheses are no aside.
function layout(quote: string, start: number, end: number, amounts: ReadonlyArray<Amount>) {
  const clauses: Array<{ start: number; end: number }> = [];
  const asides = new Set<Amount>();
  const parens: Array<{ start: number; end: number }> = [];
  const commas: number[] = [];
  const inside = amounts.filter((amount) => amount.start >= start && amount.end <= end);
  let depth = 0;
  let from = start;
  // The serial comma before the last item of a list an opening "on a … basis"
  // heads ("On a non-GAAP basis, gross margin was 54%, operating income was
  // $1.7 billion, and diluted EPS was $1.09"), which is no clause of its own.
  // With one item before it, the "and" may start one.
  const serial = (at: number) =>
    /^ and\b/i.test(quote.slice(at + 1, end)) && OPENING_BASIS.test(quote.slice(from, at)) && commas.filter((comma) => comma >= from).length >= 2;
  for (let i = start, next = 0; i < end; i += 1) {
    const amount = inside[next];
    if (amount?.start === i) {
      if (depth > 0) asides.add(amount);
      i = amount.end - 1;
      next += 1;
      continue;
    }
    const char = quote[i];
    if (char === "(") {
      if (depth === 0) parens.push({ start: i, end });
      depth += 1;
    } else if (char === ")" && depth > 0) {
      depth -= 1;
      if (depth === 0) parens.at(-1)!.end = i + 1;
    } else if (depth === 0 && (char === ";" || (char === "," && CONJUNCTION.test(quote.slice(i + 1, end)) && !serial(i)))) {
      clauses.push({ start: from, end: i });
      from = i + 1;
    } else if (depth === 0 && char === ",") commas.push(i);
  }
  clauses.push({ start: from, end });
  return { clauses, asides, parens, commas };
}

// Figures in order, grouped where JOINED links one to the next.
function runsOf(quote: string, figures: ReadonlyArray<Amount>): Amount[][] {
  const runs: Amount[][] = [];
  for (const figure of figures) {
    const last = runs.at(-1);
    if (last !== undefined && JOINED.test(quote.slice(last.at(-1)!.end, figure.start))) last.push(figure);
    else runs.push([figure]);
  }
  return runs;
}

// The bases the sentence states the amount `at` on, given the amounts the
// figure reads. A sentence with no marker states its figures on the basis
// `unmarked`. Otherwise the figure's own clause decides, and an aside, a
// clause with no marker, one naming another basis or one with a marker in a
// parenthesis, settles none. A
// clause naming one basis states it for the figures a marker reaches, with no
// comma between: a label the run of figures right after it, "on a … basis"
// every run when it opens the clause, else the run right before it with no
// conjunction between, or with no run before, the run right after. One naming
// both settles a basis only for the subject they share and nothing else
// (pairedBases).
function basesOf(quote: string, amounts: ReadonlyArray<Amount>, at: Amount, read: ReadonlyArray<Amount>, unmarked: FigureBasis): ReadonlyArray<FigureBasis> {
  const sentence = sentenceAt(quote, at.start);
  const end = sentence.start + sentence.text.length;
  const markers = [...sentence.text.matchAll(MARKER)].map((found) => markerAt(found, sentence.start));
  if (markers.length === 0) return [unmarked];
  const { clauses, asides, parens, commas } = layout(quote, sentence.start, end, amounts);
  if (asides.has(at)) return [];
  const clause = clauses.find((part) => part.start <= at.start && at.end <= part.end)!;
  const within = (span: { start: number; end: number }) => span.start >= clause.start && span.end <= clause.end;
  const own = markers.filter(within);
  const bases = new Set(own.map((marker) => marker.basis));
  const parenthesized = own.some((marker) => parens.some((paren) => paren.start < marker.start && marker.start < paren.end));
  if (own.length === 0 || bases.has("other") || parenthesized) return [];
  const figures = amounts.filter((amount) => within(amount) && isFigure(amount));
  if (bases.size === 2) return pairedBases(quote, clause, own, figures, at, read);
  const runs = runsOf(quote, figures.filter((figure) => !asides.has(figure)));
  const run = runs.find((group) => group.includes(at))!;
  const noComma = (from: number, to: number) => !commas.some((comma) => comma >= from && comma < to);
  const reaches = (marker: Marker) => {
    if (marker.reach === "after") return runs.find((group) => group[0]!.start >= marker.end) === run && noComma(marker.end, run[0]!.start);
    if (/^\W*$/.test(quote.slice(clause.start, marker.start))) return true;
    const before = runs.filter((group) => group.at(-1)!.end <= marker.start).at(-1);
    if (before === undefined) return runs.find((group) => group[0]!.start >= marker.end) === run && noComma(marker.end, run[0]!.start);
    return before === run && noComma(run.at(-1)!.end, marker.start) && !CLAUSE_WORD.test(quote.slice(run.at(-1)!.end, marker.start));
  };
  return own.some(reaches) ? [own[0]!.basis as FigureBasis] : [];
}

// A clause whose only markers are a subject both bases share ("GAAP and
// non-GAAP gross margins") states its figures after the subject: in order with
// "respectively" when there are two, or as one figure for both when the figure
// reads every amount after it ("were both 75.0%", "74.0%, plus or minus 50
// basis points").
function pairedBases(
  quote: string,
  clause: { start: number; end: number },
  own: ReadonlyArray<Marker>,
  figures: ReadonlyArray<Amount>,
  at: Amount,
  read: ReadonlyArray<Amount>,
): ReadonlyArray<FigureBasis> {
  const text = quote.slice(clause.start, clause.end);
  const shared = SHARED.exec(text);
  if (shared === null) return [];
  const [subject, from] = [clause.start + shared.index, clause.start + shared.index + shared[0].length];
  if (own.length !== 2 || own.some((marker) => marker.start < subject || marker.end > from)) return [];
  const after = figures.filter((figure) => figure.start >= from);
  const respectively = text.slice(from - clause.start).search(/\brespectively\b/i);
  if (respectively < 0) return after.includes(at) && after.every((figure) => read.includes(figure)) ? ["gaap", "non_gaap"] : [];
  const listed = after.filter((figure) => figure.end <= from + respectively);
  const index = listed.indexOf(at);
  return listed.length === 2 && index >= 0 ? [own[index]!.basis as FigureBasis] : [];
}

// Twelve significant digits, so arithmetic on a parsed figure ("$45.0 billion"
// less 2%) lands on the figure as written.
const exact = (n: number) => Number(n.toPrecision(12));

// The figure the sentence states, or why it goes to review. That is a negative
// figure stated in words, basic EPS, a phrase not in the sentence or not one
// whole amount of it, an amount not in the metric's unit, a negative revenue,
// cost or capex, a basis the sentence does not state for that amount, a plus or
// minus it does not state on the value, a percent plus or minus on a margin
// (points or a share of it?), or a low above its high.
// A result is one value; a guide is a value, with or without plus_minus, or a
// low and a high.
export function readFigure(
  statement: { kind: "guidance" | "result"; metric: ReleaseMetric; quote: string },
  raw: RawFigure,
): FigureRead {
  const { kind, metric } = statement;
  const quote = plainText(statement.quote);
  if (!(FIGURE_BASES as ReadonlyArray<unknown>).includes(raw.basis)) return { review: `basis ${JSON.stringify(raw.basis ?? null)} is neither gaap nor non_gaap` };
  // Free cash flow is non-GAAP by definition, so the model's tag never decides it.
  const freeCashFlow = metric === "free_cash_flow";
  const unmarked: FigureBasis = freeCashFlow ? "non_gaap" : "gaap";
  const basis: FigureBasis = freeCashFlow ? "non_gaap" : (raw.basis as FigureBasis);
  const negative = NEGATIVE[metric];
  if (negative.test(quote)) return { review: "its sentence states a negative figure in words, which would read as a positive one" };
  if (metric === "eps" && BASIC.test(quote)) return { review: "EPS is read as diluted, and its sentence names basic EPS" };
  const phrase = (value: unknown) => (typeof value === "string" && plainText(value) !== "" ? plainText(value) : null);
  const [value, plusMinus, low, high] = [raw.value, raw.plus_minus, raw.low, raw.high].map(phrase);
  const shaped = kind === "result"
    ? value !== null && plusMinus === null && low === null && high === null
    : value !== null ? low === null && high === null : plusMinus === null && low !== null && high !== null;
  if (!shaped) return { review: kind === "result" ? "a result is one value" : "a guide is a value, with or without plus_minus, or a low and a high" };
  const amounts = amountsIn(quote);
  const found = new Map<string, Amount>();
  for (const given of [value, plusMinus, low, high]) {
    if (given === null) continue;
    const amount = amountOf(quote, amounts, given);
    if (typeof amount === "string") return { review: amount };
    found.set(given, amount);
  }
  // A low with no unit of its own takes its high's ("71.0 to 72.0%").
  if (low !== null && high !== null) {
    const [from, to] = [found.get(low)!, found.get(high)!];
    if (!isFigure(from) && statedAsRange(quote, from, to)) found.set(low, { ...from, dollars: to.dollars, mark: to.mark, scale: to.scale });
  }
  const unit = figureUnit(metric);
  const levels = [value, low, high].filter((given): given is string => given !== null);
  const unfit = levels.find((given) => !fits(found.get(given)!, unit));
  if (unfit !== undefined) return { review: `"${unfit}" is not a figure in ${UNIT_WORDS[unit]}` };
  if (NEVER_NEGATIVE.has(metric) && levels.some((given) => found.get(given)!.n < 0)) return { review: `a negative ${metric.replaceAll("_", " ")} is misread` };
  const qualified = levels.map((given) => qualifierOf(quote, amounts, found.get(given)!)).find((match) => match !== null);
  if (qualified) return { review: `its sentence qualifies the measure ("${qualified}"), which settles neither basis` };
  const misread = levels.find((given) => !basesOf(quote, amounts, found.get(given)!, [...found.values()], unmarked).includes(basis));
  if (misread !== undefined) return { review: `its sentence does not state "${misread}" as a ${basis === "gaap" ? "GAAP" : "non-GAAP"} figure` };
  const level = (given: string, scale: number | null = null) => {
    const amount = found.get(given)!;
    return amount.n * (amount.scale ?? scale ?? 1);
  };
  let from: number;
  let to: number;
  if (value !== null) {
    const point = found.get(value)!;
    const ends = amounts.filter((other) => !isFigure(other) || (other.dollars === point.dollars && other.mark === point.mark));
    if (kind === "guidance" && ends.some((other) => statedAsRange(quote, other, point) || statedAsRange(quote, point, other))) {
      return { review: `"${value}" is one end of a range its sentence states` };
    }
    const center = level(value);
    if (plusMinus !== null && !statedAsTolerance(quote, amounts, point, found.get(plusMinus)!)) {
      return { review: `its sentence does not state "${plusMinus}" as a plus or minus on "${value}"` };
    }
    const spread = plusMinus === null ? 0 : tolerance(found.get(plusMinus)!, unit, point, center);
    if (typeof spread === "string") return { review: spread };
    [from, to] = [center - spread, center + spread];
  } else {
    if (!statedAsRange(quote, found.get(low!)!, found.get(high!)!)) return { review: `its sentence does not state "${low}" and "${high}" as a range` };
    // A low with no scale of its own takes its high's ("$4.0 to $4.1 billion").
    [from, to] = [level(low!, found.get(high!)!.scale), level(high!)];
  }
  if (from > to) return { review: "its low is above its high" };
  return { basis, low: exact(from), high: exact(to) };
}

// Whether a low and a high are one range: "$4.0 to $4.1 billion",
// "$1.10-$1.20", "between 71.0% and 72.0%". Two amounts joined by "and" alone
// ("are expected to be 71.0% and 72.0%") may be two figures.
function statedAsRange(quote: string, low: Amount, high: Amount): boolean {
  const between = quote.slice(low.end, high.start);
  return low.end <= high.start &&
    (/^ ?(?:to|-) ?$/i.test(between) || (/^ and $/i.test(between) && /\bbetween (?:\w+ )?$/i.test(quote.slice(0, low.start))));
}

// Whether a plus or minus is stated on the amount `of`: right after it, or
// after the run it is listed in ("71.8% and 72.0%, respectively, plus or minus
// 50 basis points"). "$45 billion, up 2% year over year" states a growth rate.
const TOLERANCE = /^,? ?(?:respectively, )?(?:plus or minus|plus\/minus|\+\/-|±) ?$/i;
function statedAsTolerance(quote: string, amounts: ReadonlyArray<Amount>, of: Amount, spread: Amount): boolean {
  let last = of;
  for (const next of amounts.filter((amount) => isFigure(amount) && amount.start >= of.end && amount.end <= spread.start)) {
    if (!JOINED.test(quote.slice(last.end, next.start))) return false;
    last = next;
  }
  return TOLERANCE.test(quote.slice(last.end, spread.start));
}

// How far either side of `center` (the amount `of`) a plus_minus reaches, or
// why it is unread.
function tolerance(amount: Amount, unit: FigureUnit, of: Amount, center: number): number | string {
  if (amount.n < 0) return "a plus or minus is never negative";
  if (amount.dollars && amount.scale === null && of.scale !== null) return "the plus or minus has no scale, though its figure has one";
  if (unit === "percent") {
    return amount.mark === "bp" ? amount.n / 100 : "a plus or minus on a margin is read only in basis points, as a percent could be points or a share of it";
  }
  if (amount.mark === "%") return (Math.abs(center) * amount.n) / 100;
  if (fits(amount, unit)) return amount.n * (amount.scale ?? 1);
  return `the plus or minus is not a figure in ${UNIT_WORDS[unit]} or a percent of one`;
}

// A figure the extraction read from a verified sentence, with the guidance
// claim it binds (null for an actual).
export type ReadReleaseFigure = {
  kind: "guidance" | "result";
  metric: ReleaseMetric;
  quote: string;
  claimId: string | null;
  raw: RawFigure;
  read: FigureRead;
};

// A figure for review is never one to approve in bulk. Its confidence is far
// below the threshold, so the queue shows it as high severity.
const REVIEW_CONFIDENCE = 0.5;
const REVIEW_THRESHOLD = 0.8;

// The release's quarter and its figures, in the extraction's transaction,
// which holds the document row's lock. A figure already stored is kept, and
// one sent to review is queued once, with the model's phrases for the reviewer
// to read against the sentence.
export async function storeReleaseFigures(
  db: QueryExecutor,
  release: { documentId: string; issuerId: string; sourceId: string; quarterEnd: IsoDate; filedOn: IsoDate },
  figures: ReadonlyArray<ReadReleaseFigure>,
): Promise<{ stored: number; queued: number }> {
  await db.query(
    `insert into earnings_release_quarters (document_id, issuer_id, quarter_end, filed_on)
     values ($1, $2, $3::date, $4::date) on conflict (document_id) do nothing`,
    [release.documentId, release.issuerId, release.quarterEnd, release.filedOn],
  );
  let stored = 0;
  let queued = 0;
  for (const figure of figures) {
    const { kind, metric, quote, claimId, raw, read } = figure;
    if ("review" in read) {
      const key = createHash("sha256").update(JSON.stringify([release.documentId, kind, metric, quote, raw])).digest("hex");
      const candidate = { key, document_id: release.documentId, claim_id: claimId, kind, metric, quote, figure: raw, basis: null, low: null, high: null };
      const { rowCount } = await db.query(
        `insert into fact_review_queue (kind, candidate, reason, source_id, confidence, threshold)
         select 'release_figure', $1::jsonb, $2, $3, $4, $5
          where not exists (select 1 from fact_review_queue where kind = 'release_figure' and candidate->>'key' = $6)`,
        [candidate, read.review, release.sourceId, REVIEW_CONFIDENCE, REVIEW_THRESHOLD, key],
      );
      queued += rowCount ?? 0;
      continue;
    }
    stored += await insertFigure(db, { document_id: release.documentId, claim_id: claimId, kind, metric, quote, ...read });
  }
  return { stored, queued };
}

type FigureRow = { document_id: string; claim_id: string | null; kind: "guidance" | "result"; metric: ReleaseMetric; basis: FigureBasis; low: number; high: number; quote: string };

async function insertFigure(db: QueryExecutor, row: FigureRow): Promise<number> {
  const { rowCount } = await db.query(
    `insert into earnings_release_figures (document_id, claim_id, kind, metric, basis, low, high, quote)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (document_id, kind, metric, basis, quote) do nothing`,
    [row.document_id, row.claim_id, row.kind, row.metric, row.basis, row.low, row.high, row.quote],
  );
  return rowCount ?? 0;
}

// A reviewer's approved candidate as the figure it stores, with its basis, low
// and high as the reviewer set them and the rest as queued. Throws, with a message
// starting "release_figure: ", on a candidate that is no figure. A figure
// stored already for that sentence on that basis takes the reviewer's low and
// high, and its id is returned.
export async function storeReviewedFigure(db: QueryExecutor, candidate: unknown, queued: unknown): Promise<string> {
  const row = reviewedFigure(candidate, queued);
  const { rows } = await db.query<{ figure_id: string }>(
    `insert into earnings_release_figures (document_id, claim_id, kind, metric, basis, low, high, quote)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (document_id, kind, metric, basis, quote) do update set low = excluded.low, high = excluded.high
     returning figure_id::text as figure_id`,
    [row.document_id, row.claim_id, row.kind, row.metric, row.basis, row.low, row.high, row.quote],
  );
  return rows[0]!.figure_id;
}

// The sentence and what it is a figure of stay as the extraction queued them.
const QUEUED_FIELDS = ["document_id", "claim_id", "kind", "metric", "quote"] as const;

export function reviewedFigure(candidate: unknown, queued: unknown): FigureRow {
  const fail = (reason: string): never => {
    throw new Error(`release_figure: ${reason}`);
  };
  const fields = (value: unknown) => (typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null);
  const given = fields(candidate) ?? fail("the candidate is not an object");
  const kept = fields(queued) ?? fail("the queued candidate is not an object");
  const changed = QUEUED_FIELDS.filter((field) => given[field] !== kept[field]);
  if (changed.length > 0) return fail(`${changed.join(", ")} stay as queued`);
  const { document_id, claim_id, kind, metric, basis, low, high, quote } = given;
  if (!(FIGURE_BASES as ReadonlyArray<unknown>).includes(basis)) return fail("basis is gaap or non_gaap");
  if (typeof low !== "number" || typeof high !== "number" || !Number.isFinite(low) || !Number.isFinite(high)) return fail("low and high are numbers, in dollars or percent");
  if (low > high || (kind === "result" && low !== high)) return fail("low is at most high, and an actual's low is its high");
  return {
    document_id: document_id as string,
    claim_id: claim_id as string | null,
    kind: kind as FigureRow["kind"],
    metric: metric as ReleaseMetric,
    basis: basis as FigureBasis,
    low,
    high,
    quote: quote as string,
  };
}
