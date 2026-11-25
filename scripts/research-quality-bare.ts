// The research-quality eval's bare arm (#781): the same questions to the same model, with
// the frozen golden dataset written into the request and no chat pipeline, so a blinded
// pair against an app run measures what the pipeline adds.
//
//   node --experimental-strip-types scripts/research-quality-bare.ts run [--model anthropic/<model>]
//   node --experimental-strip-types scripts/research-quality-pairs.ts pair <app.run.json> <bare.run.json>
//   node --experimental-strip-types scripts/research-quality-figures.ts check <run.json>...
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { FROZEN_AS_OF } from "../services/chat/src/ytd-hydration.ts";
import {
  AMD_Q2_2025_RELEASE,
  GOLDEN_AS_OF,
  GOLDEN_COMPANIES,
  GOLDEN_ISSUER_FACTS,
  goldenDailyBars,
  type GoldenIssuerFact,
} from "../services/chat/test/golden/dataset.ts";
import {
  BLIND_RUNS_DIR,
  ROOT,
  Refusal,
  blankScores,
  renderReport,
  runCli,
  runProvenance,
  runStamp,
  serializeRun,
  type AnsweredQuestion,
  type AnsweredTurn,
  type RunRecord,
} from "./research-quality-eval.ts";
import { QUESTIONS, type EvalQuestion } from "./research-quality-questions.ts";

// --- data brief -------------------------------------------------------------------

const day = (instant: string) => instant.slice(0, 10);
const millions = (usd: number) => (usd / 1e6).toLocaleString("en-US", { maximumFractionDigits: 6 });
const fiscalLabel = (fact: Pick<GoldenIssuerFact, "fiscal_year" | "fiscal_period">) =>
  fact.fiscal_period === "FY" ? `FY${fact.fiscal_year}` : `${fact.fiscal_period} FY${fact.fiscal_year}`;
const row = (cells: ReadonlyArray<string | number>) => `| ${cells.join(" | ")} |`;
const table = (header: ReadonlyArray<string>, rows: ReadonlyArray<ReadonlyArray<string | number>>) =>
  [row(header), `|${header.map(() => "---").join("|")}|`, ...rows.map(row)];

const STATEMENT_COLUMNS = { revenue: "Revenue", gross_profit: "Gross profit", operating_income: "Operating income", net_income: "Net income" } as const;

