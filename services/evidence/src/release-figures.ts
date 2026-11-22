// The figures of an earnings release (#733), the low and high of each guide for
// the next quarter, and the quarter's reported actuals, on their stated basis.
// As with its quotes (sec-earnings-release-extraction.ts), the model picks and
// the filing decides. The model copies each figure's phrases from the sentence
// ("$45.0 billion", "plus or minus 2%" as "2%"), and the figure is read from
// those phrases here, never from a number the model wrote. A parse the sentence
// does not bear out goes to the review queue.

import { createHash } from "node:crypto";

import type { IsoDate } from "../../financial-core/src/contracts.ts";
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

// The words in which a metric that can be negative states a negative figure as a
// positive amount ("operating loss of $50 million", "cash used in operating
// activities"). Revenue, costs and capex are never negative, so a negative one
// is misread.
const LOSS = /\bloss(?:es)?\b|\bnegative\b/i;
const OUTFLOW = /\bnegative\b|\bused in\b|\boutflows?\b|\bburn\b/i;
const NEGATIVE: Readonly<Record<ReleaseMetric, RegExp | "never">> = {
  revenue: "never",
  gross_margin: /\bnegative\b|\bgross loss\b/i,
  operating_expenses: "never",
  operating_income: LOSS,
  net_income: LOSS,
  eps: LOSS,
  operating_cash_flow: OUTFLOW,
  free_cash_flow: OUTFLOW,
  capex: "never",
  other: "never",
};
// EPS is diluted EPS.
const BASIC = /\bbasic\b/i;

// An amount as its sentence states it, with a minus sign or accounting
// parentheses, a dollar sign, a number, and its percent, basis points or scale. It starts and
// ends outside any word or number, so no amount is read inside "72.5%" or
// "$45.0Bn", nor a minus sign in the range "$1.10-$1.20".
const UNIT = String.raw`%|percent\b|basis points?\b|bps\b|billion\b|million\b|thousand\b|bn\b|mn\b|[BMK]\b`;
const NUMBER = String.raw`\d+(?:,\d{3})*(?:\.\d+)?(?![.,]?\d)`;
const AMOUNT = new RegExp(
  String.raw`(?<![\w.$%)])(?:(\$\s?)?\((\$\s?)?(${NUMBER})(?:\s?(${UNIT}))?\)(?:\s?(${UNIT}))?|(-)?(\$\s?)?(-)?(${NUMBER})(?:\s?(${UNIT}))?)(?![A-Za-z\d])`,
  "g",
);
const SCALES: Readonly<Record<string, number>> = { billion: 1e9, bn: 1e9, B: 1e9, million: 1e6, mn: 1e6, M: 1e6, thousand: 1e3, K: 1e3 };
type Amount = { start: number; end: number; n: number; dollars: boolean; mark: "%" | "bp" | null; scale: number | null };

