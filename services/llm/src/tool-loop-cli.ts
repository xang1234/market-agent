import { parseArgs } from "node:util";

import { createLlmRouterFromEnv } from "./settings-loader.ts";
import type { ControlledRouter } from "./router.ts";
import { runToolLoop, type ToolLoopPolicy } from "./tool-loop.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    "max-steps": { type: "string", default: "6" },
    "budget-high": { type: "string" },
    "tool-error": { type: "boolean", default: false },
  },
});
const question = positionals.join(" ").trim();
const maxSteps = Number(values["max-steps"]);
const budgetHigh = values["budget-high"] === undefined ? Infinity : Number(values["budget-high"]);
if (question === "" || !Number.isInteger(maxSteps) || !(budgetHigh >= 0)) {
  console.error('usage: tool-loop-cli.ts "<question>" [--max-steps=N] [--budget-high=N] [--tool-error]');
  process.exit(2);
}

const PACKET: Readonly<Record<string, { id: string; value: string }>> = {
  NVDA: { id: "F1", value: "$96.2B" },
  MU: { id: "F2", value: "$54.2B" },
  AMD: { id: "F3", value: "$34.6B" },
};

const starts: number[] = [];
const llmMsByStep: number[] = [];
const router = await createLlmRouterFromEnv({ ...process.env, LLM_USAGE_LOG: "true" }, {
  purpose: "agent",
  log: (line) => {
    const ms = /^\[llm\] \S+ (\d+)ms/u.exec(line)?.[1];
    if (ms !== undefined && llmMsByStep.length > 0) llmMsByStep[llmMsByStep.length - 1] += Number(ms);
    console.log(line);
  },
});
if (router === null) {
  console.error("no LLM deployments configured");
  process.exit(1);
}

const timed: ControlledRouter = {
  complete: (request, controls) => {
    starts.push(performance.now());
    llmMsByStep.push(0);
    return router.complete(request, controls);
  },
};

let reserved = 0;
const policy: ToolLoopPolicy<{ ok: true }> = {
  ok: true,
  checkToolCall: () => reserved < budgetHigh
    ? (reserved++, { ok: true })
    : { ok: false, reason: "budget_exceeded", note: `the high-cost budget of ${budgetHigh} calls is spent; answer with the figures you have` },
  recordAcceptedToolCall: () => policy,
};

let toolCalls = 0;
const result = await runToolLoop({
  router: timed,
  maxSteps,
  policy,
  request: {
    maxTokens: 1024,
    messages: [
      {
        role: "system",
        content: "You are a financial analyst. Take every figure from the certified_financials tool and cite its F id. " +
          "Never state a figure the tool did not return.",
      },
      { role: "user", content: question },
    ],
    tools: [{
      name: "certified_financials",
      description: "Certified revenue for companies over their latest fiscal year, each figure with an F id.",
      parameters: {
        type: "object",
        properties: {
          tickers: { type: "array", items: { type: "string" } },
          metric: { type: "string" },
        },
        required: ["tickers", "metric"],
      },
    }],
  },
  execute: (call) => {
    toolCalls += 1;
    if (values["tool-error"] && toolCalls === 1) {
      return { content: "certified_financials failed: upstream timeout", isError: true };
    }
    const tickers = Array.isArray(call.arguments.tickers) ? call.arguments.tickers : [];
    const facts = tickers.flatMap((ticker) => {
      const fact = typeof ticker === "string" ? PACKET[ticker.toUpperCase()] : undefined;
      return fact ? [{ ...fact, ticker, metric: "revenue", period: "FY2026" }] : [];
    });
    return { content: JSON.stringify({ facts }) };
  },
});
const endedAt = performance.now();

const oneLine = (text: string) => JSON.stringify(text.replace(/\s+/gu, " ").slice(0, 300));
let refused = 0;
const callTurns = result.messages.flatMap((message, at) => ("deployment" in message ? [at] : []));
result.steps.forEach((step, index) => {
  const wallMs = Math.round((starts[index + 1] ?? endedAt) - starts[index]);
  const calls = step.results.map(({ call, outcome, content }, nth) => {
    if (outcome === "refused") refused += 1;
    const sent = result.messages[callTurns[index] + 1 + nth];
    const resultId = sent?.role === "toolResult" ? sent.toolCallId : "none";
    return `tool=${call.name} id=${call.id} args=${JSON.stringify(call.arguments)} -> ${outcome} result_id=${resultId}` +
      (outcome === "ok" ? "" : ` toolResult=${oneLine(content)}`);
  });
  console.log(
    `step=${index + 1} model=${step.reply.deployment.channel}/${step.reply.deployment.model} ms=${wallMs} llm_ms=${llmMsByStep[index]} ` +
      `overhead_ms=${wallMs - llmMsByStep[index]} ${calls.length > 0 ? calls.join(" | ") : `final=${oneLine(step.reply.text)}`}`,
  );
});
console.log(`stop=${result.stop} steps=${result.steps.length} tool_calls=${result.steps.reduce((n, s) => n + s.results.length, 0)} refused=${refused}`);
