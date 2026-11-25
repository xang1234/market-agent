// The research-quality eval's figure check (#781): every numeral an answer states, found
// by code, labelled by a model (what each one is and which values on file it rests on),
// and judged by code against the frozen golden dataset. It reads app runs and bare runs
// alike, from each completed turn as renderBlock shows it.
//
//   node --experimental-strip-types scripts/research-quality-figures.ts check <run.json>...
//
// Writes <run>.figures.json beside each run and prints one line per run, then each wrong
// figure with its sentence.
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import {
  AMD_Q2_2025_RELEASE,
  GOLDEN_AS_OF,
  GOLDEN_COMPANIES,
  GOLDEN_ISSUER_FACTS,
  goldenDailyBars,
  type GoldenCompany,
} from "../services/chat/test/golden/dataset.ts";
import { callMessages, type CallMessages, type Usage } from "./research-quality-bare.ts";
import { ROOT, Refusal, datasetRevision, renderBlock, runCli, type RunRecord } from "./research-quality-eval.ts";
import { readRun } from "./research-quality-pairs.ts";

// --- numerals ----------------------------------------------------------------------

// amount: a plain number, a currency amount or one with a B/M/K scale; points:
// percentage points; bps: basis points; multiple: 3.2x.
export type NumeralUnit = "amount" | "percent" | "points" | "bps" | "multiple" | "date";
export type Numeral = {
  id: string;
  text: string;
  start: number;
  end: number;
  // As written, its own scale applied; negative only when the text gives it a sign.
  value: number;
  // One unit of the last digit shown, scaled like value: the precision the text claims.
  step: number;
  unit: NumeralUnit;
  // The text carries a minus sign. Parentheses don't sign a number: in prose they hold an
  // aside ("previous close ($176.10)") far more often than an accounting negative.
  signed: boolean;
  // The text carries its own B/M/K scale, so a table's "in millions" doesn't apply.
  scaled: boolean;
};

const NUMBER = String.raw`\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?|\.\d+`;
const SUFFIX = String.raw`\s?(?:%|percent\b|percentage points?\b|pp\b|ppts?\b|points?\b|bps\b|bp\b|basis points\b|trillion\b|billion\b|million\b|thousand\b|tn\b|bn\b|mn\b|mm\b|[tbmk]\b)|(?:x\b|×)`;
const NUMERAL = new RegExp(
  String.raw`(?<date>\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z?)?)`
  + String.raw`|(?<sign>(?<![\w.])[-−](?=(?:US)?\$?\d|\.\d))?(?:US)?\$?(?<number>${NUMBER})(?<suffix>${SUFFIX})?`,
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
    const base = { id: `n${i + 1}`, text: match[0], start: match.index!, end: match.index! + match[0].length };
    if (groups.date) return { ...base, value: Number.NaN, step: Number.NaN, unit: "date" as const, signed: false, scaled: false };
    const digits = groups.number!;
    const suffix = groups.suffix ?? "";
    const { unit, scale } = unitOf(suffix);
    const signed = groups.sign !== undefined;
    const magnitude = Number(digits.replaceAll(",", "")) * scale;
    return { ...base, value: signed ? -magnitude : magnitude, step: stepOf(digits) * scale, unit, signed, scaled: scale !== 1 };
  });
}

// The text with each numeral marked by its id, for the labeller.
export const markNumerals = (text: string, numerals: ReadonlyArray<Numeral>) =>
  numerals.reduceRight((marked, n) => `${marked.slice(0, n.start)}⟦${n.id}:${n.text}⟧${marked.slice(n.end)}`, text);

// --- labels ------------------------------------------------------------------------

export const TICKERS = GOLDEN_COMPANIES.map((company) => company.ticker);
export const METRICS = [
  "revenue", "gross_profit", "operating_income", "net_income", "segment_revenue",
  "quote_price", "quote_prev_close", "bar_open", "bar_high", "bar_low", "bar_close", "bar_volume", "filed_claim",
] as const;
export const DERIVATIONS = ["margin", "growth", "difference", "ratio", "share_of_total"] as const;
const FISCAL_PERIODS = ["Q1", "Q2", "Q3", "Q4", "FY"] as const;
const SEGMENTS = GOLDEN_COMPANIES.flatMap((company) => company.segments?.revenue.map(([name]) => name) ?? []);