// Every value seedGoldenDataset loads, as the document the bare arm reads, built from the
// dataset module's own exports so it can't drift from the seed. Ids and the provider
// rows the seed also writes carry nothing an analyst reads, so they're left out.
export function dataBrief(): string {
  const lines = [
    `# Company data on file as of ${day(GOLDEN_AS_OF)}`,
    "",
    `Statement figures are as reported (consolidated, unadjusted), in USD millions, each filed by ${day(GOLDEN_AS_OF)}.`,
    "Prices are in USD; daily bars are split-adjusted end-of-day bars and exclude dividends.",
  ];
  for (const company of GOLDEN_COMPANIES) {
    const facts = GOLDEN_ISSUER_FACTS.filter((fact) => fact.issuer_id === company.issuer_id);
    const statement = (kind: GoldenIssuerFact["period_kind"]) => {
      const periods = [...new Map(facts.filter((fact) => fact.period_kind === kind).map((fact) => [fact.key.split(".").slice(0, 3).join("."), fact])).values()];
      return table(
        ["Fiscal period", "Period start", "Period end", ...Object.values(STATEMENT_COLUMNS)],
        periods.map((period) => [
          fiscalLabel(period),
          period.period_start,
          period.period_end,
          ...Object.keys(STATEMENT_COLUMNS).map((metric) => millions(facts.find((fact) => fact.fiscal_year === period.fiscal_year && fact.fiscal_period === period.fiscal_period && fact.metric_key === metric)!.value_usd)),
        ]),
      );
    };
    lines.push(
      "",
      `## ${company.ticker}: ${company.legal_name}`,
      "",
      `CIK ${company.cik}. Sector: ${company.sector}. Industry: ${company.industry}. Listed on XNAS as ${company.ticker}, trading in USD.`,
      "",
      "### Quarterly income statement (USD millions)",
      "",
      ...statement("fiscal_q"),
      "",
      "### Annual income statement (USD millions)",
      "",
      ...statement("fiscal_y"),
    );
    if (company.segments) {
      const { fiscal_year, fiscal_period, revenue } = company.segments;
      const quarter = company.quarters.find((q) => q.fiscal_year === fiscal_year && q.fiscal_period === fiscal_period)!;
      lines.push(
        "",
        `### Revenue by business segment, ${fiscalLabel({ fiscal_year, fiscal_period })} (${quarter.period_start} to ${quarter.period_end}), USD millions`,
        "",
        ...table(["Segment", "Revenue"], revenue.map(([name, value]) => [name, millions(value * 1e6)])),
      );
    }
    lines.push(
      "",
      `### Quote as of ${day(GOLDEN_AS_OF)} (end of day, USD)`,
      "",
      `Last price ${company.quote.price.toFixed(2)}; previous close ${company.quote.prev_close.toFixed(2)}.`,
      "",
      "### Daily bars (split-adjusted, end of day, USD; volume in shares)",
      "",
      ...table(
        ["Session", "Open", "High", "Low", "Close", "Volume"],
        goldenDailyBars(company).map((bar) => [day(bar.ts), bar.open.toFixed(2), bar.high.toFixed(2), bar.low.toFixed(2), bar.close.toFixed(2), bar.volume.toLocaleString("en-US")]),
      ),
    );
  }
  const release = AMD_Q2_2025_RELEASE;
  const amd = GOLDEN_COMPANIES.find((company) => company.ticker === "AMD")!;
  const quarter = amd.quarters.find((q) => q.period_end === release.period.end)!;
  lines.push(
    "",
    "## Filed explanations",
    "",
    `AMD, on its ${fiscalLabel(quarter)} (quarter ended ${release.period.end}), in "${release.title}", published ${day(release.published_at)} (${release.url}):`,
    "",
    `> ${release.text}`,
  );
  return `${lines.join("\n")}\n`;
}

// The bare arm's instructions, as decided for #781. They name no eval, test, score or
// comparison, so the model answers as it would for anyone.
export function systemPrompt(question: EvalQuestion, brief = dataBrief()): string {
  const subject = question.turns.find((turn) => turn.subjectText)?.subjectText;
  return [
    `You are an equity research analyst at a long-only fund, answering a portfolio manager in chat. Use only the company data below. It is everything on file as of ${day(FROZEN_AS_OF)}. When the data does not cover something the question asks, say so plainly. Do not add facts or figures from outside the data.`,
    ...(subject ? [`The portfolio manager opened this conversation from the ${subject} page.`] : []),
    brief,
  ].join("\n\n");
}

// --- Messages API -------------------------------------------------------------------

// Raw HTTP rather than the SDK, since scripts/ has no dependency tree and CI installs none for it.
export const MESSAGES_URL = "https://api.anthropic.com/v1/messages";
export const ANTHROPIC_VERSION = "2026-10-21";

export type ContentBlock = Record<string, unknown> & { type: string };
export type Usage = { input_tokens: number; output_tokens: number };
export type MessagesResult =
  | { ok: true; model: string; content: ContentBlock[]; text: string; stopReason: string | null; usage: Usage }
  | { ok: false; outcome: "provider_error" | "timeout"; error: string; status?: number };
type Attempt = MessagesResult | (Extract<MessagesResult, { ok: false }> & { transient: boolean; retryAfterMs?: number });
export type CallOptions = { apiKey: string; fetch?: typeof fetch; timeoutMs?: number; retryDelayMs?: number };
export type CallMessages = (body: Record<string, unknown>) => Promise<MessagesResult>;

// Stream errors a retry may clear, like a 429 or 5xx status before the stream starts.
const TRANSIENT_STREAM_ERRORS = new Set(["overloaded_error", "api_error", "rate_limit_error"]);

// One streamed request (streaming keeps a long answer under fetch's header timeout),
// retried once on 429, 5xx, an overloaded or server error mid-stream, a dropped
// connection before or during the stream, or a stream that ends before message_stop;
// anything else, or a second failure, is the turn's provider error.
export async function callMessages(body: Record<string, unknown>, options: CallOptions): Promise<MessagesResult> {
  const first = await attempt(body, options);
  if (first.ok || !("transient" in first) || !first.transient) return strip(first);
  await new Promise((done) => setTimeout(done, first.retryAfterMs ?? options.retryDelayMs ?? 10_000));
  return strip(await attempt(body, options));
}

