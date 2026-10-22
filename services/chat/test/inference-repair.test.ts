import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import type { LlmChatRequest, LlmChatResult } from "../../llm/src/index.ts";
import { answerMetrics, answerTurn, replayRecorded, type TurnTrace } from "../src/answer-trace.ts";
import { assertionList } from "../src/assertions.ts";
import { mutationRepairSummary, mutationVariants, repairMutation, type MutationRepair } from "../scripts/answer-lab.ts";

const trace = async (name: string): Promise<TurnTrace> =>
  JSON.parse(await readFile(fileURLToPath(new URL(`./answer-lab/traces/${name}`, import.meta.url)), "utf8")) as TurnTrace;

// Two companies; 7 an inference, 8 one the recorded judge found entailed but stating an amount in words.
const FISCAL = await trace("fiscal-year-trap.json");
// One company; 4 an inference, 5 one the checks reject for a digit.
const QUARTER = await trace("single-latest-quarter.json");
const SEGMENTS = await trace("segment-drill-down.json");

const ENV = {
  LLM_CHANNELS: "anthropic",
  LLM_ANTHROPIC_PROTOCOL: "anthropic",
  LLM_ANTHROPIC_API_KEY: "sk-test",
  LLM_ANTHROPIC_MODELS: "claude-sonnet-5-5,claude-haiku-5-5",
  LITELLM_MODEL: "anthropic/claude-sonnet-5-5",
};
const JUDGED_ENV = { ...ENV, JUDGE_LITELLM_MODEL: "anthropic/claude-haiku-5-5" };

const PENDING = "> _Checking an analyst inference against the figures it rests on…_";
const FISCAL_FIGURES = [
  "Of NVDA and AAPL, AAPL's revenue was highest: NVDA $130.5B (FY2025, ended Jan 2025), AAPL $416.2B (FY2025, ended Sep 2025).",
  "Of NVDA and AAPL, NVDA's gross margin was highest: NVDA 75.0% (FY2025, ended Jan 2025), AAPL 46.9% (FY2025, ended Sep 2025), 28.1 percentage points above AAPL.",
  "Of NVDA and AAPL, NVDA's net margin was highest: NVDA 55.8% (FY2025, ended Jan 2025), AAPL 26.9% (FY2025, ended Sep 2025), 28.9 percentage points above AAPL.",
  "AAPL's revenue growth (YoY) was 6.4% in FY2025 (ended Sep 2025).",
].join("\n\n");
const FISCAL_NOTE = "The periods compared end at different times, so they do not line up: NVDA's FY2025 ended Jan 2025 and AAPL's FY2025 ended Sep 2025.";
const PROFITABILITY = "> **Analyst inference** (AAPL highest on revenue; NVDA highest on gross margin and net margin): Despite lower absolute revenue, NVDA's substantially higher margins indicate stronger profitability per dollar of revenue compared to AAPL.";
const GAP_TEXT = "The eight-month gap between fiscal year ends limits direct comparability of the two revenue figures.";
const GAP_REASON = "The fiscal year ends are shown as Jan 2025 and Sep 2025, an eight-month gap, which the answer's own figures support as limiting direct comparison of the two revenue figures.";
const ENDS_TEXT = "The different fiscal year ends limit direct comparability of the two revenue figures.";
const ENDS = `> **Analyst inference:** ${ENDS_TEXT}`;
const fiscal = (...paragraphs: string[]) => [FISCAL_FIGURES, ...paragraphs, FISCAL_NOTE].join("\n\n");

