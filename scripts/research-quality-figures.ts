// The research-quality eval's figure check (#781): every numeral an answer states, found
// by code, labelled by a model (what each one is and which values on file it rests on),
// and judged by code against the frozen golden dataset. It reads app runs and bare runs
// alike, from each completed turn as renderBlock shows it. The numerals and verdicts are
// financial-core's figure check, which chat's checked-prose lane is to share (#800); this
// file holds the golden pointer, its labeller and the CLI.
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
import {
  DERIVATIONS,
  enumerateNumerals,
  verdictFor as judge,
  writtenAs,
  type Derivation,
  type FigureLabel,
  type Numeral,
  type Operand,
  type Scale,
  type Sign,
  type ValueOf,
  type Verdict,
} from "../services/financial-core/src/figure-check.ts";
import { callMessages, type CallMessages, type Usage } from "./research-quality-bare.ts";
import { ROOT, Refusal, datasetRevision, renderBlock, runCli, type RunRecord } from "./research-quality-eval.ts";
import { readRun } from "./research-quality-pairs.ts";

// --- numerals ----------------------------------------------------------------------

// The text with each numeral marked by its id, for the labeller.
export const markNumerals = (text: string, numerals: ReadonlyArray<Numeral>) =>
  numerals.reduceRight((marked, n) => `${marked.slice(0, n.start)}⟦${n.id}:${n.text}⟧${marked.slice(n.end)}`, text);

// --- labels ------------------------------------------------------------------------

export const TICKERS = GOLDEN_COMPANIES.map((company) => company.ticker);
export const METRICS = [
  "revenue", "gross_profit", "operating_income", "net_income", "segment_revenue",
  "quote_price", "quote_prev_close", "bar_open", "bar_high", "bar_low", "bar_close", "bar_volume", "filed_claim",
] as const;
const FISCAL_PERIODS = ["Q1", "Q2", "Q3", "Q4", "FY"] as const;
const SEGMENTS = GOLDEN_COMPANIES.flatMap((company) => company.segments?.revenue.map(([name]) => name) ?? []);

// A pointer at one value on file.
export type GoldenRef = {
  company: string;
  metric: (typeof METRICS)[number];
  fiscal_year: number | null;
  fiscal_period: (typeof FISCAL_PERIODS)[number] | null;
  segment: string | null;
  // A daily bar's session date.
  date: string | null;
};
// A figure as the labeller states it, saved as is in <run>.figures.json.
export type LabelledFigure = {
  id: string;
  company: string | null;
  metric: string;
  period: string;
  basis: "reported" | "derived";
  source: GoldenRef | null;
  derivation: Derivation | null;
  operands: Operand<GoldenRef>[];
  sign: Sign;
  scale: Scale;
};
export type TurnLabels = { labels: string[]; figures: LabelledFigure[] };

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

// The value a pointer names, or undefined when nothing on file is there. Every golden
// value is an amount: dollars, a price or a volume.
export const valueOf: ValueOf<GoldenRef> = (ref) => {
  const value = amountOf(ref);
  return value === undefined ? undefined : { kind: "amount", value };
};

function amountOf(ref: GoldenRef): number | undefined {
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
      return CLAIM_AMOUNTS.length === 1 ? CLAIM_AMOUNTS[0] : undefined;
    default: {
      const bar = ref.date === null ? undefined : BARS.get(company.ticker)!.get(ref.date);
      return bar?.[ref.metric.slice("bar_".length) as "open" | "high" | "low" | "close" | "volume"];
    }
  }
}

// The amounts the filed claim states, read with the same enumerator as answers. It states
// one ($800 million), so a pointer at the claim reads that amount.
const CLAIM_AMOUNTS = enumerateNumerals(AMD_Q2_2025_RELEASE.text).filter((n) => n.unit === "amount" && n.scaled).map((n) => n.value);

// --- verdicts ------------------------------------------------------------------------

export type Checked = { verdict: Verdict["kind"]; expected?: number; reason?: string };
// A wrong figure within one and a half units of its last digit: a rounding slip, told
// apart from a misstatement in the summary.
export const LAST_DIGIT = "off by one in the last digit";

