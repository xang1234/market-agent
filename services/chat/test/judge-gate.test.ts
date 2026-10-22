import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import type { LlmChatRequest, LlmChatResult } from "../../llm/src/index.ts";
import { answerTurn, composeTraced, inferenceCases, judgedAnswer, replayRecorded, type TurnTrace } from "../src/answer-trace.ts";
import type { JudgeRecord } from "../src/inference-judge.ts";

const trace = async (name: string): Promise<TurnTrace> =>
  JSON.parse(await readFile(fileURLToPath(new URL(`./answer-lab/traces/${name}`, import.meta.url)), "utf8")) as TurnTrace;

const SEGMENTS = await trace("segment-drill-down.json");
const NO_INFERENCE = await trace("missing-cash-flow.json");

const ENV = {
  LLM_CHANNELS: "anthropic",
  LLM_ANTHROPIC_PROTOCOL: "anthropic",
  LLM_ANTHROPIC_API_KEY: "sk-test",
  LLM_ANTHROPIC_MODELS: "claude-sonnet-5-5,claude-haiku-5-5",
  LITELLM_MODEL: "anthropic/claude-sonnet-5-5",
};
const JUDGED_ENV = { ...ENV, JUDGE_LITELLM_MODEL: "anthropic/claude-haiku-5-5" };

// One reply judging both inferences.
const VERDICTS = '{"verdicts":[{"id":6,"verdict":"entailed","worded_amount":false},{"id":7,"verdict":"unsupported","worded_amount":false,"reason":"no support measures diversification."}]}';
const ENTAILED = (id: number) => `{"verdicts":[{"id":${id},"verdict":"entailed","worded_amount":false}]}`;
const UNSUPPORTED_7 = '{"verdicts":[{"id":7,"verdict":"unsupported","worded_amount":false,"reason":"no support measures diversification."}]}';
// The report's verdicts when 6 is entailed and 7 unsupported.
const JUDGED = [
  { index: 6, verdict: "entailed", worded_amount: false },
  { index: 7, verdict: "unsupported", worded_amount: false, reason: "no support measures diversification." },
];

const FIGURES = "By revenue, highest first: Data Center $55.2B, Gaming $4.3B, OEM & Other $1.1B, Professional Visualization $900.0M, Automotive $650.0M (Q4 2026, ended Jan 2026).";
const PENDING = "> _Checking an analyst inference against the figures it rests on…_";
const CONCENTRATED = "> **Analyst inference** (revenue highest first: Data Center, Gaming, OEM & Other, Professional Visualization, Automotive): NVIDIA's revenue is heavily concentrated in Data Center, creating significant single-segment exposure for the consolidated top line.";
const CUSHION = "> **Analyst inference** (revenue highest first: Data Center, Gaming, OEM & Other, Professional Visualization, Automotive): The other four segments provide limited diversification cushion relative to Data Center's dominance.";
const UNVERIFIED_CUSHION = "> **Unverified analyst view** (not backed by the figures shown): The other four segments provide limited diversification cushion relative to Data Center's dominance.";

// The answer model replies as recorded; the judge as given. Each call's model is kept.
function models(recorded: TurnTrace, judge: (request: LlmChatRequest) => Promise<LlmChatResult>) {
  const calls: string[] = [];
  const createClient = () => async (deployment: { channel: string; model: string }, request: LlmChatRequest): Promise<LlmChatResult> => {
    calls.push(`${deployment.channel}/${deployment.model}`);
    return request.messages[0]!.content.startsWith("You check the analyst inferences") ? judge(request) : { text: recorded.exchange!.text };
  };
  return { calls, createClient };
}

