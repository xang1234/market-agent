import {
  createLlmRouterFromEnv,
  type LlmChatClient,
  type LlmSettingsLoaderEnv,
} from "../../llm/src/index.ts";
import type { ThreadTitleModel } from "../../summary/src/title-generator.ts";
import type {
  ChatAnalystToolRuntimeToolCall,
} from "./coordinator.ts";

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
      maxTokens: 32,
    });
    return result.text;
  };
}

export async function composeAnalystBlocksWithLlm(input: {
  env?: LlmSettingsLoaderEnv;
  context: LlmRuntimeContext;
  blocks: ReadonlyArray<Record<string, unknown>>;
  toolCalls: ReadonlyArray<ChatAnalystToolRuntimeToolCall>;
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
          "Return plain text suitable for a rich_text block.",
        ].join(" "),
      },
      {
        role: "user",
        content: JSON.stringify({
          user_intent: input.context.userIntent ?? "Start a research thread",
          bundle_id: input.context.bundleId,
          existing_blocks: input.blocks,
          tool_calls: input.toolCalls.map(summarizeToolCall),
        }),
      },
    ],
    temperature: 0.2,
    maxTokens: 800,
  });
  const text = result.text.trim();
  if (text.length === 0) return input.blocks;
  return rewriteFirstRichTextBlock(input.blocks, text);
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
