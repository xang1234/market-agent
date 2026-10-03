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
          "Use the provided tool context only; do not invent citations or data.",
          "The figures shown to the user are listed in displayed_figures, each with the metric",
          "and, in a comparison, the company it belongs to. Quote a figure only exactly as it",
          "appears there, in a sentence that names its company exactly as given in company",
          "(e.g. NVDA), and never compute new figures such as growth rates,",
          "margins, or ratios; describe direction and comparison in words instead.",
          // Fiscal calendars differ (#180): the period and its end date come with each figure.
          "Name the fiscal period each figure is for (its period, and the month its period_end",
          "falls in; never the day). When a comparison's title says the fiscal years end months",
          "apart, say so: the same fiscal year covers different months for each company.",
          "If the tool context flags data as stale (quote.stale, or",
          "fact_recency.stale / a large fact_recency.age_days), explicitly note",
          "that the figure may be out of date and say how old it is.",
          "Return plain text suitable for a rich_text block.",
        ].join(" "),
      },
      {
        role: "user",
        content: JSON.stringify({
          user_intent: input.context.userIntent ?? "Start a research thread",
          conversation: input.conversation ?? [],
          bundle_id: input.context.bundleId,
          existing_blocks: input.blocks,
          displayed_figures: displayedFigures(input.factBlocks ?? []),
          tool_calls: input.toolCalls.map(summarizeToolCall),
        }),
      },
    ],
    temperature: 0.2,
    // Effort is set here; the length of the answer is the prompt's job. The ceiling is a
    // safety net for reasoning that runs long (it counts reasoning tokens too): at 800 a
    // reasoning model spent it all thinking and answered nothing (#124 baseline, #175).
    reasoning: "low",
    maxTokens: 8192,
  }, withDeadlines(input.deadlines ?? ANSWER_DEADLINES));
  const text = result.text.trim();
  // Never show a sentence cut off mid-way, or the placeholder the turn started with.
  if (result.truncated || text.length === 0) {
    console.warn(`[chat] model answer was ${result.truncated ? "cut off at the token limit" : "empty"}; showing the fallback sentence`);
    return rewriteFirstRichTextBlock(
      input.blocks,
      input.factBlocks?.length ? FACT_BLOCKS_FALLBACK_TEXT : NO_ANSWER_FALLBACK_TEXT,
    );
  }
  if (!input.factBlocks?.length) return rewriteFirstRichTextBlock(input.blocks, text);

  const guarded = keepSupportedSentences(
    text,
    [...displayTextsForBlocks(input.factBlocks), ...claimTextsFromToolCalls(input.toolCalls)],
    displayedFigures(input.factBlocks).flatMap((figure) =>
      figure.company === undefined ? [] : [
        { company: figure.company, value: figure.value },
        // So is its fiscal year: the title shows every company's, so "NVDA's FY2025"
        // must not pass when NVDA's figures are FY2026 (#180). A year every company
        // shares is no one's in particular (narrative-guard.ts).
        ...(figure.period ? [{ company: figure.company, value: figure.period }] : []),
      ]
    ),
  );
  if (guarded.removed.length > 0) {
    console.warn(`[chat] removed ${guarded.removed.length} narrative sentence(s) quoting figures not shown to the user`);
    input.onNarrativeRemoved?.(guarded.removed);
  }
  return rewriteFirstRichTextBlock(input.blocks, guarded.text || FACT_BLOCKS_FALLBACK_TEXT);
}

// Claim text the answer cites; a figure a claim states is supported.
function claimTextsFromToolCalls(toolCalls: ReadonlyArray<ChatAnalystToolRuntimeToolCall>): string[] {
  return toolCalls.flatMap((toolCall) => {
    const evidence = (toolCall.result as { evidence?: { claims?: unknown } } | undefined)?.evidence;
    if (!Array.isArray(evidence?.claims)) return [];
    return evidence.claims.flatMap((claim: unknown) => {
      const text = (claim as { text_canonical?: unknown } | null)?.text_canonical;
      return typeof text === "string" ? [text] : [];
    });
  });
}

function summarizeToolCall(toolCall: ChatAnalystToolRuntimeToolCall): Record<string, unknown> {
  return {
    tool_call_id: toolCall.tool_call_id,
    tool_name: toolCall.tool_name,
    status: toolCall.status,
    bundle_id: toolCall.bundle_id,
    ...(toolCall.arguments === undefined ? {} : { arguments: toolCall.arguments }),
    ...(toolCall.result === undefined ? {} : { result: toolCall.result }),
  };
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