// The ids of the inferences a judge request asks about.
const asked = (request: { messages: ReadonlyArray<{ content: string }> }) => (JSON.parse(request.messages[1]!.content) as { inferences: Array<{ id: number }> }).inferences.map(({ id }) => id);
// A judge that replies to each inference as given for its id.
const byInference = (replies: Readonly<Record<number, () => Promise<LlmChatResult>>>) => (request: LlmChatRequest) => replies[asked(request)[0]!]!();

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const turn = (recorded: TurnTrace) => ({ thread_id: recorded.thread_id, run_id: recorded.run_id, question: recorded.question });
const text = (blocks: ReadonlyArray<Record<string, unknown>>) =>
  (blocks[0]!.segments as Array<{ text?: string; format?: string }>).map((segment) => segment.text ?? segment.format).join("");
const judgeRejections = (report: TurnTrace["assertions"]) =>
  (report?.rejected ?? []).filter((entry) => entry.check === "judge").map(({ index, reason }) => [index, reason]);

test("an entailed inference shows as an analyst inference and an unsupported one as an unverified analyst view; until its verdict a line holds its place", async (t) => {
  const logged = t.mock.method(console, "info", () => {});
  const requests: number[][] = [];
  const { calls, createClient } = models(SEGMENTS, async (request) => {
    requests.push(asked(request));
    return { text: asked(request)[0] === 6 ? ENTAILED(6) : UNSUPPORTED_7 };
  });
  const answer = await answerTurn(SEGMENTS.input, turn(SEGMENTS), { env: JUDGED_ENV, createClient });

  assert.equal(text(answer.blocks), [FIGURES, PENDING, PENDING].join("\n\n"));
  const judged = await answer.judging!.done;
  assert.equal(text(judged.blocks), [FIGURES, CONCENTRATED, UNVERIFIED_CUSHION].join("\n\n"));
  assert.deepEqual(judgeRejections(judged.assertions), []);
  assert.deepEqual(judged.assertions?.judged, JUDGED);
  assert.deepEqual(judged.assertions?.accepted.filter((entry) => entry.kind === "analyst_inference").map((entry) => entry.index), [6, 7]);
  assert.deepEqual(calls, ["anthropic/claude-sonnet-5-5", "anthropic/claude-haiku-5-5", "anthropic/claude-haiku-5-5"]);
  assert.deepEqual(requests.sort(), [[6], [7]]);
  assert.deepEqual(logged.mock.calls.map((call) => String(call.arguments[0])).filter((line) => line.startsWith("[chat] judge")), [
    `[chat] judge thread=${SEGMENTS.thread_id} run=${SEGMENTS.run_id} on anthropic/claude-haiku-5-5: 1 shown, 1 unverified, of 2 inferences`,
  ]);
});

test("an unsupported inference's line gives way to its unverified label when its own verdict settles", async () => {
  const slow = deferred<LlmChatResult>();
  const { createClient } = models(SEGMENTS, byInference({ 6: async () => ({ text: ENTAILED(6) }), 7: () => slow.promise }));
  const answer = await answerTurn(SEGMENTS.input, turn(SEGMENTS), { env: JUDGED_ENV, createClient });
  const seen: string[] = [];
  const concentrated = new Promise<void>((resolve) => {
    answer.judging!.watch((blocks) => {
      seen.push(text(blocks));
      if (text(blocks).includes(CONCENTRATED)) resolve();
    });
  });

  await concentrated;
  assert.equal(seen.at(-1), [FIGURES, CONCENTRATED, PENDING].join("\n\n"));
  slow.resolve({ text: UNSUPPORTED_7 });
  assert.equal(text((await answer.judging!.done).blocks), [FIGURES, CONCENTRATED, UNVERIFIED_CUSHION].join("\n\n"));
  assert.equal(seen.at(-1), [FIGURES, CONCENTRATED, UNVERIFIED_CUSHION].join("\n\n"));
});