const QUARTER_FIGURES = [
  "NVDA's revenue was $62.1B, net income $35.4B and net margin 57.0% in Q4 2026 (ended Jan 2026).",
  "NVDA's gross margin was 74.4% and operating margin 64.9% in Q4 2026 (ended Jan 2026).",
  "NVDA's revenue rose in every period from Q1 2025 ($26.0B) to Q4 2026 ($62.1B).",
  "NVDA's revenue growth (QoQ) was 8.9% and revenue growth (YoY) 57.9% in Q4 2026 (ended Jan 2026).",
].join("\n\n");
const MODERATING = "> **Analyst inference** (NVDA's revenue rose in every period): The large gap between YoY and QoQ growth rates indicates sequential momentum is moderating even though the company is still growing rapidly on a year-over-year basis.";
const DIGIT_TEXT = "The absolute revenue increase from Q2 to Q3 fiscal 2026 was larger than from Q3 to Q4 fiscal 2026, consistent with decelerating sequential growth on a larger base.";
const SLOWING_TEXT = "Sequential growth is slowing on a larger base.";
const UNVERIFIED_SLOWING = `> **Unverified analyst view** (not backed by the figures shown): ${SLOWING_TEXT}`;
const quarter = (...paragraphs: string[]) => [QUARTER_FIGURES, ...paragraphs].join("\n\n");

const REPAIR_MARK = "You already answered this question; your_assertions";
const verdict = (id: number, verdict: string, worded_amount = false, reason?: string) =>
  ({ text: `{"verdicts":[{"id":${id},"verdict":"${verdict}","worded_amount":${worded_amount}${reason ? `,"reason":${JSON.stringify(reason)}` : ""}}]}` });
const fenced = (entries: unknown[]) => ({ text: `\`\`\`assertions\n${JSON.stringify(entries)}\n\`\`\`` });
const inference = (index: number, text: string, extra: Record<string, unknown> = {}) => ({ kind: "analyst_inference", index, text, ...extra });

type JudgeAsk = { id: number; text: string; supports: string[] };
// The answer model replies as recorded, a repair request (the answer's own
// system prompt, the repair asked in its user message) as given, and the judge
// as given per inference; each call is kept, by role.
function models(
  recorded: TurnTrace,
  replies: { judge?: (ask: JudgeAsk) => Promise<LlmChatResult> | LlmChatResult; repair?: (request: LlmChatRequest) => Promise<LlmChatResult> | LlmChatResult },
) {
  const calls: string[] = [];
  const repairs: LlmChatRequest[] = [];
  const asks: JudgeAsk[] = [];
  const createClient = () => async (_deployment: unknown, request: LlmChatRequest): Promise<LlmChatResult> => {
    if (request.messages[0]!.content.startsWith("You check the analyst inferences")) {
      const ask = (JSON.parse(request.messages[1]!.content) as { inferences: JudgeAsk[] }).inferences[0]!;
      calls.push(`judge ${ask.id}`);
      asks.push(ask);
      return replies.judge ? replies.judge(ask) : assert.fail("no judge call expected");
    }
    if (request.messages[1]!.content.includes(REPAIR_MARK)) {
      calls.push("repair");
      repairs.push(request);
      return replies.repair ? replies.repair(request) : assert.fail("no repair call expected");
    }
    calls.push("answer");
    return { text: recorded.exchange!.text };
  };
  return { calls, repairs, asks, createClient };
}

// What a repair request asked: its list and its requests, after the instructions.
const repairAsked = (request: LlmChatRequest) => JSON.parse(request.messages[1]!.content.split("\n").at(-1)!) as { your_assertions: unknown[]; rejected: unknown[] };

const turn = (recorded: TurnTrace) => ({ thread_id: recorded.thread_id, run_id: recorded.run_id, question: recorded.question });
const text = (blocks: ReadonlyArray<Record<string, unknown>>) =>
  (blocks[0]!.segments as Array<{ text?: string; format?: string }>).map((segment) => segment.text ?? segment.format).join("");
const rejections = (report: TurnTrace["assertions"]) => (report?.rejected ?? []).map(({ index, check, reason }) => [index, check, reason]);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

