// An entailment judge for analyst inferences (#302, #301 option 3). With
// assertions rendered, every figure, company and period on the page is a
// packet template's; the model's own words survive only in an inference's
// text, and no English matcher can tell whether they mean what the figures
// show ("margins are expanding" beside a checked "fell"). A second model reads
// each inference beside what it rests on, the rest of the answer and the
// figures its tables show (a chart by each line's last value), each figure as
// the page writes it, and gives it a verdict, each inference in a call of its
// own (#376). The verdict sets what a chat turn shows (verdicts.ts shownAs,
// answer-trace.ts answerTurn).

import { createLlmRouterFromEnv, type LlmChatClient, type LlmChatMessage, type LlmChatRequest, type LlmPurpose, type LlmSettingsLoaderEnv } from "../../llm/src/index.ts";
import { isRecord } from "../../shared/src/http.ts";
import type { ModelExchange } from "./answer-trace.ts";
import type { Assertion } from "./assertions.ts";
import type { EvidencePacket } from "./evidence-packet.ts";
import { withDeadlines, type ModelDeadlines } from "./llm-runtime.ts";
import { checkedResults, plainText, renderAssertion } from "./render-assertions.ts";
import { VERDICTS, type InferenceVerdict, type Verdict } from "./verdicts.ts";

// One accepted inference and what it rests on, each figure as the page writes it.
export type JudgeCase = {
  index: number;
  // The company it is about: its label's, or a one-company answer's.
  subject?: string;
  text: string;
  // Its label: what the comparisons it rests on checked.
  checked: ReadonlyArray<string>;
  // Each support's rendered text, its figures the packet's values.
  supports: ReadonlyArray<string>;
  // The answer's other accepted observations and comparisons, rendered the
  // same way; the page may show an observation only inside a comparison.
  context: ReadonlyArray<string>;
  // Every figure the page's tables show, a chart by each line's last value, a
  // line per table title (tables that share one, or have none, share a line);
  // the same for each of an answer's inferences.
  figures: ReadonlyArray<string>;
};

// What one model call did: everything read from it (verdictsOf, a repair's
// list), so a recorded turn replays it without a model.
export type ModelRecord =
  // No model was asked: none is configured, or there was nothing to ask.
  | { outcome: "not_called"; reason: string }
  // What the model was sent and wrote, raw.
  | { outcome: "replied"; exchange: ModelExchange }
  // The router could not be built, or the call failed or ran out of time.
  | { outcome: "failed"; reason: string; latency_ms: number };
export type JudgeRecord = ModelRecord;

// The reader waits on the judge for each inference, with the figures shown;
// the deadlines are per call, one call per inference. Measured on Haiku over
// 623 calls carrying figures_shown (the recorded traces and 14 mutation runs,
// 2026-10-22): median 3.0 s, p95 5.1 s, p99 6.5 s, slowest 9.5 s. One attempt
// of about 1.6 times the slowest: the judge model has no fallback
// (JUDGE_LITELLM_MODEL alone), and a late verdict costs its inference, which
// stays hidden; a judge that hangs holds that inference's line for the attempt.
// ceil(16000 / 15000) - 1 = 1 attempt.
export const JUDGE_DEADLINES: ModelDeadlines = { attemptMs: 15_000, totalMs: 16_000 };

type Accepted = Assertion & { index: number };

export function judgeCases(accepted: ReadonlyArray<Accepted>, packet: EvidencePacket, factBlocks: ReadonlyArray<Record<string, unknown>>): JudgeCase[] {
  const rendered = (entry: Accepted) => plainText(renderAssertion(entry, packet, factBlocks, accepted).segments);
  const tables = new Map<string | undefined, string[]>();
  for (const figure of packet.figures) {
    if (figure.displayed !== false) tables.set(figure.shown_in, [...(tables.get(figure.shown_in) ?? []), figure.id]);
  }
  const figures = [...tables].map(([title, ids]) => {
    const line = rendered({ index: -1, kind: "observation", text: "", evidence: ids });
    return title === undefined ? line : `${title}: ${line}`;
  });
  return accepted.filter((assertion) => assertion.kind === "analyst_inference").map((inference) => {
    const subject = inference.subject ?? (packet.companies.length === 1 ? packet.companies[0] : undefined);
    const supports = inference.supports ?? [];
    return {
      index: inference.index,
      ...(subject ? { subject } : {}),
      text: inference.text,
      checked: checkedResults(inference, packet, accepted),
      supports: supports.flatMap((n) => {
        const support = accepted.find((entry) => entry.index === n);
        return support ? [rendered(support)] : [];
      }),
      context: accepted
        .filter((entry) => (entry.kind === "observation" || entry.kind === "comparison") && !supports.includes(entry.index))
        .map(rendered),
      figures,
    };
  });
}