test("each inference shows as soon as its own verdict arrives, not when a slower sibling's does", async () => {
  const slow = deferred<LlmChatResult>();
  const { createClient } = models(SEGMENTS, byInference({ 6: async () => ({ text: ENTAILED(6) }), 7: () => slow.promise }));
  const answer = await answerTurn(SEGMENTS.input, turn(SEGMENTS), { env: JUDGED_ENV, createClient });
  const seen: string[] = [];
  const concentrated = new Promise<void>((resolve) => {
    answer.judging!.watch((blocks) => {
      seen.push(text(blocks));
      if (text(blocks).includes(CONCENTRATED)) resolve();
    });
  });

  await concentrated;
  assert.equal(seen.at(-1), [FIGURES, CONCENTRATED, PENDING].join("\n\n"));
  slow.resolve({ text: ENTAILED(7) });
  assert.equal(text((await answer.judging!.done).blocks), [FIGURES, CONCENTRATED, CUSHION].join("\n\n"));
  assert.equal(seen.at(-1), [FIGURES, CONCENTRATED, CUSHION].join("\n\n"));
});

test("a verdict listener that throws is dropped, and the others still hear each verdict and the answer is still saved", async (t) => {
  t.mock.method(console, "warn", () => {});
  const slow = deferred<LlmChatResult>();
  const { createClient } = models(SEGMENTS, byInference({ 6: async () => ({ text: ENTAILED(6) }), 7: () => slow.promise }));
  const answer = await answerTurn(SEGMENTS.input, turn(SEGMENTS), { env: JUDGED_ENV, createClient });
  let broken = 0;
  answer.judging!.watch(() => {
    if (++broken > 1) throw new Error("stream closed");
  });
  const seen: string[] = [];
  const concentrated = new Promise<void>((resolve) => {
    answer.judging!.watch((blocks) => {
      seen.push(text(blocks));
      if (text(blocks).includes(CONCENTRATED)) resolve();
    });
  });

  await concentrated;
  slow.resolve({ text: ENTAILED(7) });
  assert.equal(text((await answer.judging!.done).blocks), [FIGURES, CONCENTRATED, CUSHION].join("\n\n"));
  assert.equal(seen.at(-1), [FIGURES, CONCENTRATED, CUSHION].join("\n\n"));
  assert.equal(broken, 2);
});

test("a judge call that fails or runs out of time hides only its own inference", async (t) => {
  const failures: Array<[string, () => Promise<LlmChatResult>]> = [
    ["a failed call", async () => {
      throw new Error("judge provider down");
    }],
    ["past its deadline", () => hang(t)],
  ];
  for (const [label, failing] of failures) {
    const { createClient } = models(SEGMENTS, byInference({ 6: async () => ({ text: ENTAILED(6) }), 7: failing }));
    const answer = await answerTurn(SEGMENTS.input, turn(SEGMENTS), { env: JUDGED_ENV, createClient, judgeDeadlines: { attemptMs: 50, totalMs: 120 } });
    const judged = await answer.judging!.done;
    assert.equal(text(judged.blocks), [FIGURES, CONCENTRATED].join("\n\n"), label);
    assert.deepEqual(judgeRejections(judged.assertions), [[7, "error: judge call failed: all LLM deployments failed"]], label);
  }
});

