// An entailment judge for analyst inferences (#302, #301 option 3). With
// assertions rendered, every figure, company and period on the page is a
// packet template's; the model's own words survive only in an inference's
// text, and no English matcher can tell whether they mean what the figures
// show ("margins are expanding" beside a checked "fell"). A second model reads
// each inference beside what it rests on and the rest of the answer, as the
// reader sees them, and gives it a verdict, each inference in a call of its
// own (#376). The verdict sets what a chat turn shows (SHOWN_AS,
// answer-trace.ts answerTurn): an entailed inference as an analyst inference,
// an unsupported one labelled an unverified analyst view; one that
// contradicts the figures, states an amount in words, or got no verdict stays
// hidden.

import { createLlmRouterFromEnv, type LlmChatClient, type LlmChatMessage, type LlmSettingsLoaderEnv } from "../../llm/src/index.ts";
import type { ModelExchange } from "./answer-trace.ts";
import type { Assertion } from "./assertions.ts";
import type { EvidencePacket } from "./evidence-packet.ts";
import { withDeadlines, type ModelDeadlines } from "./llm-runtime.ts";
import { checkedResults, plainText, renderAssertion } from "./render-assertions.ts";

// One accepted inference and what it rests on, as the page shows them.
export type JudgeCase = {
  index: number;
  // The company it is about: its label's, or a one-company answer's.
  subject?: string;
  text: string;
  // Its label: what the comparisons it rests on checked.
  checked: ReadonlyArray<string>;
  // Each support's rendered text, its figures the packet's values.
  supports: ReadonlyArray<string>;
  // The answer's other observations and comparisons, rendered the same way:
  // the reader sees them on the same page.
  context: ReadonlyArray<string>;
};

export const VERDICTS = ["entailed", "unsupported", "contradicted", "worded_amount"] as const;
export type Verdict = (typeof VERDICTS)[number];

export type InferenceVerdict =
  | { index: number; verdict: Verdict; reason?: string }
  // The judge gave no usable verdict: never read as entailed.
  | { index: number; verdict: "error"; reason: string };

// What the reader is shown of an inference, by its verdict. An unsupported
// one goes beyond the figures without contradicting them, so it shows,
// labelled as such (render-assertions.ts unverifiedInference).
export const SHOWN_AS: Readonly<Record<InferenceVerdict["verdict"], "shown" | "unverified" | "hidden">> = {
  entailed: "shown",
  unsupported: "unverified",
  contradicted: "hidden",
  worded_amount: "hidden",
  error: "hidden",
};

// What one judge call did: everything its verdicts are read from
// (verdictsOf), so a recorded turn replays them without a model.
export type JudgeRecord =
  // No model was asked: none is configured, or there was nothing to judge.
  | { outcome: "not_called"; reason: string }
  // What the judge was sent and wrote, raw.
  | { outcome: "replied"; exchange: ModelExchange }
  // The router could not be built, or the call failed or ran out of time.
  | { outcome: "failed"; reason: string; latency_ms: number };

// The reader waits on the judge for each inference, with the figures shown;
// the deadlines are per call, one call per inference. Measured on Haiku over
// the 14 recorded traces' 12 judged answers, when one call judged all of an
// answer's 1 to 3 inferences: 2.4 to 6.6 s, about 10 ms per output token plus
// a second, so a call of one is no slower. One attempt of 1.5 times the
// slowest: the judge model has no fallback (JUDGE_LITELLM_MODEL alone), and a
// late verdict only costs its inference, which stays hidden.
// ceil(11000 / 10000) - 1 = 1 attempt.
export const JUDGE_DEADLINES: ModelDeadlines = { attemptMs: 10_000, totalMs: 11_000 };

type Accepted = Assertion & { index: number };

export function judgeCases(accepted: ReadonlyArray<Accepted>, packet: EvidencePacket, factBlocks: ReadonlyArray<Record<string, unknown>>): JudgeCase[] {
  const rendered = (entry: Accepted) => plainText(renderAssertion(entry, packet, factBlocks, accepted).segments);
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
  const router = await createLlmRouterFromEnv(input.env, { createClient: input.createClient, purpose: "judge" })
    .catch((error: unknown) => (error instanceof Error ? error : new Error(String(error))));
  if (router instanceof Error) return { outcome: "failed", reason: `judge model could not be configured: ${router.message}`, latency_ms: 0 };
  if (!router) return { outcome: "not_called", reason: "no judge model is configured" };
  const messages = judgeMessages(input.cases, input.companies);
  const startedAt = performance.now();
  const result = await router.complete({ messages, reasoning: "low", maxTokens: 4096 }, withDeadlines(input.deadlines ?? JUDGE_DEADLINES))
    .catch((error: unknown) => (error instanceof Error ? error : new Error(String(error))));
  const latency_ms = Math.round(performance.now() - startedAt);
  if (result instanceof Error) return { outcome: "failed", reason: `judge call failed: ${result.message}`, latency_ms };
  return {
    outcome: "replied",
    exchange: {
      messages,
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
        inferences: cases.map(({ index, subject, text, checked, supports, context }) => ({
          id: index,
          subject: subject ?? null,
          text,
          checked_results: checked,
          supports,
          rest_of_answer: context,
        })),
      }),
    },
  ];
}