// The given inferences in one call (a chat turn gives one, answer-trace.ts
// judgeOne); never rejects. No temperature: current Claude models reject one
// (pi-adapter.ts).
export async function judgeInferences(input: {
  cases: ReadonlyArray<JudgeCase>;
  companies: ReadonlyArray<string>;
  env: LlmSettingsLoaderEnv;
  createClient?: () => Promise<LlmChatClient> | LlmChatClient;
  deadlines?: ModelDeadlines;
}): Promise<JudgeRecord> {
  if (input.cases.length === 0) return { outcome: "not_called", reason: "no inference to judge" };
  return modelCall({
    what: "judge",
    purpose: "judge",
    env: input.env,
    ...(input.createClient ? { createClient: input.createClient } : {}),
    request: { messages: judgeMessages(input.cases, input.companies), reasoning: "low", maxTokens: 4096 },
    deadlines: input.deadlines ?? JUDGE_DEADLINES,
  });
}

// One call, as a record; never rejects. what names the call in a reason.
export async function modelCall(input: {
  what: string;
  purpose?: LlmPurpose;
  env: LlmSettingsLoaderEnv;
  createClient?: () => Promise<LlmChatClient> | LlmChatClient;
  request: LlmChatRequest;
  deadlines: ModelDeadlines;
}): Promise<ModelRecord> {
  const router = await createLlmRouterFromEnv(input.env, { createClient: input.createClient, ...(input.purpose ? { purpose: input.purpose } : {}) })
    .catch((error: unknown) => (error instanceof Error ? error : new Error(String(error))));
  if (router instanceof Error) return { outcome: "failed", reason: `${input.what} model could not be configured: ${router.message}`, latency_ms: 0 };
  if (!router) return { outcome: "not_called", reason: `no ${input.what} model is configured` };
  const startedAt = performance.now();
  const result = await router.complete(input.request, withDeadlines(input.deadlines))
    .catch((error: unknown) => (error instanceof Error ? error : new Error(String(error))));
  const latency_ms = Math.round(performance.now() - startedAt);
  if (result instanceof Error) return { outcome: "failed", reason: `${input.what} call failed: ${result.message}`, latency_ms };
  return {
    outcome: "replied",
    exchange: {
      messages: input.request.messages,
      text: result.text,
      truncated: result.truncated === true,
      deployment: `${result.deployment.channel}/${result.deployment.model}`,
      latency_ms,
      ...(result.usage ? { usage: { input_tokens: result.usage.inputTokens, output_tokens: result.usage.outputTokens } } : {}),
    },
  };
}

// A verdict per case from what the judge did: a reply's own verdicts, and an
// error for each case when there is none to read.
export function verdictsOf(cases: ReadonlyArray<JudgeCase>, record: JudgeRecord): InferenceVerdict[] {
  const failed = (reason: string) => cases.map(({ index }): InferenceVerdict => ({ index, verdict: "error", reason }));
  if (record.outcome !== "replied") return failed(record.reason);
  if (record.exchange.truncated) return failed("the judge's reply was cut off");
  return parseVerdicts(record.exchange.text, cases);
}

export function judgeMessages(cases: ReadonlyArray<JudgeCase>, companies: ReadonlyArray<string>): LlmChatMessage[] {
  return [
    { role: "system", content: JUDGE_INSTRUCTIONS },
    {
      role: "user",
      content: JSON.stringify({
        companies,
        inferences: cases.map(({ index, subject, text, checked, supports, context, figures }) => ({
          id: index,
          subject: subject ?? null,
          text,
          checked_results: checked,
          supports,
          rest_of_answer: context,
          figures_shown: figures,
        })),
      }),
    },
  ];
}

// A verdict per case. A reply with no verdict list leaves every case an error;
// a case with no well-formed verdict of its own is one too.
export function parseVerdicts(text: string, cases: ReadonlyArray<JudgeCase>): InferenceVerdict[] {
  const items = lastVerdictList(text);
  if (typeof items === "string") return cases.map(({ index }) => ({ index, verdict: "error", reason: items }));
  return cases.map(({ index }): InferenceVerdict => {
    const mine = items.filter(isRecord).filter((item) => item.id === index);
    if (mine.length !== 1) return { index, verdict: "error", reason: mine.length === 0 ? "no verdict for this inference" : "more than one verdict for this inference" };
    const { verdict, worded_amount, reason } = mine[0]!;
    if (!isVerdict(verdict)) return { index, verdict: "error", reason: `unknown verdict ${JSON.stringify(verdict)}` };
    if (typeof worded_amount !== "boolean") return { index, verdict: "error", reason: "no worded_amount for this inference" };
    return { index, verdict, worded_amount, ...(typeof reason === "string" && reason.trim() !== "" ? { reason: reason.trim() } : {}) };
  });
}