test("an inference stays hidden when the judge finds it contradicted or stating an amount in words, whatever its verdict, or gives it no verdict: a reply with none for it or no yes-or-no on the amount, a reply that is no verdict list, a failed call, a call past its deadline", async (t) => {
  const cases: Array<[string, (request: LlmChatRequest) => Promise<LlmChatResult>, Array<[number, string]>]> = [
    ["a worded amount, unsupported, and a contradiction", async () => ({ text: '{"verdicts":[{"id":6,"verdict":"unsupported","worded_amount":true,"reason":"it says tens of billions."},{"id":7,"verdict":"contradicted","worded_amount":false,"reason":"Data Center outweighs the other four together."}]}' }), [
      [6, "unsupported, worded_amount: it says tens of billions."],
      [7, "contradicted: Data Center outweighs the other four together."],
    ]],
    ["a worded amount the figures bear out", async () => ({ text: '{"verdicts":[{"id":6,"verdict":"entailed","worded_amount":true,"reason":"it says over ten times the next segment."},{"id":7,"verdict":"contradicted","worded_amount":false,"reason":"x."}]}' }), [
      [6, "entailed, worded_amount: it says over ten times the next segment."],
      [7, "contradicted: x."],
    ]],
    ["no verdict for it, or no yes-or-no on the amount", async () => ({ text: '{"verdicts":[{"id":6,"verdict":"unsupported","reason":"x."},{"id":8,"verdict":"entailed","worded_amount":false}]}' }), [
      [6, "error: no worded_amount for this inference"],
      [7, "error: no verdict for this inference"],
    ]],
    ["no verdict list", async () => ({ text: "Both look fine to me." }), [
      [6, "error: the judge's reply is not a verdict list"],
      [7, "error: the judge's reply is not a verdict list"],
    ]],
    ["a failed call", async () => {
      throw new Error("judge provider down");
    }, [
      [6, "error: judge call failed: all LLM deployments failed"],
      [7, "error: judge call failed: all LLM deployments failed"],
    ]],
    ["past its deadline", () => hang(t), [
      [6, "error: judge call failed: all LLM deployments failed"],
      [7, "error: judge call failed: all LLM deployments failed"],
    ]],
  ];
  for (const [label, judge, hidden] of cases) {
    const { createClient } = models(SEGMENTS, judge);
    const answer = await answerTurn(SEGMENTS.input, turn(SEGMENTS), { env: JUDGED_ENV, createClient, judgeDeadlines: { attemptMs: 50, totalMs: 120 } });
    const judged = await answer.judging!.done;
    assert.equal(text(judged.blocks), FIGURES, label);
    assert.deepEqual(judgeRejections(judged.assertions), hidden, label);
  }
});

test("the report keeps each judged inference's verdict, a hidden one's too, in index order", async () => {
  const { createClient } = models(SEGMENTS, byInference({
    6: async () => ({ text: '{"verdicts":[{"id":6,"verdict":"unsupported","worded_amount":true,"reason":"it says tens of billions."}]}' }),
    7: async () => ({ text: UNSUPPORTED_7 }),
  }));
  const answer = await answerTurn(SEGMENTS.input, turn(SEGMENTS), { env: JUDGED_ENV, createClient });
  const judged = await answer.judging!.done;
  assert.equal(text(judged.blocks), [FIGURES, UNVERIFIED_CUSHION].join("\n\n"));
  assert.deepEqual(judged.assertions?.judged, [
    { index: 6, verdict: "unsupported", worded_amount: true, reason: "it says tens of billions." },
    { index: 7, verdict: "unsupported", worded_amount: false, reason: "no support measures diversification." },
  ]);
  assert.deepEqual(judgeRejections(judged.assertions), [[6, "unsupported, worded_amount: it says tens of billions."]]);
});

test("with no judge model configured no judge is asked, and no inference shows or waits", async () => {
  const { calls, createClient } = models(SEGMENTS, async () => assert.fail("no judge call without JUDGE_LITELLM_MODEL"));
  const answer = await answerTurn(SEGMENTS.input, turn(SEGMENTS), { env: ENV, createClient });
  assert.equal(answer.judging, undefined);
  assert.equal(text(answer.blocks), FIGURES);
  assert.deepEqual(judgeRejections(answer.assertions), [[6, "error: no judge model is configured"], [7, "error: no judge model is configured"]]);
  assert.deepEqual(calls, ["anthropic/claude-sonnet-5-5"]);
});

