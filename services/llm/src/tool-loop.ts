import type { JsonObject } from "../../shared/src/json.ts";
import type {
  ControlledRouter,
  LlmMessage,
  LlmChatRequest,
  LlmRouterResult,
  LlmTool,
  LlmToolCall,
} from "./router.ts";

/** checkToolCall reserves budget for an accepted call, so calls in one step are counted against each other before any runs. */
export type ToolLoopPolicy<Accepted extends { ok: true }> = {
  ok: true;
  checkToolCall(call: { tool_name: string; arguments?: JsonObject }): Accepted | ToolLoopRefusal;
  recordAcceptedToolCall(decision: Accepted): ToolLoopPolicy<Accepted> | { ok: false };
};

export type ToolLoopRefusal = { ok: false; reason: string; note?: string; message?: string };

/**
 * A tool's answer. A failure the model should hear about is `isError`. A throw ends the loop,
 * and the step's other calls may still be running when it does.
 */
export type ToolLoopOutput = { content: string; isError?: boolean };

export type ToolLoopCallResult = {
  call: LlmToolCall;
  outcome: "ok" | "error" | "refused";
  content: string;
};

export type ToolLoopStep = {
  reply: LlmRouterResult;
  results: ReadonlyArray<ToolLoopCallResult>;
};

/**
 * `budget`: the model answered after the policy refused a call for budget, so the answer is partial.
 * `truncated`: the reply hit maxTokens, so its text may be cut off and its tool calls were not run.
 */
export type ToolLoopStopReason = "final" | "step_cap" | "budget" | "truncated";

export type ToolLoopResult = {
  stop: ToolLoopStopReason;
  steps: ReadonlyArray<ToolLoopStep>;
  /** The request's messages followed by every turn the loop added. */
  messages: ReadonlyArray<LlmMessage>;
};

export type RunToolLoopInput<Accepted extends { ok: true }> = {
  router: ControlledRouter;
  request: LlmChatRequest & { tools: ReadonlyArray<LlmTool> };
  execute: (call: LlmToolCall) => Promise<ToolLoopOutput> | ToolLoopOutput;
  policy: ToolLoopPolicy<Accepted>;
  maxSteps: number;
};

export async function runToolLoop<Accepted extends { ok: true }>(
  input: RunToolLoopInput<Accepted>,
): Promise<ToolLoopResult> {
  if (!Number.isInteger(input.maxSteps) || input.maxSteps < 1) {
    throw new RangeError("maxSteps must be a positive integer");
  }
  const known = new Set(input.request.tools.map((tool) => tool.name));
  const messages: LlmMessage[] = [...input.request.messages];
  const steps: ToolLoopStep[] = [];
  let policy = input.policy;
  let budgetRefused = false;
  const done = (stop: ToolLoopStopReason): ToolLoopResult =>
    Object.freeze({ stop, steps: Object.freeze(steps), messages: Object.freeze(messages) });

  while (steps.length < input.maxSteps) {
    const reply = await input.router.complete({ ...input.request, messages: [...messages] });
    const calls = reply.toolCalls ?? [];
    if (reply.truncated || calls.length === 0) {
      messages.push(Object.freeze({ role: "assistant", content: reply.text }));
      steps.push(Object.freeze({ reply, results: Object.freeze([]) }));
      return done(reply.truncated ? "truncated" : budgetRefused ? "budget" : "final");
    }
    messages.push(Object.freeze({ role: "assistant", content: reply.text, toolCalls: calls, deployment: reply.deployment }));

    const checked = calls.map((call): { call: LlmToolCall; decision: Accepted | ToolLoopRefusal } => ({
      call,
      decision: known.has(call.name)
        ? policy.checkToolCall({ tool_name: call.name, arguments: call.arguments })
        : { ok: false, reason: "unknown_tool", message: `no tool named "${call.name}"` },
    }));
    const results = await Promise.all(checked.map(async ({ call, decision }): Promise<ToolLoopCallResult> => {
      if (!decision.ok) {
        if (decision.reason === "budget_exceeded") budgetRefused = true;
        const why = decision.note ?? decision.message ?? "";
        return Object.freeze({ call, outcome: "refused", content: `refused (${decision.reason}) ${why}`.trim() });
      }
      const output = await input.execute(call);
      return Object.freeze({ call, outcome: output.isError ? "error" : "ok", content: output.content });
    }));
    for (const { decision } of checked) {
      if (!decision.ok) continue;
      const next = policy.recordAcceptedToolCall(decision);
      if (next.ok === false) throw new Error("tool policy refused its own bundle after an accepted call");
      policy = next;
    }
    steps.push(Object.freeze({ reply, results: Object.freeze(results) }));
    messages.push(...results.map((result) => Object.freeze({
      role: "toolResult" as const,
      toolCallId: result.call.id,
      toolName: result.call.name,
      content: result.content,
      isError: result.outcome !== "ok",
    })));
  }
  return done("step_cap");
}