// The fiscal turn: 7 entailed, 8 entailed and worded, as recorded; the repaired 8 as given.
const fiscalJudge = (repaired: (ask: JudgeAsk) => LlmChatResult = (ask) => verdict(ask.id, "entailed")) => (ask: JudgeAsk) =>
  ask.id === 7 ? verdict(7, "entailed") : ask.text === GAP_TEXT ? verdict(8, "entailed", true, GAP_REASON) : repaired(ask);

test("an inference judged to state an amount in words is repaired once: the call carries its verdict and reason, and the entailed repair shows in its place, recorded in the report and trace", async (t) => {
  const logged = t.mock.method(console, "info", () => {});
  const dir = await mkdtemp(join(tmpdir(), "inference-repair-"));
  const { calls, repairs, asks, createClient } = models(FISCAL, {
    judge: fiscalJudge(),
    repair: () => ({ ...fenced([inference(8, ENDS_TEXT)]), usage: { inputTokens: 9000, outputTokens: 120, totalTokens: 9120 } }),
  });
  const answer = await answerTurn(FISCAL.input, turn(FISCAL), { env: JUDGED_ENV, createClient, traceDir: dir });
  const seen: string[] = [];
  answer.judging!.watch((blocks) => seen.push(text(blocks)));
  const done = await answer.judging!.done;

  assert.equal(text(answer.blocks), fiscal(PENDING, PENDING));
  assert.equal(text(done.blocks), fiscal(PROFITABILITY, ENDS));
  // The judge-hidden one's line goes when its verdict hides it; nothing holds its place in the repair.
  assert.equal(seen.at(-2), fiscal(PROFITABILITY));
  assert.equal(seen.at(-1), fiscal(PROFITABILITY, ENDS));
  assert.equal(seen.some((blocks) => blocks.includes(GAP_TEXT)), false);
  assert.deepEqual(calls.sort(), ["answer", "judge 7", "judge 8", "judge 8", "repair"]);

  const [request] = repairs;
  // The answer's own request, its system prompt unchanged.
  assert.deepEqual(request!.messages[0], answer.exchange!.messages[0]);
  assert.equal(request!.messages.length, 2);
  assert.equal(request!.messages[1]!.content.startsWith(`${answer.exchange!.messages[1]!.content}\n\nYou already answered this question;`), true);
  assert.deepEqual([request!.temperature, request!.reasoning, request!.maxTokens], [0.2, "low", 2048]);
  assert.deepEqual(repairAsked(request!), {
    your_assertions: assertionList(FISCAL.exchange!.text),
    rejected: [{ index: 8, text: GAP_TEXT, check: "judge", verdict: "entailed", worded_amount: true, reason: GAP_REASON }],
  });
  // The repaired entry lists no supports, so it keeps the entry's own.
  assert.deepEqual(asks.find((ask) => ask.text === ENDS_TEXT)!.supports, [
    "NVDA's revenue was $130.5B in FY2025 (ended Jan 2025).",
    "AAPL's revenue was $416.2B in FY2025 (ended Sep 2025).",
  ]);

  assert.deepEqual(done.assertions?.repaired, [8]);
  assert.deepEqual(done.assertions?.judged, [
    { index: 7, verdict: "entailed", worded_amount: false },
    { index: 8, verdict: "entailed", worded_amount: false },
  ]);
  assert.deepEqual(done.assertions?.accepted.find((entry) => entry.index === 8), { index: 8, kind: "analyst_inference", text: ENDS_TEXT, evidence: ["F1", "F4"], supports: [0, 1] });
  assert.deepEqual(rejections(done.assertions), [[6, "kind", "an unknown cause cites a change: one company's metric, two periods, two values"]]);
  assert.deepEqual(logged.mock.calls.map((call) => String(call.arguments[0])).filter((line) => line.startsWith("[chat] repair")), [
    `[chat] repair thread=${FISCAL.thread_id} run=${FISCAL.run_id}: 1 repaired, 1 recovered`,
  ]);

  const written = JSON.parse(await readFile(join(dir, FISCAL.thread_id, `${FISCAL.run_id}.json`), "utf8")) as TurnTrace;
  assert.deepEqual(written.blocks, JSON.parse(JSON.stringify(done.blocks)));
  assert.deepEqual(written.repair?.requests, [{ index: 8, text: GAP_TEXT, check: "judge", verdict: "entailed", worded_amount: true, reason: GAP_REASON }]);
  assert.deepEqual(written.repair?.record.outcome === "replied" && [written.repair.record.exchange.text, written.repair.record.exchange.usage], [fenced([inference(8, ENDS_TEXT)]).text, { input_tokens: 9000, output_tokens: 120 }]);
  assert.deepEqual(written.repair?.judge.map((record) => record.outcome === "replied" && record.exchange.text), [verdict(8, "entailed").text]);
  const metrics = answerMetrics(written);
  assert.deepEqual([metrics.inferences_shown, metrics.inferences_hidden, metrics.inferences_repaired, metrics.inferences_recovered, metrics.repair_input_tokens, metrics.repair_output_tokens], [2, 0, 1, 1, 9000, 120]);

  // Replayed with no model: the recorded repair and its judge stand in.
  const replayed = await replayRecorded(written);
  assert.equal(text(replayed.blocks), fiscal(PROFITABILITY, ENDS));
  assert.deepEqual(replayed.assertions, written.assertions);
  assert.deepEqual([replayed.judge_input_changed, replayed.repair_input_changed], [false, false]);
  // A recorded repair asked something else than today's would be is flagged.
  const older = await replayRecorded({ ...written, repair: { ...written.repair!, requests: [] } });
  assert.equal(older.repair_input_changed, true);
});