function isVerdict(value: unknown): value is Verdict {
  return VERDICTS.some((verdict) => verdict === value);
}

// The reply's verdict list, read only when it ends the reply, bar whitespace
// and the code fence around it: a model that corrects itself ("Correction:
// ... Final answer:") writes its final list last, and anything after a whole
// list, a correction cut off in any shape or prose, leaves the reply with no
// final verdict, whether or not the call reported a cut (#477 review).
function lastVerdictList(text: string): unknown[] | string {
  const end = text.lastIndexOf("}") + 1;
  for (let start = text.lastIndexOf("{", end); start >= 0; start = text.lastIndexOf("{", start - 1)) {
    try {
      const verdicts = (JSON.parse(text.slice(start, end)) as { verdicts?: unknown } | null)?.verdicts;
      if (Array.isArray(verdicts)) return /^\s*(?:```\s*)?$/.test(text.slice(end)) ? verdicts : "the judge's reply does not end with its verdict list";
    } catch {
      // Not a whole object from here: try the brace before.
    }
    if (start === 0) break;
  }
  return "the judge's reply is not a verdict list";
}

const JUDGE_INSTRUCTIONS = [
  "You check the analyst inferences in a financial research answer. Each inference comes with what it rests on:",
  "its supports (the observations, comparisons and management attributions it cites, each figure as the data",
  "gives it, each claim as its source words it), the checked results of the comparisons among them, and its",
  "subject, the company it is about. rest_of_answer is the answer's other checked observations and comparisons,",
  "written the same way; the page may show one of them inside a comparison that states its figures.",
  "figures_shown holds the figures the page's tables and charts show, a line per table, headed by its title when it",
  "has one. companies lists every company the answer covers; rest_of_answer and figures_shown cover every one of",
  "them, and an inference may rest on another company's figures when it compares them. Judge each inference",
  "against its subject, checked results, supports, rest_of_answer and figures_shown; no outside knowledge, and",
  "nothing from another inference. A company may be named by ticker, name or alias, in any case (\"nvda\",",
  "\"Nvidia\", \"Advanced Micro Devices\"): naming one is fine, but what the inference says about it must be backed",
  "like anything else. Qualitative words that summarise the figures (large, concentrated, higher, slowing) are",
  "fine when the figures bear them out, and so is an exact count of the items the answer lists (\"the two",
  "companies\", \"four segments\", \"the eight quarters shown\"). That covers no duration and no difference between",
  "dates or values (\"a one-month offset\", \"an eight-month gap\"): those are amounts in words.",
  "",
  "Answer two questions about each inference.",
  "",
  "verdict: how it relates to what the answer shows. When both unsupported and contradicted apply, contradicted wins.",
  "- entailed: its supports, the rest of the answer and the figures shown state or clearly imply what it says.",
  "- unsupported: it contradicts nothing shown but claims something the answer neither states nor implies, such",
  "  as a cause, a forecast, a trend, or a metric, segment or period not shown. A hedge does not make it",
  "  supported: a valuation or market reading such as \"may be priced in\" or \"the market may already reflect\" is",
  "  unsupported unless the answer shows it.",
  "- contradicted: something it says disagrees with the figures or checked results shown: who leads, trails, is",
  "  highest or lowest, or the order it states; a direction it states (rising, falling, expanding, recovering)",
  "  against a checked trend or the figures; or any other statement the figures shown make false.",
  "",
  "worded_amount, whatever its verdict: true when the inference's own words state any amount, fraction, multiple",
  "or span of time, even when the figures bear it out: money, a percentage, a growth rate, a multiple or fraction",
  "(\"doubled\", \"four times\", \"two-thirds\"), or a duration or a difference between dates or values (\"a",
  "one-month offset\", \"an eight-month gap\"), e.g. \"hundreds of millions of dollars\", \"a quarter billion",
  "dollars\", \"one and a half percent\", \"single-digit growth\". An exact count of the items the answer lists",
  "(\"the two companies\", \"four segments\", \"the eight quarters shown\") is not one, and neither is a word that",
  "names no quantity (\"the gap\", \"the offset\", \"higher\"), whatever the figures say. Otherwise false.",
  "",
  "Reply with JSON only, one verdict per inference id; if you correct yourself, the last JSON in the reply is read:",
  '{"verdicts":[{"id":<id>,"verdict":"entailed"|"unsupported"|"contradicted","worded_amount":true|false,"reason":"<one short sentence>"}]}',
  "Give a reason for every verdict but entailed, and whenever worded_amount is true; otherwise leave it out.",
].join("\n");