// A pointer at one value on file.
export type DataRef = {
  company: string;
  metric: (typeof METRICS)[number];
  fiscal_year: number | null;
  fiscal_period: (typeof FISCAL_PERIODS)[number] | null;
  segment: string | null;
  // A daily bar's session date.
  date: string | null;
};
// One value on file, or one divided by another (a margin, as an operand of a margin change).
export type Operand = { value: DataRef; over: DataRef | null };
export type FigureLabel = {
  id: string;
  company: string | null;
  metric: string;
  period: string;
  basis: "reported" | "derived";
  source: DataRef | null;
  derivation: (typeof DERIVATIONS)[number] | null;
  operands: Operand[];
  sign: "+" | "-" | null;
  scale: "thousands" | "millions" | "billions" | null;
};
export type TurnLabels = { labels: string[]; figures: FigureLabel[] };

const nullable = (schema: object) => ({ anyOf: [schema, { type: "null" }] });
export const LABELS_SCHEMA = {
  type: "object",
  $defs: {
    ref: {
      type: "object",
      properties: {
        company: { type: "string", enum: TICKERS },
        metric: { type: "string", enum: METRICS },
        fiscal_year: nullable({ type: "integer" }),
        fiscal_period: nullable({ type: "string", enum: FISCAL_PERIODS }),
        segment: nullable({ type: "string", enum: SEGMENTS }),
        date: nullable({ type: "string" }),
      },
      required: ["company", "metric", "fiscal_year", "fiscal_period", "segment", "date"],
      additionalProperties: false,
    },
  },
  properties: {
    labels: { type: "array", items: { type: "string" } },
    figures: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          company: nullable({ type: "string", enum: TICKERS }),
          metric: { type: "string" },
          period: { type: "string" },
          basis: { type: "string", enum: ["reported", "derived"] },
          source: nullable({ $ref: "#/$defs/ref" }),
          derivation: nullable({ type: "string", enum: DERIVATIONS }),
          operands: {
            type: "array",
            items: { type: "object", properties: { value: { $ref: "#/$defs/ref" }, over: nullable({ $ref: "#/$defs/ref" }) }, required: ["value", "over"], additionalProperties: false },
          },
          sign: nullable({ type: "string", enum: ["+", "-"] }),
          scale: nullable({ type: "string", enum: ["thousands", "millions", "billions"] }),
        },
        required: ["id", "company", "metric", "period", "basis", "source", "derivation", "operands", "sign", "scale"],
        additionalProperties: false,
      },
    },
  },
  required: ["labels", "figures"],
  additionalProperties: false,
} as const;

// --- the data, by pointer ------------------------------------------------------------

const companyOf = (ticker: string): GoldenCompany | undefined => GOLDEN_COMPANIES.find((company) => company.ticker === ticker);
const BARS = new Map(GOLDEN_COMPANIES.map((company) => [company.ticker, new Map(goldenDailyBars(company).map((bar) => [bar.ts.slice(0, 10), bar]))]));

// The value a pointer names, or undefined when nothing on file is there.
export function valueOf(ref: DataRef): number | undefined {
  const company = companyOf(ref.company);
  if (!company) return undefined;
  switch (ref.metric) {
    case "revenue":
    case "gross_profit":
    case "operating_income":
    case "net_income":
      return GOLDEN_ISSUER_FACTS.find((fact) => fact.issuer_id === company.issuer_id && fact.metric_key === ref.metric && fact.fiscal_year === ref.fiscal_year && fact.fiscal_period === ref.fiscal_period)?.value_usd;
    case "segment_revenue": {
      const segments = company.segments;
      if (!segments || segments.fiscal_year !== ref.fiscal_year || segments.fiscal_period !== ref.fiscal_period) return undefined;
      const found = segments.revenue.find(([name]) => name === ref.segment);
      return found && found[1] * 1e6;
    }
    case "quote_price":
      return company.quote.price;
    case "quote_prev_close":
      return company.quote.prev_close;
    case "filed_claim":
      return undefined;
    default: {
      const bar = ref.date === null ? undefined : BARS.get(company.ticker)!.get(ref.date);
      return bar?.[ref.metric.slice("bar_".length) as "open" | "high" | "low" | "close" | "volume"];
    }
  }
}

// The amounts the filed claim states, read with the same enumerator as answers.
const CLAIM_AMOUNTS = enumerateNumerals(AMD_Q2_2025_RELEASE.text).filter((n) => n.unit === "amount" && n.scaled).map((n) => n.value);

// --- verdicts ------------------------------------------------------------------------

