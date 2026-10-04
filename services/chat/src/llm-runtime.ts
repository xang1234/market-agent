import {
  createLlmRouterFromEnv,
  type LlmChatClient,
  type LlmExecutionControls,
  type LlmSettingsLoaderEnv,
} from "../../llm/src/index.ts";
import type { ThreadTitleModel } from "../../summary/src/title-generator.ts";
import type {
  ChatAnalystToolRuntimeToolCall,
} from "./coordinator.ts";
import { displayedFigures, displayTextsForBlocks } from "./fact-blocks.ts";
import { keepSupportedSentences } from "./narrative-guard.ts";

// Shown when the guard strips every sentence of the model's prose, or the model gave
// no usable answer (empty, or cut off at the token limit).
const FACT_BLOCKS_FALLBACK_TEXT =
  "The reported figures below come from the company's filings; select any value to see its source.";
// The same case for an answer without figures to point to.
const NO_ANSWER_FALLBACK_TEXT = "No written answer is available for this question; try asking again.";

// A provider can accept a request and never answer (one held a turn 516 s, #184).
// Each attempt gets a deadline, after which the router tries the next deployment: the
// smaller of its own limit and what is left of the total. There is no separate timer
// on the whole call, so every attempt ends on its own deadline and a failure is the
// router's error naming each one, while the chain still ends by the total. Two
// attempts (a primary and its fallback) fit in each budget below.
export type ModelDeadlines = { attemptMs: number; totalMs: number };
export const ANSWER_DEADLINES: ModelDeadlines = { attemptMs: 80_000, totalMs: 180_000 };
export const TITLE_DEADLINES: ModelDeadlines = { attemptMs: 20_000, totalMs: 45_000 };

function withDeadlines(deadlines: ModelDeadlines): LlmExecutionControls {
  const { attemptMs, totalMs } = deadlines;
  if (!Number.isInteger(attemptMs) || !Number.isInteger(totalMs) || attemptMs <= 0 || attemptMs >= totalMs) {
    throw new RangeError(`model deadlines need 0 < attemptMs < totalMs (integers); got ${attemptMs} and ${totalMs}`);
  }
  const endsAt = performance.now() + totalMs;
  return {
    // Only attempts that a full deadline could fit in the total are started.
    maxAttempts: Math.ceil(totalMs / attemptMs) - 1,
    executeAttempt: (_attempt, dispatch) =>
      dispatch(AbortSignal.timeout(Math.max(1, Math.min(attemptMs, Math.floor(endsAt - performance.now()))))),
  };
}

type LlmRuntimeContext = {
  userIntent?: string;
  bundleId: string;
};

type LlmRuntimeOptions = {
  env?: LlmSettingsLoaderEnv;
  createClient?: () => Promise<LlmChatClient> | LlmChatClient;
  deadlines?: ModelDeadlines;
};

export function createLlmThreadTitleModel(options: LlmRuntimeOptions = {}): ThreadTitleModel {
  return async (input) => {
    const router = await createLlmRouterFromEnv(options.env ?? process.env, {
      createClient: options.createClient,
    });
    if (!router) {
      throw new Error("LLM router is not configured");
    }
    const result = await router.complete({
      messages: [
        {
          role: "system",
          content: "Create a short, specific research chat title. Return only the title.",
        },
        {
          role: "user",
          content: [
            `User intent: ${input.userIntent ?? ""}`,
            `Assistant answer: ${input.assistantText}`,
          ].join("\n"),
        },
      ],
      temperature: 0.2,
      // A title is short, but reasoning models think before answering; 32 tokens
      // truncates them mid-thought and yields an empty title. Leave room to reason.
      maxTokens: 512,
      reasoning: "off",
    }, withDeadlines(options.deadlines ?? TITLE_DEADLINES));
    // A cut-off title reads as a typo; the generator falls back to the default one.
    if (result.truncated) throw new Error("thread title was cut off at the token limit");
    return result.text;
  };
}

