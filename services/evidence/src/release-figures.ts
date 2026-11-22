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

const NON_GAAP = /\bnon-?\s?gaap\b|\badjusted\b/i;
const GAAP = /(?<!non-?\s?)\bgaap\b/i;
const LOSS = /\bloss(?:es)?\b/i;
// A loss is stated as a positive amount ("operating loss of $50 million").
const INCOME_METRICS: ReadonlySet<ReleaseMetric> = new Set(["operating_income", "net_income", "eps"]);
const UNIT_WORDS: Readonly<Record<FigureUnit, string>> = { usd: "dollars", usd_per_share: "dollars a share", percent: "percent" };

// One amount, an optional dollar sign and a number with an optional percent,
// basis points or scale word.
const AMOUNT = /(\$)?\s?(\d[\d,]*(?:\.\d+)?)\s?(%|percent\b|basis points?\b|bps\b|billion\b|million\b|thousand\b)?/gi;
const SCALES: Readonly<Record<string, number>> = { billion: 1e9, million: 1e6, thousand: 1e3 };
type Amount = { n: number; dollars: boolean; mark: "%" | "bp" | null; scale: number | null };

function amountOf(phrase: string): Amount | null {
  const found = [...phrase.matchAll(AMOUNT)];
  if (found.length !== 1) return null;
  const [, dollar, digits, suffix = ""] = found[0]!;
  const word = suffix.toLowerCase();
  return {
    n: Number(digits!.replaceAll(",", "")),
    dollars: dollar !== undefined,
    mark: word === "%" || word === "percent" ? "%" : word.startsWith("b") && word !== "billion" ? "bp" : null,
    scale: SCALES[word] ?? null,
  };
}

// Twelve significant digits, so arithmetic on a parsed figure ("$45.0 billion"
// less 2%) lands on the figure as written.
const exact = (n: number) => Number(n.toPrecision(12));

// The figure the sentence states, or why it goes to review. That is a basis the
// sentence does not state, a phrase not in it or not one amount, an amount not
// in the metric's unit, a loss, a percent plus or minus on a margin (points or a
// share of it?), or a low above its high. A result is one value; a guide is a
// value, with or without plus_minus, or a low and a high.
export function readFigure(
  statement: { kind: "guidance" | "result"; metric: ReleaseMetric; quote: string },
  raw: RawFigure,
): FigureRead {
  const { kind, metric, quote } = statement;
  const basis = raw.basis;
  if (!(FIGURE_BASES as ReadonlyArray<unknown>).includes(basis)) return { review: `basis ${JSON.stringify(basis ?? null)} is neither gaap nor non_gaap` };
  if (basis === "non_gaap" ? !NON_GAAP.test(quote) : NON_GAAP.test(quote) && !GAAP.test(quote)) {
    return { review: `its sentence does not state a ${basis === "gaap" ? "GAAP" : "non-GAAP"} figure` };
  }
  if (INCOME_METRICS.has(metric) && LOSS.test(quote)) return { review: "its sentence states a loss, which would read as a positive figure" };
  const phrase = (value: unknown) => (typeof value === "string" && value.trim() !== "" ? value.replace(/\s+/g, " ").trim() : null);
  const [value, plusMinus, low, high] = [raw.value, raw.plus_minus, raw.low, raw.high].map(phrase);
  const shaped = kind === "result"
    ? value !== null && plusMinus === null && low === null && high === null
    : value !== null ? low === null && high === null : plusMinus === null && low !== null && high !== null;
  if (!shaped) return { review: kind === "result" ? "a result is one value" : "a guide is a value, with or without plus_minus, or a low and a high" };
  const amounts = new Map<string, Amount>();
  for (const given of [value, plusMinus, low, high]) {
    if (given === null) continue;
    if (!quote.includes(given)) return { review: `"${given}" is not in its sentence` };
    const amount = amountOf(given);
    if (amount === null) return { review: `"${given}" is not one figure` };
    amounts.set(given, amount);
  }
  const unit = figureUnit(metric);
  const fits = (amount: Amount) => unit === "percent"
    ? amount.mark === "%" && !amount.dollars && amount.scale === null
    : amount.dollars && amount.mark === null && (unit === "usd" || amount.scale === null);
  const unfit = [value, low, high].find((given) => given !== null && !fits(amounts.get(given)!));
  if (unfit !== undefined) return { review: `"${unfit}" is not a figure in ${UNIT_WORDS[unit]}` };
  const level = (given: string, scale: number | null = null) => {
    const amount = amounts.get(given)!;
    return amount.n * (amount.scale ?? scale ?? 1);
  };
  let from: number;
  let to: number;
  if (value !== null) {
    const center = level(value);
    const spread = plusMinus === null ? 0 : tolerance(amounts.get(plusMinus)!, unit, center);
    if (typeof spread === "string") return { review: spread };
    [from, to] = [center - spread, center + spread];
  } else {
    // A low with no scale of its own takes its high's ("$4.0 to $4.1 billion").
    [from, to] = [level(low!, amounts.get(high!)!.scale), level(high!)];
  }
  if (from > to) return { review: "its low is above its high" };
  return { basis: basis as FigureBasis, low: exact(from), high: exact(to) };
}

// How far either side of `center` a plus_minus reaches, or why it is unread.
function tolerance(amount: Amount, unit: FigureUnit, center: number): number | string {
  if (unit === "percent") {
    return amount.mark === "bp" ? amount.n / 100 : "a plus or minus on a margin is read only in basis points, as a percent could be points or a share of it";
  }
  if (amount.mark === "%") return (center * amount.n) / 100;
  if (amount.dollars && amount.mark === null) return amount.n * (amount.scale ?? 1);
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
// stored already for that sentence is kept, and its id returned.
export async function storeReviewedFigure(db: QueryExecutor, candidate: unknown, queued: unknown): Promise<string> {
  const row = reviewedFigure(candidate, queued);
  await insertFigure(db, row);
  const { rows } = await db.query<{ figure_id: string }>(
    `select figure_id::text as figure_id from earnings_release_figures
      where document_id = $1 and kind = $2 and metric = $3 and basis = $4 and quote = $5`,
    [row.document_id, row.kind, row.metric, row.basis, row.quote],
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