export type Verdict = "matched" | "derived_ok" | "wrong" | "not_checkable";
export type Checked = { verdict: Verdict; expected?: number; reason?: string };

// A fraction (margin, growth, share, a change between margins) reads as percent or
// points; a ratio as a multiple; an amount only as an amount. A bare table number may be
// a percent or a plain fraction, so it's read both ways.
type Result = { kind: "amount" | "fraction" | "ratio"; value: number };
function candidates({ kind, value }: Result, unit: NumeralUnit): number[] {
  if (kind === "amount") return unit === "amount" ? [value] : [];
  if (unit === "percent" || unit === "points") return [value * 100];
  if (unit === "bps") return [value * 10_000];
  if (unit === "multiple") return kind === "ratio" ? [value] : [];
  return [value * 100, value];
}

// Equal at the precision shown: within half the last digit's place.
export const withinPrecision = (shown: number, actual: number, step: number) =>
  Math.abs(shown - actual) <= step / 2 + 1e-9 * Math.max(Math.abs(shown), Math.abs(actual), step);

function operandValue(operand: Operand): { value: number; fraction: boolean } | undefined {
  const value = valueOf(operand.value);
  if (value === undefined) return undefined;
  if (operand.over === null) return { value, fraction: false };
  const over = valueOf(operand.over);
  return over === undefined || over === 0 ? undefined : { value: value / over, fraction: true };
}

// A derived figure recomputed from its two operands, in their order.
export function derive(derivation: FigureLabel["derivation"], operands: ReadonlyArray<Operand>): Result | string {
  if (derivation === null) return "derived, but no derivation given";
  if (operands.length !== 2) return `${derivation} needs two operands, got ${operands.length}`;
  const [a, b] = operands.map(operandValue);
  if (!a || !b) return "an operand isn't in the data";
  if (derivation === "difference" && a.fraction !== b.fraction) return "a difference between a ratio and an amount";
  const result: Result = {
    margin: { kind: "fraction", value: a.value / b.value },
    share_of_total: { kind: "fraction", value: a.value / b.value },
    growth: { kind: "fraction", value: (b.value - a.value) / Math.abs(a.value) },
    ratio: { kind: "ratio", value: a.value / b.value },
    difference: { kind: a.fraction ? "fraction" : "amount", value: a.value - b.value },
  }[derivation] as Result;
  return Number.isFinite(result.value) ? result : "it divides by zero";
}

const SCALE_WORDS = { thousands: 1e3, millions: 1e6, billions: 1e9 } as const;

// One numeral's verdict. The text's own sign wins; failing that the sign its words give;
// with neither, only the size is compared ("a loss of $134M" against -134M). A difference
// is compared by size: its sign follows the operand order, which is the labeller's guess.
// ponytail: so "margin rose 12.5 points" passes for a fall; check direction when a
// labeller orders differences reliably.
export function verdictFor(numeral: Numeral, label: FigureLabel | undefined): Checked {
  if (!label) return { verdict: "not_checkable", reason: "the labeller skipped it" };
  if (numeral.unit === "date") return { verdict: "not_checkable", reason: "a date labelled as a figure" };
  const scale = numeral.unit === "amount" && !numeral.scaled && label.scale ? SCALE_WORDS[label.scale] : 1;
  const step = numeral.step * scale;
  const shown = numeral.value * scale * (!numeral.signed && label.sign === "-" ? -1 : 1);
  const bySign = (numeral.signed || label.sign !== null) && !(label.basis === "derived" && label.derivation === "difference");
  const fits = (actual: number) => withinPrecision(bySign ? shown : Math.abs(shown), bySign ? actual : Math.abs(actual), step);
  let options: number[];
  if (label.basis === "reported") {
    if (label.source === null) return { verdict: "not_checkable", reason: `${label.metric} (${label.period}) isn't in the data` };
    if (label.source.metric === "filed_claim") {
      if (numeral.unit !== "amount") return { verdict: "not_checkable", reason: "the filed claim states amounts only" };
      return CLAIM_AMOUNTS.some(fits) ? { verdict: "matched" } : { verdict: "wrong", expected: CLAIM_AMOUNTS[0] };
    }
    const actual = valueOf(label.source);
    if (actual === undefined) return { verdict: "not_checkable", reason: "its source isn't in the data" };
    options = candidates({ kind: "amount", value: actual }, numeral.unit);
    if (options.length === 0) return { verdict: "not_checkable", reason: `a reported amount shown as ${numeral.unit}` };
    return options.some(fits) ? { verdict: "matched" } : { verdict: "wrong", expected: options[0] };
  }
  const result = derive(label.derivation, label.operands);
  if (typeof result === "string") return { verdict: "not_checkable", reason: result };
  options = candidates(result, numeral.unit);
  if (options.length === 0) return { verdict: "not_checkable", reason: `a ${label.derivation} shown as ${numeral.unit}` };
  return options.some(fits) ? { verdict: "derived_ok" } : { verdict: "wrong", expected: options[0] };
}