test("an inference the checks reject for a digit is repaired, checked and judged: with new supports it rests on them, and an unsupported repair shows as unverified; it shows nothing until its verdict", async (t) => {
  t.mock.method(console, "info", () => {});
  const repaired = deferred<LlmChatResult>();
  const { calls, repairs, asks, createClient } = models(QUARTER, {
    judge: (ask) => (ask.id === 4 ? verdict(4, "entailed") : verdict(5, "unsupported", false, "nothing shows the base effect.")),
    repair: () => repaired.promise,
  });
  const answer = await answerTurn(QUARTER.input, turn(QUARTER), { env: JUDGED_ENV, createClient });
  const seen: string[] = [];
  const moderating = new Promise<void>((resolve) => {
    answer.judging!.watch((blocks) => {
      seen.push(text(blocks));
      if (text(blocks).includes(MODERATING)) resolve();
    });
  });
  await moderating;
  // Held in its repair: the reader sees the first answer's verdicts.
  assert.deepEqual(seen, [quarter(PENDING), quarter(MODERATING)]);
  repaired.resolve(fenced([inference(5, SLOWING_TEXT, { supports: [2] })]));
  const done = await answer.judging!.done;

  assert.deepEqual(seen, [quarter(PENDING), quarter(MODERATING), quarter(MODERATING, UNVERIFIED_SLOWING)]);
  assert.deepEqual(repairAsked(repairs[0]!).rejected, [{ index: 5, text: DIGIT_TEXT, check: "binding", reason: "an inference rests on its supports; it writes no figure" }]);
  assert.equal(text(done.blocks), quarter(MODERATING, UNVERIFIED_SLOWING));
  assert.deepEqual(asks.find((ask) => ask.id === 5)!.supports, ["NVDA's revenue rose in every period from Q1 2025 ($26.0B) to Q4 2026 ($62.1B)."]);
  assert.deepEqual(done.assertions?.accepted.find((entry) => entry.index === 5), { index: 5, kind: "analyst_inference", text: SLOWING_TEXT, evidence: [], supports: [2] });
  assert.deepEqual(done.assertions?.judged, [
    { index: 4, verdict: "entailed", worded_amount: false },
    { index: 5, verdict: "unsupported", worded_amount: false, reason: "nothing shows the base effect." },
  ]);
  assert.deepEqual(done.assertions?.repaired, [5]);
  assert.deepEqual(calls.sort(), ["answer", "judge 4", "judge 5", "repair"]);
});