// A verdict per case. A reply with no verdict list leaves every case an error;
// a case with no well-formed verdict of its own is one too.
export function parseVerdicts(text: string, cases: ReadonlyArray<JudgeCase>): InferenceVerdict[] {
  const items = lastVerdictList(text);
  if (items === undefined) return cases.map(({ index }) => ({ index, verdict: "error", reason: "the judge's reply is not a verdict list" }));
  return cases.map(({ index }): InferenceVerdict => {
    const mine = items.filter((item) => (item as { id?: unknown } | null)?.id === index);
    if (mine.length !== 1) return { index, verdict: "error", reason: mine.length === 0 ? "no verdict for this inference" : "more than one verdict for this inference" };
    const { verdict, reason } = mine[0] as { verdict?: unknown; reason?: unknown };
    if (!VERDICTS.includes(verdict as Verdict)) return { index, verdict: "error", reason: `unknown verdict ${JSON.stringify(verdict)}` };
    return { index, verdict: verdict as Verdict, ...(typeof reason === "string" && reason.trim() !== "" ? { reason: reason.trim() } : {}) };
  });
}

// The reply's last verdict list: a model that corrects itself in prose
// ("Correction: ... Final answer:") writes its final list last.
function lastVerdictList(text: string): unknown[] | undefined {
  const end = text.lastIndexOf("}") + 1;
  for (let start = text.lastIndexOf("{", end); start >= 0; start = text.lastIndexOf("{", start - 1)) {
    try {
      const verdicts = (JSON.parse(text.slice(start, end)) as { verdicts?: unknown } | null)?.verdicts;
      if (Array.isArray(verdicts)) return verdicts;
    } catch {
      // Not a whole object from here: try the brace before.
    }
    if (start === 0) break;
  }
  return undefined;
}

const JUDGE_INSTRUCTIONS = [
  "You check the analyst inferences in a financial research answer. The reader sees each inference beside",
  "what it rests on: its supports (the observations, comparisons and management attributions it cites, each",
  "figure as the data gives it, each claim as its source words it), the checked results of the comparisons among",
  "them, and its subject, the company it is about. rest_of_answer is the answer's other observations and",
  "comparisons, as the reader sees them on the same page. companies lists every company the answer covers.",
  "Judge each inference only against its own subject, checked results, supports and rest_of_answer; no outside",
  "knowledge, and nothing from another inference. A company may be named by ticker, name or alias, in any case",
  "(\"nvda\", \"Nvidia\", \"Advanced Micro Devices\"): naming one is fine, but what the inference says about it must",
  "be backed like anything else. Qualitative words that summarise the figures shown (large, concentrated, higher,",
  "slowing) are fine when the figures bear them out, and so is a count of the things they list (\"the two",
  "companies\", \"four segments\").",
  "",
  "Give each inference one verdict. When more than one applies, the first in this list wins:",
  "- worded_amount: it states an amount or quantity in words, whether or not the figures bear it out:",
  "  money, a percentage, a growth rate, a multiple or fraction (\"doubled\", \"four times\", \"two-thirds\"),",
  "  or a span of time (\"an eight-month gap\"), e.g. \"hundreds of millions of dollars\", \"a quarter",
  "  billion dollars\", \"one and a half percent\", \"single-digit growth\".",
  "- contradicted: something it says disagrees with the figures or checked results shown: who leads, trails, is",
  "  highest or lowest, or the order it states; a direction it states (rising, falling, expanding, recovering)",
  "  against a checked trend or the figures; or any other statement the figures shown make false.",
  "- unsupported: it contradicts nothing shown but claims something the answer neither states nor implies, such",
  "  as a cause, a forecast, a trend, or a metric, segment or period not shown. A hedge does not make it",
  "  supported: a valuation or market reading such as \"may be priced in\" or \"the market may already reflect\" is",
  "  unsupported unless the answer shows it.",
  "- entailed: its supports and the rest of the answer state or clearly imply what it says.",
  "",
  "Reply with JSON only, one verdict per inference id; if you correct yourself, the last JSON in the reply is read:",
  '{"verdicts":[{"id":<id>,"verdict":"entailed"|"unsupported"|"contradicted"|"worded_amount","reason":"<one short sentence>"}]}',
  "Give a reason for every verdict but entailed; for entailed, leave it out.",
].join("\n");