export async function composeAnalystBlocksWithLlm(input: {
  env?: LlmSettingsLoaderEnv;
  context: LlmRuntimeContext;
  blocks: ReadonlyArray<Record<string, unknown>>;
  toolCalls: ReadonlyArray<ChatAnalystToolRuntimeToolCall>;
  // Deterministic chart/table blocks shown with the answer. When present, the
  // prose may only quote figures they display (or that cited claims state).
  factBlocks?: ReadonlyArray<Record<string, unknown>>;
  // Recent thread messages, oldest first, so the answer reads as a reply.
  conversation?: ReadonlyArray<{ role: string; text: string }>;
  createClient?: () => Promise<LlmChatClient> | LlmChatClient;
  // Receives the sentences the narrative guard dropped, so evals can count them (#144).
  onNarrativeRemoved?: (sentences: ReadonlyArray<string>) => void;
  // Receives the deployment (channel/model) that wrote the answer (#183).
  onAnswered?: (deployment: string) => void;
  // Receives the answer call's token usage, so evals can measure it (#181).
  onUsage?: (usage: AnswerUsage) => void;
  deadlines?: ModelDeadlines;
}): Promise<ReadonlyArray<Record<string, unknown>>> {
  const router = await createLlmRouterFromEnv(input.env ?? process.env, {
    createClient: input.createClient,
  });
  if (!router) return input.blocks;

  const result = await router.complete({
    messages: [
      {
        role: "system",
        content: [
          // The golden replay fixture matches on this opening sentence.
          "Write a concise investment research answer for the chat user.",
          // An analyst's answer, not a list of numbers (#179): the #124 baseline scored
          // conclusions 6/18 and counterarguments 2/18.
          "Answer as a buy-side analyst would, in short plain paragraphs, in this order:",
          "(1) the takeaway: your view, answering the question directly;",
          "(2) the trend across every period shown, not just the latest, in words;",
          "(3) what is strong or weak and why, judged against the other periods or companies shown;",
          "(4) one specific counterpoint grounded in the data that cuts against the takeaway;",
          "(5) what the data shown cannot tell, such as periods or metrics that are missing.",
          "If the data shown does not answer the question (the metric or period asked for is",
          "not there), say so plainly and briefly instead, and do not analyze other figures",
          "in its place.",
          "Name context the data itself supports, such as revenue concentrated in one",
          "segment, but never add facts, numbers, or events that are not in the tool context.",
          "Use only the context provided; do not invent citations or data.",
          "The figures shown to the user are listed in displayed_figures, each with the metric",
          "and, in a comparison, the company it belongs to. Quote a figure only exactly as it",
          "appears there, in a sentence that names its company exactly as given in company",
          "(e.g. NVDA), and never compute new figures such as growth rates,",
          "margins, or ratios; describe direction and comparison in words instead.",
          // Fiscal calendars differ (#180): the period and its end date come with each figure.
          "Name the fiscal period each figure is for (its period, and the month its period_end",
          "falls in; never the day), and a chart's window by month and year. When a comparison's title says the fiscal years end months",
          "apart, say so: the same fiscal year covers different months for each company.",
          "When displayed_figures is empty, available_data lists the reported values you may use instead;",
          "a value with a coverage other than full covers only part of its period, so say so.",
          "Claims in cited_claims are sourced statements you may draw on, dated by effective_time",
          "and published_at: say when a claim dates from, by month and year, if it is not recent. data_notes say what",
          "could not be shown. If staleness flags data as stale (quote.stale, or",
          "fact_recency.stale / a large fact_recency.age_days), explicitly note",
          "that the figure may be out of date and say how old it is.",
          "Return plain text suitable for a rich_text block.",
        ].join(" "),
      },
      {
        role: "user",
        content: JSON.stringify(answerContext(input)),
      },
    ],
    temperature: 0.2,
    // Effort is set here; the length of the answer is the prompt's job. The ceiling is a
    // safety net for reasoning that runs long (it counts reasoning tokens too): at 800 a
    // reasoning model spent it all thinking and answered nothing (#124 baseline, #175).
    reasoning: "low",
    maxTokens: 8192,
  }, withDeadlines(input.deadlines ?? ANSWER_DEADLINES));
  if (result.usage) {
    input.onUsage?.({
      input_tokens: result.usage.inputTokens,
      output_tokens: result.usage.outputTokens,
      ...(result.usage.reasoningTokens === undefined ? {} : { reasoning_tokens: result.usage.reasoningTokens }),
    });
  }
  // The deployment is reported only when some of its prose is shown: a fallback
  // sentence in its place was written by no model (#183).
  const answered = () => input.onAnswered?.(`${result.deployment.channel}/${result.deployment.model}`);
  const text = result.text.trim();
  // Never show a sentence cut off mid-way, or the placeholder the turn started with.
  if (result.truncated || text.length === 0) {
    console.warn(`[chat] model answer was ${result.truncated ? "cut off at the token limit" : "empty"}; showing the fallback sentence`);
    return rewriteFirstRichTextBlock(
      input.blocks,
      input.factBlocks?.length ? FACT_BLOCKS_FALLBACK_TEXT : NO_ANSWER_FALLBACK_TEXT,
    );
  }
  // The guard limits prose to the figures shown; with none shown (no fact blocks,
  // or only a gap note or chart), the model answers from available_data
  // instead, so nothing is guarded (#181). One condition decides both.
  const shown = displayedFigures(input.factBlocks ?? []);
  if (shown.length === 0) {
    answered();
    return rewriteFirstRichTextBlock(input.blocks, text);
  }

  const guarded = keepSupportedSentences(
    text,
    [...displayTextsForBlocks(input.factBlocks ?? []).map(withoutDays), ...claimTextsFromToolCalls(input.toolCalls)],
    shown.flatMap((figure) =>
      figure.company === undefined ? [] : [
        { company: figure.company, value: figure.value, metric: figure.metric },
        // So is its fiscal year: the title shows every company's, so "NVDA's FY2025"
        // must not pass when NVDA's figures are FY2026 (#180). A year every company
        // shares is no one's in particular (narrative-guard.ts).
        ...(figure.period ? [{ company: figure.company, value: withoutDays(figure.period) }] : []),
      ]
    ),
  );
  if (guarded.removed.length > 0) {
    console.warn(`[chat] removed ${guarded.removed.length} narrative sentence(s) quoting figures not shown to the user`);
    input.onNarrativeRemoved?.(guarded.removed);
  }
  if (guarded.text) answered();
  return rewriteFirstRichTextBlock(input.blocks, guarded.text || FACT_BLOCKS_FALLBACK_TEXT);
}