test("an inference whose supports all failed their checks is not judged or shown; it goes to the repair round, which the answer model's reply here does not repair", async () => {
  // The ranking is wrong, so the comparison both inferences rest on is rejected.
  const unsupported = { ...SEGMENTS, exchange: { ...SEGMENTS.exchange!, text: SEGMENTS.exchange!.text.replace('"op":"order","result":["F1","F2"', '"op":"order","result":["F2","F1"') } };
  const { calls, createClient } = models(unsupported, async () => assert.fail("nothing left to judge"));
  const answer = await answerTurn(unsupported.input, turn(unsupported), { env: JUDGED_ENV, createClient });
  assert.equal(text(answer.blocks).includes("Analyst inference"), false);
  const done = await answer.judging!.done;
  assert.equal(text(done.blocks).includes("Analyst inference"), false);
  assert.deepEqual(done.assertions?.rejected.filter((entry) => entry.index === 6 || entry.index === 7).map(({ index, check }) => [index, check]), [[6, "support"], [7, "support"]]);
  // The answer, then the repair on the answer's model: its list names no index to replace.
  assert.deepEqual(calls, ["anthropic/claude-sonnet-5-5", "anthropic/claude-sonnet-5-5"]);
});

test("a turn that shows no inference makes no judge call: none rendered, or the fallback shown", async () => {
  const cases: TurnTrace[] = [
    NO_INFERENCE,
    // Its inferences are listed, but the list does not parse: the reader sees the fallback sentence.
    { ...SEGMENTS, exchange: { ...SEGMENTS.exchange!, text: SEGMENTS.exchange!.text.replace("```assertions\n[", "```assertions\n{") } },
  ];
  for (const recorded of cases) {
    const { calls, createClient } = models(recorded, async () => ({ text: VERDICTS }));
    const answer = await answerTurn(recorded.input, turn(recorded), { env: JUDGED_ENV, createClient });
    assert.equal(answer.judging, undefined);
    assert.deepEqual(calls, ["anthropic/claude-sonnet-5-5"]);
  }
});

test("the trace holds what the reader ended with and each judge call's raw reply, and replays to the same blocks with no model", async () => {
  const dir = await mkdtemp(join(tmpdir(), "judge-gate-"));
  const { createClient } = models(SEGMENTS, byInference({
    6: async () => ({ text: ENTAILED(6), usage: { inputTokens: 1200, outputTokens: 80, totalTokens: 1280 } }),
    7: async () => ({ text: UNSUPPORTED_7, usage: { inputTokens: 1100, outputTokens: 90, totalTokens: 1190 } }),
  }));
  const answer = await answerTurn(SEGMENTS.input, turn(SEGMENTS), { env: JUDGED_ENV, createClient, traceDir: dir });
  const judged = await answer.judging!.done;

  const written = JSON.parse(await readFile(join(dir, SEGMENTS.thread_id, `${SEGMENTS.run_id}.json`), "utf8")) as TurnTrace;
  assert.equal(written.version, 2);
  assert.deepEqual(written.blocks, JSON.parse(JSON.stringify(judged.blocks)));
  assert.deepEqual(written.assertions, JSON.parse(JSON.stringify(judged.assertions)));
  assert.deepEqual(written.assertions?.judged, JUDGED);
  assert.deepEqual((written.judge as Array<JudgeRecord>).map((record) => record.outcome === "replied" && { asked: asked(record.exchange), text: record.exchange.text, deployment: record.exchange.deployment, usage: record.exchange.usage }), [
    { asked: [6], text: ENTAILED(6), deployment: "anthropic/claude-haiku-5-5", usage: { input_tokens: 1200, output_tokens: 80 } },
    { asked: [7], text: UNSUPPORTED_7, deployment: "anthropic/claude-haiku-5-5", usage: { input_tokens: 1100, output_tokens: 90 } },
  ]);

  const replayed = await replayRecorded(written);
  assert.equal(text(replayed.blocks), [FIGURES, CONCENTRATED, UNVERIFIED_CUSHION].join("\n\n"));
  assert.deepEqual(JSON.parse(JSON.stringify(replayed.blocks)), written.blocks);
  assert.deepEqual(replayed.assertions?.judged, JUDGED);
  assert.equal(replayed.judge_input_changed, false);
});

