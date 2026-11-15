import assert from "node:assert/strict";
import test from "node:test";

import type { ControlledRouter, LlmChatRequest, LlmRouterResult, LlmToolCall } from "../src/router.ts";
import { runToolLoop, type ToolLoopPolicy } from "../src/tool-loop.ts";

const TOOLS = [{ name: "certified_financials", description: "Certified figures.", parameters: { type: "object" } }];
const DEPLOYMENT = { channel: "anthropic", model: "claude-sonnet-5-5" };

const call = (id: string, tickers: string[], name = "certified_financials"): LlmToolCall =>
  ({ id, name, arguments: { tickers } });

function scriptedRouter(replies: ReadonlyArray<Partial<LlmRouterResult>> | (() => Partial<LlmRouterResult>)) {
  const requests: LlmChatRequest[] = [];
  const router: ControlledRouter = {
    async complete(request) {
      requests.push(request);
      const reply = typeof replies === "function" ? replies() : replies[requests.length - 1];
      assert.ok(reply, `no scripted reply for step ${requests.length}`);
      return { text: "", deployment: DEPLOYMENT, ...reply };
    },
  };
  return { router, requests };
}

type Accepted = { ok: true; id: number };

function highBudgetPolicy(limit: number): ToolLoopPolicy<Accepted> {
  let reserved = 0;
  const policy: ToolLoopPolicy<Accepted> = {
    ok: true,
    checkToolCall: () => reserved < limit
      ? { ok: true, id: reserved++ }
      : { ok: false, reason: "budget_exceeded", note: "high-cost budget is exhausted; return a partial answer" },
    recordAcceptedToolCall: () => policy,
  };
  return policy;
}

const ask = { messages: [{ role: "user" as const, content: "Compare NVDA and MU revenue" }], tools: TOOLS };
const packet = async () => ({ content: "F1 NVDA revenue $96.2B" });

test("a final reply at step 2 stops with final, the tool's packet in the second request", async () => {
  const { router, requests } = scriptedRouter([
    { toolCalls: [call("t1", ["NVDA", "MU"])] },
    { text: "NVDA revenue was $96.2B [F1]." },
  ]);

  const result = await runToolLoop({ router, request: ask, execute: packet, policy: highBudgetPolicy(5), maxSteps: 5 });

  assert.equal(result.stop, "final");
  assert.equal(result.steps.length, 2);
  assert.deepEqual(requests[1].messages.slice(1), [
    { role: "assistant", content: "", toolCalls: [call("t1", ["NVDA", "MU"])] },
    { role: "toolResult", toolCallId: "t1", toolName: "certified_financials", content: "F1 NVDA revenue $96.2B", isError: false },
  ]);
  assert.deepEqual(requests[1].tools, TOOLS);
  assert.equal(result.messages.at(-1)?.content, "NVDA revenue was $96.2B [F1].");
});

test("a model that always calls a tool stops at step_cap after maxSteps model calls", async () => {
  let n = 0;
  const { router, requests } = scriptedRouter(() => ({ toolCalls: [call(`t${++n}`, ["NVDA"])] }));

  const result = await runToolLoop({ router, request: ask, execute: packet, policy: highBudgetPolicy(10), maxSteps: 3 });

  assert.equal(result.stop, "step_cap");
  assert.equal(requests.length, 3);
  assert.deepEqual(result.steps.map((step) => step.results.map((r) => r.outcome)), [["ok"], ["ok"], ["ok"]]);
});

test("a budget of one high-cost call refuses the second, and the model receives the refusal as an error toolResult", async () => {
  const executed: string[] = [];
  const { router, requests } = scriptedRouter([
    { toolCalls: [call("t1", ["NVDA"]), call("t2", ["MU"])] },
    { text: "Only NVDA is available [F1]." },
  ]);

  const result = await runToolLoop({
    router,
    request: ask,
    execute: async (c) => (executed.push(c.id), { content: "F1 NVDA revenue $96.2B" }),
    policy: highBudgetPolicy(1),
    maxSteps: 5,
  });

  assert.deepEqual(executed, ["t1"]);
  assert.deepEqual(requests[1].messages.slice(-1), [{
    role: "toolResult",
    toolCallId: "t2",
    toolName: "certified_financials",
    content: "refused (budget_exceeded) high-cost budget is exhausted; return a partial answer",
    isError: true,
  }]);
  assert.equal(result.stop, "budget");
});

test("a call to a tool the request doesn't offer gets an error result, without reaching the policy or the tool", async () => {
  const { router, requests } = scriptedRouter([
    { toolCalls: [call("t1", ["NVDA"], "price_history")] },
    { text: "No such tool." },
  ]);
  const policy = highBudgetPolicy(0);

  const result = await runToolLoop({
    router,
    request: ask,
    execute: () => assert.fail("an unknown tool must not run"),
    policy: { ...policy, checkToolCall: () => assert.fail("an unknown tool must not reach the policy") },
    maxSteps: 5,
  });

  assert.deepEqual(requests[1].messages.at(-1), {
    role: "toolResult",
    toolCallId: "t1",
    toolName: "price_history",
    content: 'refused (unknown_tool) no tool named "price_history"',
    isError: true,
  });
  assert.equal(result.stop, "final");
});

test("a tool's own error goes back to the model and the loop carries on", async () => {
  const { router } = scriptedRouter([
    { toolCalls: [call("t1", ["NVDA"])] },
    { text: "The figures are unavailable." },
  ]);

  const result = await runToolLoop({
    router,
    request: ask,
    execute: () => ({ content: "upstream timeout", isError: true }),
    policy: highBudgetPolicy(5),
    maxSteps: 5,
  });

  assert.deepEqual(result.steps[0].results.map(({ outcome, content }) => ({ outcome, content })), [
    { outcome: "error", content: "upstream timeout" },
  ]);
  assert.equal(result.stop, "final");
});

test("maxSteps must be a positive integer", async () => {
  const { router } = scriptedRouter([]);
  await assert.rejects(
    runToolLoop({ router, request: ask, execute: packet, policy: highBudgetPolicy(1), maxSteps: 0 }),
    RangeError,
  );
});