test("every hidden inference of a turn goes in one repair call, once every first verdict is in; a repair hidden again stays hidden, with no second round", async (t) => {
  t.mock.method(console, "info", () => {});
  const { calls, repairs, createClient } = models(QUARTER, {
    judge: (ask) => ask.id === 4
      ? verdict(4, "contradicted", false, ask.text.startsWith("The large gap") ? "QoQ growth rose." : "it still says momentum fell.")
      : verdict(5, "entailed", true, "it says a third smaller."),
    repair: () => fenced([inference(4, "Momentum is moderating."), inference(5, "Growth is a third smaller than before.")]),
  });
  const answer = await answerTurn(QUARTER.input, turn(QUARTER), { env: JUDGED_ENV, createClient });
  const done = await answer.judging!.done;

  assert.deepEqual(repairAsked(repairs[0]!).rejected, [
    { index: 4, text: "The large gap between YoY and QoQ growth rates indicates sequential momentum is moderating even though the company is still growing rapidly on a year-over-year basis.", check: "judge", verdict: "contradicted", worded_amount: false, reason: "QoQ growth rose." },
    { index: 5, text: DIGIT_TEXT, check: "binding", reason: "an inference rests on its supports; it writes no figure" },
  ]);
  assert.equal(text(done.blocks), quarter());
  assert.deepEqual(calls.sort(), ["answer", "judge 4", "judge 4", "judge 5", "repair"]);
  assert.deepEqual(done.assertions?.repaired, [4, 5]);
  assert.deepEqual(rejections(done.assertions).filter(([index]) => index === 4 || index === 5), [
    [4, "judge", "contradicted: it still says momentum fell."],
    [5, "judge", "entailed, worded_amount: it says a third smaller."],
  ]);
});

test("a repaired entry goes through the same checks as the first: a digit, an address, a subject its evidence does not cover, or only failed supports leaves it hidden, with no second repair", async (t) => {
  t.mock.method(console, "info", () => {});
  const cases: Array<[string, Record<string, unknown>, string, string]> = [
    ["a digit", { text: "The gap of 8 months limits comparability." }, "binding", "an inference rests on its supports; it writes no figure"],
    ["an address", { text: "Comparability is limited, see www.example.com for why." }, "format", "an inference writes no link: the page would render the address as one"],
    ["a subject not in its evidence", { text: ENDS_TEXT, subject: "MSFT" }, "binding", "an inference's subject is a company its evidence covers"],
    ["only failed supports", { text: ENDS_TEXT, supports: [6] }, "support", "an inference binds the accepted observations it rests on"],
  ];
  for (const [label, fields, check, reason] of cases) {
    const { calls, createClient } = models(FISCAL, { judge: fiscalJudge(), repair: () => fenced([{ kind: "analyst_inference", index: 8, ...fields }]) });
    const done = await (await answerTurn(FISCAL.input, turn(FISCAL), { env: JUDGED_ENV, createClient })).judging!.done;
    assert.equal(text(done.blocks), fiscal(PROFITABILITY), label);
    assert.deepEqual(rejections(done.assertions).find(([index]) => index === 8), [8, check, reason], label);
    assert.deepEqual(done.assertions?.judged, [{ index: 7, verdict: "entailed", worded_amount: false }], label);
    assert.deepEqual(done.assertions?.repaired, [8], label);
    assert.deepEqual(calls.sort(), ["answer", "judge 7", "judge 8", "repair"], label);
  }
});