function strip(result: Attempt): MessagesResult {
  if (result.ok) return result;
  const { outcome, error, status } = result;
  return { ok: false, outcome, error, ...(status === undefined ? {} : { status }) };
}

async function attempt(body: Record<string, unknown>, { apiKey, fetch: send = fetch, timeoutMs = 600_000 }: CallOptions): Promise<Attempt> {
  try {
    const response = await send(MESSAGES_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": ANTHROPIC_VERSION },
      body: JSON.stringify({ ...body, stream: true }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      const retryAfter = Number(response.headers.get("retry-after"));
      // A body that breaks mid-read still leaves the status, which decides the retry.
      const detail = await response.text().then((text) => text.slice(0, 500), (error: Error) => `(body unreadable: ${String(error.cause ?? error)})`);
      return {
        ok: false,
        outcome: "provider_error",
        status: response.status,
        error: `HTTP ${response.status}: ${detail}`,
        transient: response.status === 429 || response.status >= 500,
        ...(retryAfter > 0 ? { retryAfterMs: Math.min(retryAfter, 60) * 1000 } : {}),
      };
    }
    return await readStream(response);
  } catch (error) {
    if ((error as Error).name === "TimeoutError") return { ok: false, outcome: "timeout", error: `no answer within ${timeoutMs / 1000}s`, transient: false };
    // fetch's own network failure; any other error is a bug and keeps its stack.
    if (error instanceof TypeError && error.message === "fetch failed") return { ok: false, outcome: "provider_error", error: String(error.cause ?? error), transient: true };
    throw error;
  }
}

// The server-sent events of one message: its blocks (thinking kept with its signature,
// so a follow-up can send the turn back unchanged), stop reason and token counts.
async function readStream(response: Response): Promise<Attempt> {
  const content: ContentBlock[] = [];
  let model = "";
  let stopReason: string | null = null;
  let usage: Record<string, number> = {};
  let buffer = "";
  let stopped = false;
  const handle = (event: Record<string, any>): Attempt | undefined => {
    if (event.type === "message_stop") {
      stopped = true;
    } else if (event.type === "message_start") {
      model = event.message.model;
      usage = { ...event.message.usage };
    } else if (event.type === "content_block_start") {
      content[event.index] = { ...event.content_block };
    } else if (event.type === "content_block_delta") {
      const block = content[event.index]!;
      // text_delta, thinking_delta and signature_delta each extend the block's field of that name.
      const { type: _type, ...delta } = event.delta as Record<string, unknown>;
      for (const [key, value] of Object.entries(delta)) if (typeof value === "string") block[key] = `${(block[key] as string | undefined) ?? ""}${value}`;
    } else if (event.type === "message_delta") {
      stopReason = event.delta.stop_reason ?? stopReason;
      usage = { ...usage, ...event.usage };
    } else if (event.type === "error") {
      return { ok: false, outcome: "provider_error", error: `${event.error.type}: ${event.error.message}`, transient: TRANSIENT_STREAM_ERRORS.has(event.error.type) };
    }
    return undefined;
  };
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
  try {
    for (;;) {
      let next: ReadableStreamReadResult<string>;
      // Only the read is caught: a transport failure mid-stream is the provider's, like a
      // dropped connection before it, while a parse or programming error keeps its stack.
      try {
        next = await reader.read();
      } catch (error) {
        if ((error as Error).name === "TimeoutError") return { ok: false, outcome: "timeout", error: "the answer stream timed out", transient: false };
        return { ok: false, outcome: "provider_error", error: `the answer stream broke: ${String((error as Error).cause ?? error)}`, transient: true };
      }
      if (next.done) break;
      buffer += next.value;
      let end: number;
      while ((end = buffer.indexOf("\n\n")) !== -1) {
        const data = buffer.slice(0, end).split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("");
        buffer = buffer.slice(end + 2);
        const failed = data === "" ? undefined : handle(JSON.parse(data));
        if (failed) return failed;
      }
    }
  } finally {
    // An early return or a throw leaves the connection open, so close it. Its own failure
    // only means the stream already broke, which the result above reports.
    void reader.cancel().catch(() => undefined);
  }
  if (!stopped) return { ok: false, outcome: "provider_error", error: "the answer stream ended before message_stop", transient: true };
  const text = content.filter((block) => block.type === "text").map((block) => block.text as string).join("").trim();
  return {
    ok: true,
    model,
    content,
    text,
    stopReason,
    usage: {
      input_tokens: (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0),
      output_tokens: usage.output_tokens ?? 0,
    },
  };
}

// --- run --------------------------------------------------------------------------

export const DEFAULT_BARE_MODEL = "anthropic/claude-sonnet-5-5";
export const BARE_MAX_TOKENS = 8192;
// output_config.effort. Unset, the API thinks at its default effort; the app's answer
// model asks for "low" (services/chat/src/llm-runtime.ts), so --effort low matches it.
export const EFFORTS = ["low", "medium", "high", "max"] as const;
export type Effort = (typeof EFFORTS)[number];

export type BareTurn = AnsweredTurn & { stopReason: string | null; thinkingBlocks: number };
// What was sent, so a later reader knows the arm. The pairing packet shows only
// questions and answer blocks, never these fields.
export type BareRequest = {
  endpoint: string;
  anthropic_version: string;
  model: string;
  max_tokens: number;
  effort: Effort | null;
  stream: true;
  // Left to the API's defaults.
  not_sent: string[];
  data_brief_sha256: string;
  retry: string;
};
export type BareRunRecord = Omit<RunRecord, "questions"> & { arm: "bare"; request: BareRequest; questions: Array<Omit<AnsweredQuestion, "turns"> & { turns: BareTurn[] }> };

// channel/model as chat records answered_by, so the pair tool compares one model in both arms.
export function bareModel(flag = DEFAULT_BARE_MODEL): { channel: "anthropic"; model: string } {
  const slash = flag.indexOf("/");
  const model = flag.slice(slash + 1);
  if (flag.slice(0, slash) !== "anthropic" || model === "") throw new Refusal(`--model ${flag} isn't anthropic/<model>; the bare arm calls the Anthropic Messages API`);
  return { channel: "anthropic", model };
}

export type BareRunOptions = { model?: string; effort?: Effort; call: CallMessages; dir?: string; now?: Date; log?: (line: string) => void };

// One conversation per question, its turns sent in order. Files are created exclusively
// and rewritten after each question, as the app runner's are, so an error late in the run
// keeps every answer before it. A turn after one that failed isn't sent.
export async function runBare({ model: flag, effort, call, dir = BLIND_RUNS_DIR, now = new Date(), log = console.log }: BareRunOptions): Promise<{ record: BareRunRecord; file: string }> {
  const { channel, model } = bareModel(flag);
  const provenance = runProvenance(ROOT);
  const brief = dataBrief();
  const stamp = runStamp(now);
  const record: BareRunRecord = {
    run: stamp,
    model: `${channel}/${model}`,
    blind: true,
    arm: "bare",
    request: {
      endpoint: MESSAGES_URL,
      anthropic_version: ANTHROPIC_VERSION,
      model,
      max_tokens: BARE_MAX_TOKENS,
      effort: effort ?? null,
      stream: true,
      not_sent: ["thinking", ...(effort ? [] : ["output_config"]), "temperature", "top_p", "top_k", "tools", "tool_choice", "metadata"],
      data_brief_sha256: createHash("sha256").update(brief).digest("hex"),
      retry: "once on 429, 5xx, overloaded or a dropped connection",
    },
    provenance,
    planned: QUESTIONS.map((question) => question.id),
    complete: false,
    questions: [],
  };
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${stamp}.run.json`);
  writeFileSync(join(dir, `${stamp}.scores.json`), `${JSON.stringify(blankScores(stamp, record.model), null, 2)}\n`, { flag: "wx" });
  const save = (flag?: "wx") => {
    writeFileSync(join(dir, `${stamp}.md`), renderReport(stamp, record.model, "", record.questions, provenance, record), { flag });
    writeFileSync(file, serializeRun(record), { flag });
  };
  save("wx");
  log(`report: ${join(dir, `${stamp}.md`)}\nrun:    ${file}\n`);
  for (const question of QUESTIONS) {
    const system = systemPrompt(question, brief);
    const messages: Array<{ role: "user" | "assistant"; content: string | ContentBlock[] }> = [];
    const turns: BareTurn[] = [];
    for (const turn of question.turns) {
      if (turns.some((t) => t.outcome !== "completed")) {
        turns.push({ message: turn.message, outcome: "skipped", blocks: [], elapsedMs: null, answeredBy: null, usage: null, stopReason: null, thinkingBlocks: 0 });
        continue;
      }
      messages.push({ role: "user", content: turn.message });
      const startedAt = Date.now();
      const result = await call({ model, max_tokens: BARE_MAX_TOKENS, ...(effort ? { output_config: { effort } } : {}), system, messages: [...messages] });
      const elapsedMs = Date.now() - startedAt;
      if (!result.ok) {
        // A refused key, model or request fails every turn after it too; stop billing.
        if (result.status !== undefined && result.status >= 400 && result.status < 500 && result.status !== 429) {
          save();
          throw new Refusal(`the Messages API refused the request (${result.error}); ${record.questions.length} questions kept in ${file}`);
        }
        log(`${result.outcome}  ${question.id}: ${turn.message}  (${(elapsedMs / 1000).toFixed(1)}s): ${result.error}`);
        turns.push({ message: turn.message, outcome: result.outcome, blocks: [], elapsedMs, answeredBy: null, usage: null, stopReason: null, thinkingBlocks: 0 });
        continue;
      }
      // A refusal is the model declining, as chat counts it (services/llm pi-adapter).
      const outcome = result.stopReason === "refusal" ? "provider_error" : result.text === "" ? "missing_answer" : "completed";
      messages.push({ role: "assistant", content: result.content });
      log(`${outcome}  ${question.id}: ${turn.message}  (${(elapsedMs / 1000).toFixed(1)}s, ${result.usage.input_tokens} in / ${result.usage.output_tokens} out, ${result.stopReason})`);
      turns.push({
        message: turn.message,
        outcome,
        blocks: result.text === "" ? [] : [{ kind: "rich_text", segments: [{ type: "text", text: result.text }] }],
        elapsedMs,
        answeredBy: outcome === "completed" ? `${channel}/${result.model}` : null,
        usage: result.usage,
        stopReason: result.stopReason,
        thinkingBlocks: result.content.filter((block) => block.type === "thinking" || block.type === "redacted_thinking").length,
      });
    }
    record.questions.push({ question, threadId: "", turns });
    record.complete = record.questions.length === record.planned.length;
    save();
  }
  return { record, file };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await runCli(async () => {
    const { positionals: [command], values } = parseArgs({ allowPositionals: true, options: { model: { type: "string" }, effort: { type: "string" } } });
    if (command !== "run") {
      console.error(`usage: research-quality-bare.ts run [--model anthropic/<model>] [--effort ${EFFORTS.join("|")}]`);
      process.exitCode = 2;
      return;
    }
    const effort = values.effort as Effort | undefined;
    if (effort !== undefined && !EFFORTS.includes(effort)) throw new Refusal(`--effort ${effort} isn't one of ${EFFORTS.join(", ")}`);
    const apiKey = process.env.LLM_ANTHROPIC_API_KEY?.trim();
    if (!apiKey) throw new Refusal("set LLM_ANTHROPIC_API_KEY (the app's anthropic channel key) to run the bare arm");
    const startedAt = Date.now();
    const { record, file } = await runBare({ model: values.model, effort, call: (body) => callMessages(body, { apiKey }) });
    const turns = record.questions.flatMap((question) => question.turns);
    const sum = (pick: (usage: NonNullable<BareTurn["usage"]>) => number) => turns.reduce((total, turn) => total + (turn.usage ? pick(turn.usage) : 0), 0);
    console.log(`\ndone: ${record.questions.length} questions, ${turns.filter((turn) => turn.outcome === "completed").length} of ${turns.length} turns completed in ${((Date.now() - startedAt) / 1000).toFixed(1)}s; ${sum((usage) => usage.input_tokens)} input / ${sum((usage) => usage.output_tokens)} output tokens\n${file}`);
  });
}
