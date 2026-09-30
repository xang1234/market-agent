import {
  createLlmRouterFromEnv,
  type LlmChatClient,
  type LlmSettingsLoaderEnv,
} from "../../llm/src/index.ts";
import type { ThreadTitleModel } from "../../summary/src/title-generator.ts";
import type {
  ChatAnalystToolRuntimeToolCall,
} from "./coordinator.ts";
import { displayTextsForBlocks } from "./fact-blocks.ts";
import { keepSupportedSentences } from "./narrative-guard.ts";

// Shown when the guard strips every sentence of the model's prose.
const FACT_BLOCKS_FALLBACK_TEXT =
  "The reported figures below come from the company's filings; select any value to see its source.";

type LlmRuntimeContext = {
  userIntent?: string;
  bundleId: string;
};

type LlmRuntimeOptions = {
  env?: LlmSettingsLoaderEnv;
  createClient?: () => Promise<LlmChatClient> | LlmChatClient;
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
    });
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
  createClient?: () => Promise<LlmChatClient> | LlmChatClient;
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
          "Write a concise investment research answer for the chat user.",
          "Use the provided tool context only; do not invent citations or data.",
          "The figures shown to the user are listed in displayed_figures. Quote a figure only",
          "exactly as it appears there, and never compute new figures such as growth rates,",
          "margins, or ratios; describe direction and comparison in words instead.",
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
          bundle_id: input.context.bundleId,
          existing_blocks: input.blocks,
          displayed_figures: displayTextsForBlocks(input.factBlocks ?? []),
          tool_calls: input.toolCalls.map(summarizeToolCall),
        }),
      },
    ],
    temperature: 0.2,
    maxTokens: 800,
  });
  const text = result.text.trim();
  if (text.length === 0) return input.blocks;
  if (!input.factBlocks?.length) return rewriteFirstRichTextBlock(input.blocks, text);

  const guarded = keepSupportedSentences(text, [
    ...displayTextsForBlocks(input.factBlocks),
    ...claimTextsFromToolCalls(input.toolCalls),
  ]);
  if (guarded.removed.length > 0) {
    console.warn(`[chat] removed ${guarded.removed.length} narrative sentence(s) quoting figures not shown to the user`);
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