// The filed charge states no sign, so only a reported figure reads it. Adding it back
// (operating income before the charge) needs a sum, which no derivation is: a difference
// would expect $934M for the right $666M (#805).
const operandValueOf: ValueOf<GoldenRef> = (ref) => (ref.metric === "filed_claim" ? undefined : valueOf(ref));

// The labeller's figure as the figure check reads it, or why it names nothing to check.
function asLabel(figure: LabelledFigure): FigureLabel<GoldenRef> | string {
  const { sign, scale } = figure;
  if (figure.basis === "derived") {
    return figure.derivation === null ? "derived, but no derivation given" : { basis: "derived", derivation: figure.derivation, operands: figure.operands, sign, scale };
  }
  return figure.source === null ? { basis: "off_file", what: `${figure.metric} (${figure.period})` } : { basis: "reported", source: figure.source, sign, scale };
}

// One numeral's verdict against the golden data, as <run>.figures.json saves it: a wrong
// figure's expected value in the numeral's own unit (a percent as 74.4, not 0.744).
export function verdictFor(numeral: Numeral, figure: LabelledFigure | undefined): Checked {
  if (!figure) return { verdict: "not_checkable", reason: "the labeller skipped it" };
  const label = asLabel(figure);
  const verdict: Verdict = typeof label === "string" ? { kind: "not_checkable", reason: label } : judge(numeral, label, label.basis === "derived" ? operandValueOf : valueOf);
  switch (verdict.kind) {
    case "wrong":
      return { verdict: "wrong", expected: writtenAs(verdict.expected, numeral.unit)[0], ...(verdict.lastDigit ? { reason: LAST_DIGIT } : {}) };
    case "not_checkable":
      return { verdict: "not_checkable", reason: verdict.reason };
    default:
      return { verdict: verdict.kind };
  }
}

// --- check -------------------------------------------------------------------------

export type TurnInput = { questionId: string; turn: number; messages: string[]; text: string; numerals: Numeral[] };
export type LabelResult = { ok: true; labels: TurnLabels; usage?: Usage; stopReason?: string | null } | { ok: false; error: string };
export type Labeller = (input: TurnInput) => Promise<LabelResult>;
export type CheckedNumeral = Pick<Numeral, "id" | "text" | "start" | "end"> & { label: "label" | LabelledFigure | null; verdict: Verdict["kind"] | null; expected?: number; reason?: string };
export type CheckedTurn = { question: string; turn: number; message: string; text: string; labeller: { error?: string; usage?: Usage; stopReason?: string | null }; numerals: CheckedNumeral[] };
export type Tally = Record<Verdict["kind"], number> & { figures: number };
export type FiguresFile = { run: string; checkedAgainst: { datasetRevision: string; asOf: string }; labeller: typeof LABELLER; totals: Tally; turns: CheckedTurn[] };

// A label wins over a figure for an id listed as both; an id listed as neither is a
// figure the labeller skipped, so it counts as not checkable, never dropped.
export function checkTurn(input: TurnInput, result: LabelResult, message: string): CheckedTurn {
  const labels = new Set(result.ok ? result.labels.labels : []);
  const figures = new Map<string, LabelledFigure>();
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
  const slips = file.turns.flatMap((turn) => turn.numerals).filter((n) => n.verdict === "wrong" && n.reason === LAST_DIGIT).length;
  return [
    `${file.run}: figures ${figures}, matched ${matched}, derived_ok ${derived_ok}, wrong ${wrong} (${slips} ${LAST_DIGIT}), not_checkable ${not_checkable}${failed.length > 0 ? ` (${failed.length} turns not labelled)` : ""}`,
    ...file.turns.flatMap((turn) => turn.numerals.filter((n) => n.verdict === "wrong").map((n) =>
      `  wrong ${turn.question} turn ${turn.turn}: ${n.text} (data: ${n.expected === undefined ? "?" : Number(n.expected.toPrecision(6))}${n.reason ? `, ${n.reason}` : ""}): ${sentenceAt(turn.text, n.start, n.end)}`)),
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
      "- sign is the sign of the marked figure itself, not of the trend around it: \"-\" for a loss, or a change stated as a decline (\"fell 5%\"); \"+\" for a change stated as a gain (\"rose 5%\"); null otherwise. In \"margin fell to 60.5%\", 60.5% is a level, so its sign is null;",
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