// --- check -------------------------------------------------------------------------

export type TurnInput = { questionId: string; turn: number; messages: string[]; text: string; numerals: Numeral[] };
export type LabelResult = { ok: true; labels: TurnLabels; usage?: Usage; stopReason?: string | null } | { ok: false; error: string };
export type Labeller = (input: TurnInput) => Promise<LabelResult>;
export type CheckedNumeral = Pick<Numeral, "id" | "text" | "start" | "end"> & { label: "label" | FigureLabel | null; verdict: Verdict | null; expected?: number; reason?: string };
export type CheckedTurn = { question: string; turn: number; message: string; text: string; labeller: { error?: string; usage?: Usage; stopReason?: string | null }; numerals: CheckedNumeral[] };
export type Tally = Record<Verdict, number> & { figures: number };
export type FiguresFile = { run: string; checkedAgainst: { datasetRevision: string; asOf: string }; labeller: typeof LABELLER; totals: Tally; turns: CheckedTurn[] };

// A label wins over a figure for an id listed as both; an id listed as neither is a
// figure the labeller skipped, so it counts as not checkable, never dropped.
export function checkTurn(input: TurnInput, result: LabelResult, message: string): CheckedTurn {
  const labels = new Set(result.ok ? result.labels.labels : []);
  const figures = new Map<string, FigureLabel>();
  for (const figure of result.ok ? result.labels.figures : []) if (!figures.has(figure.id)) figures.set(figure.id, figure);
  return {
    question: input.questionId,
    turn: input.turn,
    message,
    text: input.text,
    labeller: result.ok ? { usage: result.usage, stopReason: result.stopReason } : { error: result.error },
    numerals: input.numerals.map((numeral) => {
      const span = { id: numeral.id, text: numeral.text, start: numeral.start, end: numeral.end };
      if (labels.has(numeral.id)) return { ...span, label: "label", verdict: null };
      const figure = figures.get(numeral.id);
      return { ...span, label: figure ?? null, ...verdictFor(numeral, figure) };
    }),
  };
}

export function tally(turns: ReadonlyArray<CheckedTurn>): Tally {
  const totals: Tally = { figures: 0, matched: 0, derived_ok: 0, wrong: 0, not_checkable: 0 };
  for (const numeral of turns.flatMap((turn) => turn.numerals)) {
    if (numeral.verdict === null) continue;
    totals.figures += 1;
    totals[numeral.verdict] += 1;
  }
  return totals;
}

// The sentence a span sits in: from the last sentence end or line break before it to the next.
export function sentenceAt(text: string, start: number, end: number): string {
  const before = Math.max(text.lastIndexOf("\n", start - 1), ...[...text.slice(0, start).matchAll(/[.!?](?=\s)/gu)].map((m) => m.index!)) + 1;
  const after = text.slice(end).search(/[.!?](?=\s|$)|\n/u);
  return text.slice(before, after === -1 ? text.length : end + after + 1).trim();
}

// ponytail: four turns labelled at once; raise it if the account's rate limit allows.
async function inPool<T, R>(items: ReadonlyArray<T>, size: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await work(items[i]!);
    }
  }));
  return out;
}

// Every completed turn of a run, rendered as the report shows it, its numerals labelled
// and judged. A turn that didn't complete has no answer to check.
export async function checkRun(record: RunRecord, label: Labeller): Promise<FiguresFile> {
  const inputs = record.questions.flatMap(({ question, turns }) => turns.flatMap((turn, i) => {
    if (turn.outcome !== "completed") return [];
    const text = turn.blocks.map((block) => renderBlock(block)).join("\n\n");
    return [{ input: { questionId: question.id, turn: i + 1, messages: question.turns.slice(0, i + 1).map((t) => t.message), text, numerals: enumerateNumerals(text) }, message: turn.message }];
  }));
  const turns = await inPool(inputs, 4, async ({ input, message }) => checkTurn(input, await label(input), message));
  return { run: record.run, checkedAgainst: { datasetRevision: datasetRevision(ROOT), asOf: GOLDEN_AS_OF }, labeller: LABELLER, totals: tally(turns), turns };
}