test("a repair that fails leaves its inference hidden as the first round did, and the answer is still saved: a failed call, one past its deadline, a reply cut off, with no list, leaving the entry out, or for an index or kind not asked for", async (t) => {
  t.mock.method(console, "info", () => {});
  const failures: Array<[string, () => Promise<LlmChatResult>]> = [
    ["a failed call", async () => {
      throw new Error("provider down");
    }],
    ["past its deadline", () => hang(t)],
    ["cut off", async () => ({ ...fenced([inference(8, ENDS_TEXT)]), truncated: true })],
    ["no list", async () => ({ text: "I cannot say it without the gap." })],
    ["left out", async () => fenced([])],
    ["another index, or another kind", async () => fenced([
      inference(7, "It is more profitable."),
      inference(0, "It replaces an observation."),
      { kind: "observation", index: 8, text: "AAPL's revenue is [[F4]].", evidence: ["F4"] },
    ])],
  ];
  for (const [label, repair] of failures) {
    const dir = await mkdtemp(join(tmpdir(), "inference-repair-"));
    const { calls, createClient } = models(FISCAL, { judge: fiscalJudge(), repair });
    const answer = await answerTurn(FISCAL.input, turn(FISCAL), { env: JUDGED_ENV, createClient, traceDir: dir, repairDeadlines: { attemptMs: 50, totalMs: 120 } });
    const done = await answer.judging!.done;
    assert.equal(text(done.blocks), fiscal(PROFITABILITY), label);
    assert.deepEqual(rejections(done.assertions).find(([index]) => index === 8), [8, "judge", `entailed, worded_amount: ${GAP_REASON}`], label);
    assert.equal(done.assertions?.repaired, undefined, label);
    assert.deepEqual(calls.sort(), ["answer", "judge 7", "judge 8", "repair"], label);
    const written = JSON.parse(await readFile(join(dir, FISCAL.thread_id, `${FISCAL.run_id}.json`), "utf8")) as TurnTrace;
    assert.equal(text(written.blocks), fiscal(PROFITABILITY), label);
    assert.deepEqual(written.repair?.requests.map(({ index }) => index), [8], label);
    assert.deepEqual(written.repair?.judge, [], label);
  }
});

test("no repair is asked for when nothing qualifies: verdicts entailed, unsupported or errors; no judge configured; the fallback shown", async (t) => {
  t.mock.method(console, "info", () => {});
  const nothing = models(SEGMENTS, { judge: (ask) => (ask.id === 6 ? verdict(6, "entailed") : verdict(7, "unsupported", false, "x.")) });
  const segments = await (await answerTurn(SEGMENTS.input, turn(SEGMENTS), { env: JUDGED_ENV, createClient: nothing.createClient })).judging!.done;
  assert.deepEqual(nothing.calls.sort(), ["answer", "judge 6", "judge 7"]);
  assert.equal(segments.assertions?.repaired, undefined);

  const errors = models(FISCAL, { judge: (ask) => (ask.id === 7 ? verdict(7, "entailed") : { text: "no verdicts" }) });
  const errored = await (await answerTurn(FISCAL.input, turn(FISCAL), { env: JUDGED_ENV, createClient: errors.createClient })).judging!.done;
  assert.equal(text(errored.blocks), fiscal(PROFITABILITY));
  assert.deepEqual(errors.calls.sort(), ["answer", "judge 7", "judge 8"]);

  // A digit-rejected inference, but no judge model: nothing waits or is asked.
  const unjudged = models(QUARTER, {});
  const plain = await answerTurn(QUARTER.input, turn(QUARTER), { env: ENV, createClient: unjudged.createClient });
  assert.equal(plain.judging, undefined);
  assert.deepEqual(unjudged.calls, ["answer"]);

  // The list does not parse: the fallback sentence shows, with no inference to repair.
  const malformed = { ...QUARTER, exchange: { ...QUARTER.exchange!, text: QUARTER.exchange!.text.replace("```assertions\n[", "```assertions\n{") } };
  const fallback = models(malformed, {});
  const fell = await answerTurn(malformed.input, turn(malformed), { env: JUDGED_ENV, createClient: fallback.createClient });
  assert.equal(fell.judging, undefined);
  assert.deepEqual(fallback.calls, ["answer"]);
});