test("one recorded judge call for every inference replays each one's verdict from it", async () => {
  const replayed = await replayRecorded({ ...SEGMENTS, judge: { outcome: "replied", exchange: { messages: [], text: VERDICTS, truncated: false, deployment: "anthropic/claude-haiku-5-5", latency_ms: 4700 } } });
  assert.equal(text(replayed.blocks), [FIGURES, CONCENTRATED, UNVERIFIED_CUSHION].join("\n\n"));
  assert.deepEqual(replayed.assertions?.judged, JUDGED);
});

test("a trace recorded before the judge gated inferences replays them hidden: no judge reply was recorded", async () => {
  const replayed = await replayRecorded({ ...SEGMENTS, version: 1 as never, judge: undefined });
  assert.equal(text(replayed.blocks), FIGURES);
  assert.deepEqual(judgeRejections(replayed.assertions), [[6, "error: this trace recorded no judge reply"], [7, "error: this trace recorded no judge reply"]]);
});

test("a recorded reply that answers other inferences than today's is replayed as recorded, and flagged", async () => {
  const recorded = { ...SEGMENTS, judge: { outcome: "replied" as const, exchange: { messages: [{ role: "user", content: "an older answer" }], text: VERDICTS, truncated: false, deployment: "anthropic/claude-haiku-5-5", latency_ms: 4700 } } };
  const replayed = await replayRecorded(recorded);
  assert.equal(text(replayed.blocks), [FIGURES, CONCENTRATED, UNVERIFIED_CUSHION].join("\n\n"));
  assert.equal(replayed.judge_input_changed, true);
});

test("inferences the judge entails show in their assertion order, whichever verdict arrives first", async () => {
  const slow = deferred<LlmChatResult>();
  const { createClient } = models(SEGMENTS, byInference({ 6: () => slow.promise, 7: async () => ({ text: ENTAILED(7) }) }));
  const answer = await answerTurn(SEGMENTS.input, turn(SEGMENTS), { env: JUDGED_ENV, createClient });
  const cushion = new Promise<string>((resolve) => {
    answer.judging!.watch((blocks) => {
      if (text(blocks).includes(CUSHION)) resolve(text(blocks));
    });
  });
  assert.equal(await cushion, [FIGURES, PENDING, CUSHION].join("\n\n"));
  slow.resolve({ text: ENTAILED(6) });
  assert.equal(text((await answer.judging!.done).blocks), [FIGURES, CONCENTRATED, CUSHION].join("\n\n"));
});

// A judge that accepts the request and never answers. Its open connection keeps
// the event loop alive; a bare pending promise doesn't (the deadline timers are
// unref'd, and on Node 22 the runner then cancels the test), so the interval
// stands in for it.
function hang(t: { after(fn: () => void): void }): Promise<never> {
  const connection = setInterval(() => {}, 1_000);
  t.after(() => clearInterval(connection));
  return new Promise<never>(() => {});
}

test("an inference with no judge record of its own stays hidden; the answer is still written (#477 review)", async () => {
  const { createClient } = models(SEGMENTS, async () => ({ text: ENTAILED(6) }));
  const composed = await composeTraced(SEGMENTS.input, { env: ENV, createClient });
  const { cases } = inferenceCases(SEGMENTS.input, composed.assertions);
  const entailed6: JudgeRecord = { outcome: "replied", exchange: { messages: [], text: ENTAILED(6), truncated: false, deployment: "anthropic/claude-haiku-5-5", latency_ms: 1000 } };
  const judged = judgedAnswer(composed, cases, [entailed6]);
  assert.equal(text(judged.blocks), [FIGURES, CONCENTRATED].join("\n\n"));
  assert.deepEqual(judgeRejections(judged.assertions), [[7, "error: no judge record for this inference"]]);
});