export function summaryLines(file: FiguresFile): string[] {
  const { figures, matched, derived_ok, wrong, not_checkable } = file.totals;
  const failed = file.turns.filter((turn) => turn.labeller.error !== undefined);
  return [
    `${file.run}: figures ${figures}, matched ${matched}, derived_ok ${derived_ok}, wrong ${wrong}, not_checkable ${not_checkable}${failed.length > 0 ? ` (${failed.length} turns not labelled)` : ""}`,
    ...file.turns.flatMap((turn) => turn.numerals.filter((n) => n.verdict === "wrong").map((n) =>
      `  wrong ${turn.question} turn ${turn.turn}: ${n.text} (data: ${n.expected === undefined ? "?" : Number(n.expected.toPrecision(6))}): ${sentenceAt(turn.text, n.start, n.end)}`)),
  ];
}

// Judges a checked run again from its saved labels, so a change to the verdict code is
// measured on the same labels without paying for new ones. Refuses a turn whose numerals
// the enumerator no longer finds where they were, since its ids would point elsewhere.
export function rejudge(file: FiguresFile): FiguresFile {
  const turns = file.turns.map((turn) => {
    const numerals = enumerateNumerals(turn.text);
    const moved = numerals.length !== turn.numerals.length
      || numerals.some((n, i) => n.end <= turn.numerals[i]!.start || n.start >= turn.numerals[i]!.end);
    if (moved) throw new Refusal(`${file.run} ${turn.question} turn ${turn.turn}: the enumerator now finds other numerals; run check again`);
    const result: LabelResult = turn.labeller.error !== undefined ? { ok: false, error: turn.labeller.error } : {
      ok: true,
      labels: {
        labels: turn.numerals.filter((n) => n.label === "label").map((n) => n.id),
        figures: turn.numerals.flatMap((n) => (n.label !== null && n.label !== "label" ? [n.label] : [])),
      },
      usage: turn.labeller.usage,
      stopReason: turn.labeller.stopReason,
    };
    return checkTurn({ questionId: turn.question, turn: turn.turn, messages: [], text: turn.text, numerals }, result, turn.message);
  });
  return { ...file, checkedAgainst: { datasetRevision: datasetRevision(ROOT), asOf: GOLDEN_AS_OF }, totals: tally(turns), turns };
}

// --- the labeller ----------------------------------------------------------------------

export const LABELLER = { model: "anthropic/claude-opus-5-5", effort: "medium", max_tokens: 32_000 } as const;

// What is on file, by pointer, with no values: a labeller that saw them could point a
// figure at the value it matches instead of at what its sentence says.
export function labellerSystemPrompt(): string {
  const companies = GOLDEN_COMPANIES.map((company) => {
    const periods = (kind: string) => GOLDEN_ISSUER_FACTS
      .filter((fact) => fact.issuer_id === company.issuer_id && fact.period_kind === kind && fact.metric_key === "revenue")
      .map((fact) => `${fact.fiscal_period === "FY" ? "" : `${fact.fiscal_period} `}FY${fact.fiscal_year} (${fact.period_start} to ${fact.period_end})`);
    const bars = [...BARS.get(company.ticker)!.keys()];
    return [
      `- ${company.ticker} (${company.legal_name}): revenue, gross_profit, operating_income and net_income for the fiscal quarters ${periods("fiscal_q").join(", ")}, and the fiscal years ${periods("fiscal_y").join(", ")}.`,
      ...(company.segments ? [`  segment_revenue for ${company.segments.fiscal_period} FY${company.segments.fiscal_year}, segments: ${company.segments.revenue.map(([name]) => name).join(", ")}.`] : []),
      `  quote_price and quote_prev_close as of ${GOLDEN_AS_OF.slice(0, 10)}; bar_open, bar_high, bar_low, bar_close and bar_volume for each weekday session from ${bars[0]} to ${bars.at(-1)} (date is the session date).`,
    ].join("\n");
  });
  return [
    "You label every marked number in an equity research answer, so code can check each one against the data on file. Each number is marked ⟦id:text⟧. Put every id in exactly one place: labels or figures.",
    "A label names or counts rather than measures: a year, a fiscal year, a quarter number, a date or time, a count (eight quarters, three companies), a rank or list number, or part of a name (MI308, Form 8-K, Exhibit 99.1).",
    [
      "A figure states an amount, price, volume, percentage, margin, growth rate, change or multiple. For each figure give:",
      "- company, metric and period in a few words, as the sentence gives them;",
      "- basis \"reported\" when it states one value on file, with source pointing at that value;",
      "- basis \"derived\" when it is computed (a margin, growth rate, share or multiple always is) from values on file, with derivation and its two operands in this order: margin [profit, revenue]; share_of_total [part, total]; growth [earlier, later]; difference [first, the value subtracted from it], so a change from A to B is [B, A]; ratio [numerator, denominator]. An operand is one value on file, or one value over another (over) when the figure compares two margins or ratios;",
      "- sign \"-\" when the words make the number negative (a loss, a decline, a fall, a drop), \"+\" when they make it positive (a rise, a gain), null when they give no direction;",
      "- scale when the number has no B, M or K of its own but its table or sentence puts it in thousands, millions or billions.",
      "Point at what the sentence says, even where you think it is wrong. A figure about something not on file (another metric, period or company) still goes in figures, with source null and no operands.",
    ].join("\n"),
    `On file, as of ${GOLDEN_AS_OF.slice(0, 10)} (fiscal_period is Q1 to Q4, or FY for a fiscal year):\n${companies.join("\n")}\n- filed_claim: AMD's explanation of its Q2 FY2025, quoted from its earnings release: "${AMD_Q2_2025_RELEASE.text}"`,
  ].join("\n\n");
}