// Claim text the answer cites; a figure a claim states is supported.
// Its dates too, as month and year only: the model is asked to date a claim
// ("in November 2025"), so that year is supported, while an ISO date's day and
// time digits ("19", "0") never become supported figures (#181).
function claimTextsFromToolCalls(toolCalls: ReadonlyArray<ChatAnalystToolRuntimeToolCall>): string[] {
  return citedClaims(toolCalls).flatMap((claim) => [
    claim.text,
    ...[claim.effective_time, claim.published_at].flatMap((date) => (date ? [monthYear(date)] : [])),
  ]);
}

// A chart's window is shown as dates ("2025-12-31 close to 2026-08-31"); the
// guard reads them as month and year, so a day ("31") never passes as a return.
function withoutDays(text: string): string {
  return text.replace(/\d{4}-\d{2}-\d{2}/g, (date) => monthYear(date));
}

function monthYear(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

export type AnswerUsage = { input_tokens: number; output_tokens: number; reasoning_tokens?: number };

// What the answer model sees (#181): only what it can use. The figures shown to
// the user (the only ones it may quote, with company, period and period end),
// cited claim text, what could not be shown, and staleness flags. Raw tool JSON,
// the placeholder block, and the routing bundle are left out: the narrative
// guard drops any figure not shown, so the raw facts behind them only added
// tokens and reasoning. When no figures are shown (no fact blocks: a quote-only
// subject, or the fact loader came back empty), nothing is guarded either, and
// the evidence is then summarized compactly as available_data instead.
export function answerContext(input: {
  context: LlmRuntimeContext;
  toolCalls: ReadonlyArray<ChatAnalystToolRuntimeToolCall>;
  factBlocks?: ReadonlyArray<Record<string, unknown>>;
  conversation?: ReadonlyArray<{ role: string; text: string }>;
}): Record<string, unknown> {
  const results = input.toolCalls.map((toolCall) => (isRecord(toolCall.result) ? toolCall.result : {}));
  const structured = results.map((result) => (isRecord(result.structured_context) ? result.structured_context : {}));
  const quotes = structured.flatMap((context) =>
    isRecord(context.quote) ? [{ ticker: context.quote.ticker, as_of: context.quote.as_of, stale: context.quote.stale }] : []
  );
  const factRecency = structured.flatMap((context) => (isRecord(context.fact_recency) ? [context.fact_recency] : []));
  // Notes the fact blocks show instead of a chart (a named gap), and subjects with no evidence at all.
  const dataNotes = [
    ...(input.factBlocks ?? []).flatMap((block) =>
      block.kind === "rich_text" && Array.isArray(block.segments)
        ? block.segments.flatMap((segment) => (isRecord(segment) && typeof segment.text === "string" ? [segment.text] : []))
        : []
    ),
    ...(results.some((result) => result.evidence_status === "insufficient_evidence")
      ? ["No research claims, reported facts, or quote are on file for this subject."]
      : []),
  ];
  const claims = citedClaims(input.toolCalls);
  const displayed = displayedFigures(input.factBlocks ?? []);
  const available = displayed.length === 0 ? availableData(structured) : null;
  return {
    question: input.context.userIntent ?? "Start a research thread",
    conversation: input.conversation ?? [],
    displayed_figures: displayed,
    ...(available ? { available_data: available } : {}),
    ...(claims.length > 0 ? { cited_claims: claims } : {}),
    ...(dataNotes.length > 0 ? { data_notes: dataNotes } : {}),
    ...(quotes.length > 0 || factRecency.length > 0
      ? { staleness: { ...(quotes.length > 0 ? { quote: quotes } : {}), ...(factRecency.length > 0 ? { fact_recency: factRecency } : {}) } }
      : {}),
  };
}

// Cited claim text with its dates, so a past claim (an earlier quarter's
// guidance) is not read as current.
function citedClaims(toolCalls: ReadonlyArray<ChatAnalystToolRuntimeToolCall>): Array<Record<string, string>> {
  return toolCalls.flatMap((toolCall) => {
    const evidence = (toolCall.result as { evidence?: { claims?: unknown } } | undefined)?.evidence;
    if (!Array.isArray(evidence?.claims)) return [];
    return evidence.claims.flatMap((claim: unknown) => {
      if (!isRecord(claim) || typeof claim.text_canonical !== "string") return [];
      return [{
        text: claim.text_canonical,
        ...(typeof claim.effective_time === "string" ? { effective_time: claim.effective_time } : {}),
        ...(typeof claim.published_at === "string" ? { published_at: claim.published_at } : {}),
      }];
    });
  });
}

// The quote and reported facts, compactly: what an answer with no displayed
// figures can stand on. Null when there is neither.
function availableData(structured: ReadonlyArray<Record<string, unknown>>): Record<string, unknown> | null {
  const quotes = structured.flatMap((context) => isRecord(context.quote) ? [{
    ticker: context.quote.ticker,
    price: context.quote.price,
    // change_pct is a fraction (0.0078 = 0.78%); sent as the percentage it means.
    ...(typeof context.quote.change_pct === "number"
      ? { change: `${context.quote.change_pct >= 0 ? "+" : ""}${(context.quote.change_pct * 100).toFixed(2)}%` }
      : {}),
    currency: context.quote.currency,
    as_of: context.quote.as_of,
    // Fresh is not live: an end-of-day or delayed quote says so.
    ...(typeof context.quote.session_state === "string" ? { session_state: context.quote.session_state } : {}),
    ...(typeof context.quote.delay_class === "string" ? { delay_class: context.quote.delay_class } : {}),
  }] : []);
  const facts = structured.flatMap((context) => (Array.isArray(context.facts) ? context.facts : []).flatMap((fact) =>
    isRecord(fact) && (typeof fact.value_num === "number" || typeof fact.value_text === "string") ? [{
      metric: fact.display_name ?? fact.metric_key,
      value: typeof fact.value_num === "number" ? fact.value_num * (typeof fact.scale === "number" ? fact.scale : 1) : fact.value_text,
      ...(fact.unit ? { unit: fact.unit } : {}),
      ...(fact.currency ? { currency: fact.currency } : {}),
      ...(fact.fiscal_year !== null && fact.fiscal_year !== undefined ? { period: `${fact.fiscal_period ?? ""} ${fact.fiscal_year}`.trim() } : {}),
      // Each value's own date: fact_recency only dates the newest one.
      ...(typeof fact.as_of === "string" ? { as_of: fact.as_of } : {}),
      // How completely the period is covered, when it is not fully.
      ...(typeof fact.coverage_level === "string" && fact.coverage_level !== "full" ? { coverage: fact.coverage_level } : {}),
    }] : []
  ));
  if (quotes.length === 0 && facts.length === 0) return null;
  return { ...(quotes.length > 0 ? { quotes } : {}), ...(facts.length > 0 ? { facts } : {}) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function rewriteFirstRichTextBlock(
  blocks: ReadonlyArray<Record<string, unknown>>,
  text: string,
): ReadonlyArray<Record<string, unknown>> {
  let rewritten = false;
  return Object.freeze(blocks.map((block) => {
    if (rewritten || block.kind !== "rich_text") return block;
    rewritten = true;
    return Object.freeze({
      ...block,
      segments: Object.freeze([
        Object.freeze({
          type: "text",
          text,
        }),
      ]),
    });
  }));
}