test("a turn whose only hidden inference is check-rejected waits for its repair, with no line in its place", async (t) => {
  t.mock.method(console, "info", () => {});
  // 4 cites no assertion as its support, and 5 has a digit.
  const unsupported = { ...QUARTER, exchange: { ...QUARTER.exchange!, text: QUARTER.exchange!.text.replace('"supports":[2,3]', '"supports":[9]') } };
  const { calls, repairs, createClient } = models(unsupported, {
    judge: (ask) => verdict(ask.id, "entailed"),
    repair: () => fenced([inference(4, "Momentum is moderating.", { supports: [2, 3] })]),
  });
  const answer = await answerTurn(unsupported.input, turn(unsupported), { env: JUDGED_ENV, createClient });
  assert.equal(text(answer.blocks), quarter());
  const done = await answer.judging!.done;
  assert.deepEqual(repairAsked(repairs[0]!).rejected, [
    { index: 4, text: "The large gap between YoY and QoQ growth rates indicates sequential momentum is moderating even though the company is still growing rapidly on a year-over-year basis.", check: "support", reason: "an inference binds the accepted observations it rests on" },
    { index: 5, text: DIGIT_TEXT, check: "binding", reason: "an inference rests on its supports; it writes no figure" },
  ]);
  assert.equal(text(done.blocks), quarter("> **Analyst inference** (NVDA's revenue rose in every period): Momentum is moderating."));
  assert.deepEqual(calls.sort(), ["answer", "judge 4", "repair"]);
});

test("a trace recorded before repairs replays with none: its hidden inference stays hidden; one recorded with a repair replays it with no model", async () => {
  const { repair: _, ...before } = FISCAL;
  const replayed = await replayRecorded(before);
  assert.equal(text(replayed.blocks), fiscal(PROFITABILITY));
  assert.equal(replayed.repair, null);
  assert.equal(replayed.repair_input_changed, false);

  const recorded = await replayRecorded(FISCAL);
  assert.equal(text(recorded.blocks), fiscal(PROFITABILITY, "> **Analyst inference on NVDA:** The two fiscal years end in different months, so the revenue figures cover different stretches of time and are not a clean like-for-like comparison."));
  assert.deepEqual(recorded.assertions?.repaired, [8]);
  assert.equal(recorded.repair_input_changed, false);
});

test("a replay keeps the recorded verdicts and runs only the repair live (recorded --repair), or reruns the judge and the repair live (--judge)", async (t) => {
  t.mock.method(console, "info", () => {});
  const repairOnly = models(FISCAL, { judge: fiscalJudge(), repair: () => fenced([inference(8, ENDS_TEXT)]) });
  const repaired = await replayRecorded(FISCAL, { env: JUDGED_ENV, createClient: repairOnly.createClient, rerun: "repair" });
  assert.equal(text(repaired.blocks), fiscal(PROFITABILITY, ENDS));
  assert.deepEqual(repairOnly.calls, ["repair", "judge 8"]);
  assert.deepEqual(repaired.judge, FISCAL.judge);

  const live = models(FISCAL, { judge: fiscalJudge(), repair: () => fenced([inference(8, ENDS_TEXT)]) });
  const judged = await replayRecorded(FISCAL, { env: JUDGED_ENV, createClient: live.createClient, rerun: "judge" });
  assert.equal(text(judged.blocks), fiscal(PROFITABILITY, ENDS));
  assert.deepEqual(live.calls.sort(), ["judge 7", "judge 8", "judge 8", "repair"]);
});

const MUTATIONS = fileURLToPath(new URL("./answer-lab/judge-mutations.json", import.meta.url));