export function labellerPrompt(input: TurnInput): string {
  return [
    `The portfolio manager's messages so far:\n${input.messages.map((message, i) => `${i + 1}. ${message}`).join("\n")}`,
    `The answer to message ${input.messages.length}, with its numbers marked:\n\n${markNumerals(input.text, input.numerals)}`,
  ].join("\n\n");
}

export function anthropicLabeller(call: CallMessages): Labeller {
  return async (input) => {
    if (input.numerals.length === 0) return { ok: true, labels: { labels: [], figures: [] } };
    const result = await call({
      model: LABELLER.model.split("/")[1],
      max_tokens: LABELLER.max_tokens,
      output_config: { effort: LABELLER.effort, format: { type: "json_schema", schema: LABELS_SCHEMA } },
      system: labellerSystemPrompt(),
      messages: [{ role: "user", content: labellerPrompt(input) }],
    });
    if (!result.ok) return { ok: false, error: `${result.outcome}: ${result.error}` };
    try {
      return { ok: true, labels: JSON.parse(result.text) as TurnLabels, usage: result.usage, stopReason: result.stopReason };
    } catch {
      return { ok: false, error: `unreadable labels (stop reason ${result.stopReason})` };
    }
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await runCli(async () => {
    const [command, ...files] = process.argv.slice(2);
    if (!(command === "check" || command === "rejudge") || files.length === 0) {
      console.error("usage: research-quality-figures.ts check <run.json>... | rejudge <figures.json>...");
      process.exitCode = 2;
      return;
    }
    if (command === "rejudge") {
      for (const path of files) {
        const saved = JSON.parse(readFileSync(path, "utf8")) as FiguresFile;
        if (typeof saved?.run !== "string" || !Array.isArray(saved.turns)) throw new Refusal(`${path} isn't a <run>.figures.json`);
        const file = rejudge(saved);
        writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`);
        console.log([...summaryLines(file), `  ${path}`].join("\n"));
      }
      return;
    }
    const apiKey = process.env.LLM_ANTHROPIC_API_KEY?.trim();
    if (!apiKey) throw new Refusal("set LLM_ANTHROPIC_API_KEY (the app's anthropic channel key) to label figures");
    const label = anthropicLabeller((body) => callMessages(body, { apiKey }));
    for (const path of files) {
      if (!path.endsWith(".run.json")) throw new Refusal(`${path} isn't a <run>.run.json`);
      const record = readRun(path);
      const file = await checkRun(record, label);
      if (record.provenance.datasetRevision !== file.checkedAgainst.datasetRevision) {
        console.log(`note: ${record.run} ran on dataset ${record.provenance.datasetRevision.slice(0, 12)}; its figures are checked against this checkout's ${file.checkedAgainst.datasetRevision.slice(0, 12)}`);
      }
      const out = path.replace(/\.run\.json$/u, ".figures.json");
      writeFileSync(out, `${JSON.stringify(file, null, 2)}\n`);
      console.log([...summaryLines(file), `  ${out}`].join("\n"));
    }
  });
}