function amountsIn(quote: string): Amount[] {
  return [...quote.matchAll(AMOUNT)].map((found) => {
    const [whole, outerDollar, innerDollar, parenthesized, innerUnit, outerUnit, minus, dollar, innerMinus, digits, unit] = found;
    const negative = parenthesized !== undefined || minus !== undefined || innerMinus !== undefined;
    const word = (parenthesized === undefined ? unit : innerUnit ?? outerUnit) ?? "";
    const n = Number((parenthesized ?? digits)!.replaceAll(",", ""));
    return {
      start: found.index,
      end: found.index + whole.length,
      n: negative ? -n : n,
      dollars: (outerDollar ?? innerDollar ?? dollar) !== undefined,
      mark: word === "%" || word === "percent" ? "%" : word.startsWith("b") && !(word in SCALES) ? "bp" : null,
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

const LABEL = /\bnon-?\s?gaap\b|\badjusted\b|\bgaap\b/gi;
// "GAAP and non-GAAP gross margins", a subject both bases share.
const SHARED = /\b(non-?\s?gaap|gaap) and (non-?\s?gaap|gaap)\b/i;
const SENTENCE_END = /[.!?]\s+(?=[A-Z])/g;
const basisOfLabel = (label: string): FigureBasis => (/^gaap$/i.test(label) ? "gaap" : "non_gaap");

// The sentence of the quote an offset is in, and where it starts.
function sentenceAt(quote: string, at: number): { start: number; text: string } {
  const ends = [...quote.matchAll(SENTENCE_END)].map((found) => found.index + found[0].length);
  const start = ends.filter((end) => end <= at).at(-1) ?? 0;
  return { start, text: quote.slice(start, ends.find((end) => end > at) ?? quote.length) };
}

// The bases the sentence of the amount `at` states it on, given the amounts the
// figure reads. A sentence naming no basis, or GAAP alone, states GAAP figures.
// One naming non-GAAP alone states non-GAAP figures after its label ("On a
// non-GAAP basis, gross margin was 43%") and none before it, which may be GAAP or
// a trailing label's. One naming both settles a basis only for a subject they
// share, in order with "respectively", else as one figure for both when the
// figure reads every amount after the subject ("were both 75.0%"). Any other mix
// settles none.
function basesOf(quote: string, amounts: ReadonlyArray<Amount>, at: Amount, read: ReadonlyArray<Amount>): ReadonlyArray<FigureBasis> {
  const sentence = sentenceAt(quote, at.start);
  const labels = [...sentence.text.matchAll(LABEL)].map((label) => ({ at: sentence.start + label.index, basis: basisOfLabel(label[0]) }));
  const named = new Set(labels.map((label) => label.basis));
  if (!named.has("non_gaap")) return ["gaap"];
  if (!named.has("gaap")) return at.start > labels[0]!.at ? ["non_gaap"] : [];
  const shared = SHARED.exec(sentence.text);
  if (shared === null || basisOfLabel(shared[1]!) === basisOfLabel(shared[2]!)) return [];
  const from = sentence.start + shared.index + shared[0].length;
  const after = amounts.filter((amount) => amount.start >= from && amount.end <= sentence.start + sentence.text.length);
  const respectively = sentence.text.slice(from - sentence.start).search(/\brespectively\b/i);
  if (respectively < 0) return after.includes(at) && after.every((amount) => read.includes(amount)) ? ["gaap", "non_gaap"] : [];
  const listed = after.filter((amount) => amount.end <= from + respectively);
  const index = listed.indexOf(at);
  return listed.length === 2 && index >= 0 ? [basisOfLabel(shared[index + 1]!)] : [];
}

// Twelve significant digits, so arithmetic on a parsed figure ("$45.0 billion"
// less 2%) lands on the figure as written.
const exact = (n: number) => Number(n.toPrecision(12));

// The figure the sentence states, or why it goes to review. That is a negative
// figure stated in words, basic EPS, a phrase not in the sentence or not one
// whole amount of it, an amount not in the metric's unit, a negative revenue,
// cost or capex, a basis the sentence does not state for that amount, a percent
// plus or minus on a margin (points or a share of it?), or a low above its high.
// A result is one value; a guide is a value, with or without plus_minus, or a
// low and a high.
export function readFigure(
  statement: { kind: "guidance" | "result"; metric: ReleaseMetric; quote: string },
  raw: RawFigure,
): FigureRead {
  const { kind, metric, quote } = statement;
  const basis = raw.basis;
  if (!(FIGURE_BASES as ReadonlyArray<unknown>).includes(basis)) return { review: `basis ${JSON.stringify(basis ?? null)} is neither gaap nor non_gaap` };
  const negative = NEGATIVE[metric];
  if (negative !== "never" && negative.test(quote)) return { review: "its sentence states a negative figure in words, which would read as a positive one" };
  if (metric === "eps" && BASIC.test(quote)) return { review: "EPS is read as diluted, and its sentence names basic EPS" };
  const phrase = (value: unknown) => (typeof value === "string" && value.trim() !== "" ? value.replace(/\s+/g, " ").trim() : null);
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
  const unit = figureUnit(metric);
  const levels = [value, low, high].filter((given): given is string => given !== null);
  const unfit = levels.find((given) => !fits(found.get(given)!, unit));
  if (unfit !== undefined) return { review: `"${unfit}" is not a figure in ${UNIT_WORDS[unit]}` };
  if (negative === "never" && levels.some((given) => found.get(given)!.n < 0)) return { review: `a negative ${metric.replaceAll("_", " ")} is misread` };
  const misread = levels.find((given) => !basesOf(quote, amounts, found.get(given)!, [...found.values()]).includes(basis as FigureBasis));
  if (misread !== undefined) return { review: `its sentence does not state "${misread}" as a ${basis === "gaap" ? "GAAP" : "non-GAAP"} figure` };
  const level = (given: string, scale: number | null = null) => {
    const amount = found.get(given)!;
    return amount.n * (amount.scale ?? scale ?? 1);
  };
  let from: number;
  let to: number;
  if (value !== null) {
    const center = level(value);
    const spread = plusMinus === null ? 0 : tolerance(found.get(plusMinus)!, unit, found.get(value)!, center);
    if (typeof spread === "string") return { review: spread };
    [from, to] = [center - spread, center + spread];
  } else {
    // A low with no scale of its own takes its high's ("$4.0 to $4.1 billion").
    [from, to] = [level(low!, found.get(high!)!.scale), level(high!)];
  }
  if (from > to) return { review: "its low is above its high" };
  return { basis: basis as FigureBasis, low: exact(from), high: exact(to) };
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