test("judge-mutations --repair sends a hidden variant through the turn's repair round, on its answer request with the variant in its list, and reports its path", async () => {
  const variant = mutationVariants(MUTATIONS).find((entry) => entry.kind === "worded_amount")!;
  const index = variant.judged.index;
  const first = { index, verdict: "entailed" as const, worded_amount: true, reason: "it states an amount." };
  const { calls, repairs, createClient } = models(SEGMENTS, {
    judge: (ask) => verdict(ask.id, "entailed"),
    repair: () => fenced([inference(index, "It leans on one source of revenue.")]),
  });
  const repaired = await repairMutation(variant, first, { env: JUDGED_ENV, createClient });
  assert.deepEqual(calls, ["repair", `judge ${index}`]);
  assert.deepEqual(repairAsked(repairs[0]!).rejected, [{ index, text: variant.judged.text, check: "judge", verdict: "entailed", worded_amount: true, reason: "it states an amount." }]);
  assert.equal(repairs[0]!.messages[0]!.content, variant.turn.messages[0]!.content);
  assert.deepEqual([repaired.repaired, repaired.second, repaired.as], ["It leans on one source of revenue.", { index, verdict: "entailed", worded_amount: false }, "shown"]);

  const digit = models(SEGMENTS, { repair: () => fenced([inference(index, "It earns 9 of every 10 dollars in one place.")]) });
  const rejected = await repairMutation(variant, first, { env: JUDGED_ENV, createClient: digit.createClient });
  assert.deepEqual([rejected.rejection, rejected.as], ["binding: an inference rests on its supports; it writes no figure", "hidden"]);

  // An error verdict is not repaired, as a chat turn's is not.
  const error = await repairMutation(variant, { index, verdict: "error", reason: "timeout" }, { env: JUDGED_ENV, createClient: models(SEGMENTS, {}).createClient });
  assert.deepEqual([error.repaired, error.as], [null, "hidden"]);
});

test("the repair summary counts the hide-tier mutations shown and unverified after repair, and each variant's path", () => {
  const row = (id: string, kind: string, as: string, extra: Partial<MutationRepair> = {}) =>
    ({ id, kind, first: { index: 1, verdict: "contradicted", worded_amount: false, reason: "it ranks them wrong." }, repaired: null, as, ...extra }) as MutationRepair;
  assert.equal(mutationRepairSummary([
    row("a", "contradicted_ranking", "shown", { repaired: "It leads on margin.", second: { index: 1, verdict: "entailed", worded_amount: false } }),
    row("b", "worded_amount", "unverified", { repaired: "It is larger.", second: { index: 1, verdict: "unsupported", worded_amount: false, reason: "x." } }),
    row("c", "flipped_direction", "hidden", { repaired: "It rose 5%.", rejection: "binding: no digit" }),
    row("d", "unsupported_claim", "hidden"),
    row("e", "original", "shown", { repaired: "It is fine.", second: { index: 1, verdict: "entailed", worded_amount: false } }),
  ]), [
    "after repair: 1 shown, 1 unverified, 1 still hidden, of 3 hide-tier mutations the judge hid",
    "  a contradicted_ranking: contradicted: it ranks them wrong.\n      It leads on margin.\n      entailed\n      shown",
    "  b worded_amount: contradicted: it ranks them wrong.\n      It is larger.\n      unsupported: x.\n      unverified",
    "  c flipped_direction: contradicted: it ranks them wrong.\n      It rose 5%.\n      rejected: binding: no digit\n      hidden",
    "  d unsupported_claim: contradicted: it ranks them wrong.\n      left out\n      hidden",
    "  e original: contradicted: it ranks them wrong.\n      It is fine.\n      entailed\n      shown",
  ].join("\n"));
});

// A call that is accepted and never answered; the interval keeps the event
// loop alive, as an open connection would (judge-gate.test.ts hang).
function hang(t: { after(fn: () => void): void }): Promise<never> {
  const connection = setInterval(() => {}, 1_000);
  t.after(() => clearInterval(connection));
  return new Promise<never>(() => {});
}
