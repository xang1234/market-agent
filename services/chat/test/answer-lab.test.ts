import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

import { composeTraced, judgedLive, replayRecorded } from "../src/answer-trace.ts";
import { answerText, assertionSummary, judgeSummary, live, mutationSummary, mutationVariants, primaryDeployment, readTraces, recorded, replyFixture, rerecord } from "../scripts/answer-lab.ts";
import { createReplayLlmChatClient } from "../../llm/src/replay-client.ts";
import { REPAIR_INSTRUCTIONS } from "../src/inference-repair.ts";

// One live research-quality eval run's turns (scripts/research-quality-eval.ts).
const TRACES = readTraces([fileURLToPath(new URL("./answer-lab/traces/", import.meta.url))]);

test("the recorded traces cover the eval", () => {
  assert.equal(TRACES.length, 14);
});

for (const { label, trace } of TRACES) {
  test(`${label}: the recorded reply replays to the recorded blocks`, async () => {
    const replayed = await replayRecorded(trace);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(replayed.blocks)), trace.blocks);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(replayed.assertions)), trace.assertions);
  });
}

// Writes each trace as its file under a fresh directory; returns that directory.
function traceFiles(files: Record<string, object>): string {
  const root = mkdtempSync(join(tmpdir(), "answer-lab-"));
  for (const [file, trace] of Object.entries(files)) {
    mkdirSync(join(root, file, ".."), { recursive: true });
    writeFileSync(join(root, file), JSON.stringify(trace));
  }
  return root;
}

test("traces are keyed by the turn they record, whatever their file names", () => {
  const [first] = TRACES;
  const turn = (run_id: string) => ({ ...first!.trace, run_id, turn_id: undefined });
  const root = traceFiles({ "a/run.json": turn("run-a"), "b/run.json": turn("run-b"), "run": turn("run-c") });
  const keyed = readTraces(["a/run.json", "b/run.json", "run"].map((file) => join(root, file)));
  assert.deepEqual(keyed.map(({ key, label }) => [key, label]), [
    [`${first!.trace.thread_id}/run-a`, "run"],
    [`${first!.trace.thread_id}/run-b`, "run"],
    [`${first!.trace.thread_id}/run-c`, "run"],
  ]);
});

test("the keys do not depend on the order traces are given in", () => {
  const [first, second, third] = TRACES;
  const root = traceFiles({ "fixtures/x.json": first!.trace, "y.json": second!.trace, "z.json": third!.trace });
  const inputs = ["fixtures", "y.json", "z.json"].map((path) => join(root, path));
  const keys = (paths: string[]) => readTraces(paths).map(({ key }) => key).sort();
  assert.deepEqual(keys([inputs[2]!, inputs[0]!, inputs[1]!]), keys(inputs));
});

test("one turn given twice is an error, not a guess", () => {
  const [first] = TRACES;
  const root = traceFiles({ "fixtures/run.json": first!.trace });
  assert.throws(() => readTraces([join(root, "fixtures"), join(root, "fixtures/run.json")]), /is given twice/);
});

test("a file without a turn's ids is refused, by name", () => {
  const [first] = TRACES;
  const root = traceFiles({ "handmade.json": { ...first!.trace, thread_id: undefined } });
  assert.throws(() => readTraces([join(root, "handmade.json")]), /handmade\.json is not a turn trace/);
});

test("a live sample's answer reads as the user sees it: text as written, each ref its displayed value", () => {
  const blocks = [
    { kind: "metric_row", items: [] },
    { kind: "rich_text", segments: [{ type: "text", text: "NVDA's revenue was " }, { type: "ref", ref_kind: "fact", ref_id: "f1", format: "$62.1B" }, { type: "text", text: "." }] },
    { kind: "rich_text", segments: [{ type: "text", text: "Second block." }] },
  ];
  assert.equal(answerText(blocks), "NVDA's revenue was $62.1B.\n\nSecond block.");
});

test("a live run's summary counts rendered answers, accepted kinds, repeated observations and rejections by reason", () => {
  const metrics = { figure_refs: 0, plain_numbers: 0, fallback: false, accepted: 0, rejected: 0, inferences_shown: 0, inferences_unverified: 0, inferences_hidden: 0, inferences_sent_to_repair: 0, inferences_repaired: 0, inferences_recovered: 0, repair_latency_ms: 0, repair_input_tokens: 0, repair_output_tokens: 0, output_tokens: 0, latency_ms: 0 };
  const summary = assertionSummary({
    results: [
      { trace: "a", sample: 0, metrics, assertions: { rendered: true, accepted: ["observation", "analyst_inference", "observation"], rejected: ["x", "y"], repeated: 2 } },
      { trace: "b", sample: 0, metrics, assertions: { rendered: false, accepted: ["comparison"], rejected: ["y"] } },
      { trace: "c", sample: 0, error: "timeout" },
    ],
  });
  assert.equal(summary, [
    "rendered: 1 of 2 answers",
    "accepted: 2 observation, 1 analyst_inference, 1 comparison",
    "repeated: 2 observations a comparison already shows",
    "rejected:",
    "    2  y",
    "    1  x",
  ].join("\n"));
});

test("the traces' reply fixture answers each traced question as recorded, and a title as the golden test does (DEV_NO_KEYS=traces)", async () => {
  const traces = readTraces([fileURLToPath(new URL("./answer-lab/traces", import.meta.url))]);
  const golden = { replies: [{ match: "Create a short, specific research chat title", text: "NVDA research" }, { match: "Write a concise", text: "golden" }] };
  const dir = mkdtempSync(join(tmpdir(), "replies-"));
  const file = join(dir, "replies.json");
  writeFileSync(file, JSON.stringify(replyFixture(traces, golden)));
  const reply = await createReplayLlmChatClient(file);
  const ask = async (content: string) => (await reply({} as never, { messages: [{ role: "user", content }] } as never)).text;
  // Each trace's own recorded request gets its own reply.
  for (const { label, trace } of traces) {
    assert.equal(await ask(trace.exchange!.messages.map((message) => message.content).join("\n")), trace.exchange!.text, label);
  }
  // A short question asked after a longer one in its thread: the history quotes the longer one.
  const recorded = (question: string) => traces.find(({ trace }) => trace.question === question)!.trace.exchange!.text;
  assert.equal(await ask(JSON.stringify({ conversation: ["Analyze NVDA's latest quarter."], question: "Analyze NVDA." })), recorded("Analyze NVDA."));
  assert.equal(await ask("Create a short, specific research chat title for: Compare NVDA with AMD."), "NVDA research");
});

const MUTATIONS = fileURLToPath(new URL("./answer-lab/judge-mutations.json", import.meta.url));

test("the judge's mutation set: every original and mutation passes the turn's own checks, so each is a gap only the judge can catch (#302)", () => {
  const variants = mutationVariants(MUTATIONS);
  const count = (key: (variant: (typeof variants)[number]) => string) =>
    Object.fromEntries([...new Set(variants.map(key))].map((value) => [value, variants.filter((variant) => key(variant) === value).length]));
  const cases = (JSON.parse(readFileSync(MUTATIONS, "utf8")) as { cases: Array<{ id: string; trace: string; index: number }> }).cases;
  assert.deepEqual(cases.filter((entry, i) => cases.findIndex((other) => other.trace === entry.trace && other.index === entry.index) !== i).map(({ id }) => id), []);
  assert.deepEqual(count((variant) => variant.kind), {
    original: 12,
    worded_amount: 10,
    unsupported_claim: 5,
    contradicted_ranking: 5,
    hedged_valuation: 3,
    flipped_direction: 6,
  });
  // The judge reads a case on its trace's packet: the peer case's label is its comparisons' checked results.
  const peer = variants.find((variant) => variant.id === "peer-lead" && variant.kind === "original")!;
  assert.deepEqual([peer.judged.subject, peer.judged.checked, peer.companies], ["NVDA", [
    "revenue highest first: NVDA, AMD",
    "gross margin highest first: NVDA, AMD",
    "net margin highest first: NVDA, AMD",
    "revenue growth (YoY) highest first: NVDA, AMD",
    "price return highest first: NVDA, AMD",
  ], ["NVDA", "AMD"]]);
  const offset = variants.find((variant) => variant.id === "operating-offset" && variant.kind === "original")!;
  assert.deepEqual([offset.judged.supports, offset.judged.context[0]], [
    ["AMD's net income was $872.0M and net margin 11.3% in Q2 2025 (ended Jun 2025)."],
    "AMD's revenue was $7.7B, operating income -$134.0M and operating margin -1.7% in Q2 2025 (ended Jun 2025).",
  ]);
  // A block case's recovery is on the page only in its gross margin chart.
  const recovery = variants.find((variant) => variant.id === "margin-recovery" && variant.kind === "original")!;
  const after = (lines: ReadonlyArray<string>) => lines.filter((line) => line.includes("Q3 2025"));
  assert.deepEqual([after(recovery.judged.supports), after(recovery.judged.context), recovery.judged.figures[2]], [
    [],
    [],
    "Gross margin by quarter: AMD's gross margin was 50.1% in Q3 2024 (ended Sep 2024); AMD's gross margin was 51.0% in Q4 2024 (ended Dec 2024); AMD's gross margin was 50.2% in Q1 2025 (ended Mar 2025); AMD's gross margin was 39.8% in Q2 2025 (ended Jun 2025); AMD's gross margin was 53.6% in Q3 2025 (ended Sep 2025); AMD's gross margin was 54.0% in Q4 2025 (ended Dec 2025); AMD's gross margin was 54.0% in Q1 2026 (ended Mar 2026); AMD's gross margin was 54.0% in Q2 2026 (ended Jun 2026).",
  ]);
});

test("a set inference the turn's checks already reject fails the set, rather than inflate the catch rate", () => {
  const dir = mkdtempSync(join(tmpdir(), "judge-mutations-"));
  const file = join(dir, "set.json");
  writeFileSync(file, JSON.stringify({ cases: [{
    id: "typed",
    trace: fileURLToPath(new URL("./answer-lab/traces/segment-drill-down.json", import.meta.url)),
    index: 3,
    supports: [0, 1, 2],
    originals: ["Data Center dominates the top line."],
    mutations: [{ kind: "worded_amount", text: "Data Center brings in 90% of the top line." }],
  }] }));
  assert.throws(() => mutationVariants(file), {
    message: "typed worded_amount: the turn's checks reject it (an inference rests on its supports; it writes no figure); the set holds only inferences they pass",
  });
});

test("the mutation summary counts catches, each kind at its expected outcome, mutations shown above their tier, contradictions shown, and false alarms on originals; an error is none of these", () => {
  const result = (id: string, kind: string, verdict: string, worded_amount: boolean, reason?: string) =>
    ({ id, kind, text: `${id} ${kind}`, verdict: { index: 0, verdict, ...(verdict === "error" ? {} : { worded_amount }), ...(reason ? { reason } : {}) } }) as Parameters<typeof mutationSummary>[0][number];
  assert.equal(mutationSummary([
    result("a", "original", "entailed", false),
    result("a", "worded_amount", "unsupported", true, "says tens of billions"),
    result("a", "worded_amount", "unsupported", false, "a forecast the figures do not show"),
    result("a", "hedged_valuation", "entailed", false),
    result("a", "contradicted_ranking", "unsupported", false, "no figure ranks them"),
    result("b", "original", "unsupported", false, "no figure shows it"),
    result("b", "flipped_direction", "error", false, "judge call failed: timeout"),
    result("b", "unsupported_claim", "contradicted", false, "revenue rose"),
    result("c", "contradicted_ranking", "contradicted", false, "NVDA is highest"),
    result("c", "worded_amount", "entailed", false),
  ]), [
    "caught: 5 of 8 mutations (1 errors)",
    "at their tier: 2 of 8 mutations",
    "  worded_amount          worded_amount 1 of 3",
    "  unsupported_claim      unsupported   0 of 1",
    "  hedged_valuation       unsupported   0 of 1",
    "  flipped_direction      contradicted  0 of 1",
    "  contradicted_ranking   contradicted  1 of 2",
    "shown above their tier: 3 of 8 mutations",
    "contradicted shown: 0 of 10",
    "false alarms: 1 of 2 originals (0 errors)",
    "not at their expected outcome:",
    "  a worded_amount: unsupported: a forecast the figures do not show\n      a worded_amount",
    "  a hedged_valuation: entailed\n      a hedged_valuation",
    "  a contradicted_ranking: unsupported: no figure ranks them\n      a contradicted_ranking",
    "  b original: unsupported: no figure shows it\n      b original",
    "  b flipped_direction: error: judge call failed: timeout\n      b flipped_direction",
    "  b unsupported_claim: contradicted: revenue rose\n      b unsupported_claim",
    "  c worded_amount: entailed\n      c worded_amount",
  ].join("\n"));
});

test("a run with no judge configured counts each inference not called", () => {
  const metrics = { figure_refs: 0, plain_numbers: 0, fallback: false, accepted: 0, rejected: 0, inferences_shown: 0, inferences_unverified: 0, inferences_hidden: 2, inferences_sent_to_repair: 0, inferences_repaired: 0, inferences_recovered: 0, repair_latency_ms: 0, repair_input_tokens: 0, repair_output_tokens: 0, output_tokens: 0, latency_ms: 0 };
  const none = { outcome: "not_called" as const, reason: "no judge model is configured" };
  const judge = { records: [none, none], flagged: [] };
  const summary = judgeSummary({ results: [{ trace: "a", sample: 0, metrics, judge }, { trace: "b", sample: 0, metrics, judge }] });
  assert.equal(summary.split("\n")[0], "judge: 0 shown, 0 unverified, 4 hidden, in 2 answers (0 replied, 0 failed, 4 not called)");
});

test("a judged run's summary counts the inferences shown, unverified and hidden, what the judge did per inference, its cost per reply, and each inference it showed as unverified or left out", () => {
  const metrics = (shown: number, unverified: number, hidden: number) =>
    ({ figure_refs: 0, plain_numbers: 0, fallback: false, accepted: 0, rejected: 0, inferences_shown: shown, inferences_unverified: unverified, inferences_hidden: hidden, inferences_sent_to_repair: 0, inferences_repaired: 0, inferences_recovered: 0, repair_latency_ms: 0, repair_input_tokens: 0, repair_output_tokens: 0, output_tokens: 0, latency_ms: 0 });
  const replied = {
    outcome: "replied" as const,
    exchange: { messages: [], text: "{}", truncated: false, deployment: "anthropic/claude-haiku-5-5", latency_ms: 2000, usage: { input_tokens: 1000, output_tokens: 100 } },
  };
  const summary = judgeSummary({
    labels: { a: "peer-two" },
    results: [
      {
        trace: "a",
        sample: 1,
        metrics: metrics(1, 1, 1),
        judge: {
          records: [replied, { ...replied, exchange: { ...replied.exchange } }, { ...replied, exchange: { ...replied.exchange } }],
          flagged: [
            { index: 10, as: "hidden", text: "amd leads.", reason: "contradicted: NVDA is highest." },
            { index: 11, as: "unverified", text: "Its lead may narrow.", reason: "unsupported: a forecast the figures do not show." },
          ],
        },
      },
      { trace: "a", sample: 2, metrics: metrics(0, 0, 1), judge: { records: [{ outcome: "failed", reason: "judge call failed: timeout", latency_ms: 8000 }], flagged: [{ index: 3, as: "hidden", text: "It leads.", reason: "error: judge call failed: timeout" }] } },
      { trace: "b", sample: 0 },
    ],
  });
  assert.equal(summary, [
    "judge: 1 shown, 1 unverified, 2 hidden, in 2 answers (3 replied, 1 failed, 0 not called)",
    "judge per reply: 2000 ms, 1000 in / 100 out tokens, on anthropic/claude-haiku-5-5",
    "  hidden  peer-two #1 [10] amd leads.\n      contradicted: NVDA is highest.",
    "  unverified  peer-two #1 [11] Its lead may narrow.\n      unsupported: a forecast the figures do not show.",
    "  hidden  peer-two #2 [3] It leads.\n      error: judge call failed: timeout",
  ].join("\n"));
});

test("recorded replays each trace with the judge reply it recorded, and summarizes what that showed, showed as unverified and hid", async () => {
  const { trace } = TRACES.find(({ label }) => label === "segment-drill-down")!;
  const reply = (text: string, latency_ms: number, usage: { input_tokens: number; output_tokens: number }) =>
    ({ outcome: "replied", exchange: { messages: [], text, truncated: false, deployment: "anthropic/claude-haiku-5-5", latency_ms, usage } });
  const judge = [
    reply('{"verdicts":[{"id":3,"verdict":"entailed","worded_amount":false}]}', 3000, { input_tokens: 500, output_tokens: 100 }),
    reply('{"verdicts":[{"id":4,"verdict":"unsupported","worded_amount":false,"reason":"no support measures the trend."}]}', 4000, { input_tokens: 600, output_tokens: 200 }),
  ];
  const root = traceFiles({ "judged.json": { ...trace, judge }, "missing-cash-flow.json": TRACES.find(({ label }) => label === "missing-cash-flow")!.trace });
  const script = fileURLToPath(new URL("../scripts/answer-lab.ts", import.meta.url));
  const { stdout } = await promisify(execFile)(process.execPath, ["--experimental-strip-types", script, "recorded", root]);
  assert.equal(stdout.slice(stdout.indexOf("as recorded")), [
    "as recorded, judge: 1 shown, 1 unverified, 0 hidden, in 1 answers (2 replied, 0 failed, 0 not called)",
    "judge per reply: 3500 ms, 550 in / 150 out tokens, on anthropic/claude-haiku-5-5",
    "  unverified  judged #0 [4] Counterpoint: only one quarter of segment data is shown, so the data cannot show whether this concentration is rising or falling.",
    "      unsupported: no support measures the trend.",
    "",
  ].join("\n"));
});

test("recorded counts the cost of a trace's one batched judge call once, though each inference replays its verdict from it", async () => {
  const { trace } = TRACES.find(({ label }) => label === "segment-drill-down")!;
  const judge = {
    outcome: "replied",
    exchange: {
      messages: [],
      text: '{"verdicts":[{"id":3,"verdict":"entailed","worded_amount":false},{"id":4,"verdict":"contradicted","worded_amount":false,"reason":"the segments shown span more than one quarter."}]}',
      truncated: false,
      deployment: "anthropic/claude-haiku-5-5",
      latency_ms: 3000,
      usage: { input_tokens: 500, output_tokens: 100 },
    },
  };
  const root = traceFiles({ "batched.json": { ...trace, judge } });
  const script = fileURLToPath(new URL("../scripts/answer-lab.ts", import.meta.url));
  const { stdout } = await promisify(execFile)(process.execPath, ["--experimental-strip-types", script, "recorded", root]);
  assert.equal(stdout.slice(stdout.indexOf("as recorded")).split("\n").slice(0, 2).join("\n"), [
    "as recorded, judge: 1 shown, 0 unverified, 1 hidden, in 1 answers (2 replied, 0 failed, 0 not called)",
    "judge per reply: 3000 ms, 500 in / 100 out tokens, on anthropic/claude-haiku-5-5",
  ].join("\n"));
});

test("recorded reports an edit to the answer's system prompt once, not as each repaired trace's changed repair input; a change to the repair request itself still flags its trace", async () => {
  const underOldPrompt = (label: string, user?: string) => {
    const { trace } = TRACES.find((traced) => traced.label === label)!;
    const record = trace.repair!.record as Extract<NonNullable<typeof trace.repair>["record"], { outcome: "replied" }>;
    const [, recordedUser] = record.exchange.messages;
    const messages = [{ role: "system", content: "an older answer prompt" }, user === undefined ? recordedUser : { ...recordedUser, content: user }];
    return { ...trace, repair: { ...trace.repair, record: { ...record, exchange: { ...record.exchange, messages } } } };
  };
  const root = traceFiles({
    "fiscal-year-trap.json": underOldPrompt("fiscal-year-trap"),
    "margin-trend-loss-quarter.json": underOldPrompt("margin-trend-loss-quarter"),
    "what-changed-gross-margin.json": underOldPrompt("what-changed-gross-margin", "another repair request"),
  });
  const script = fileURLToPath(new URL("../scripts/answer-lab.ts", import.meta.url));
  const { stdout } = await promisify(execFile)(process.execPath, ["--experimental-strip-types", script, "recorded", root, "--check"]);
  const lines = stdout.split("\n");
  assert.deepEqual(lines.filter((line) => line.includes("REPAIR INPUT CHANGED")).map((line) => line.split(" ")[0]), ["what-changed-gross-margin"]);
  assert.deepEqual(lines.filter((line) => line.startsWith("system prompt changed")).map((line) => line.replace(/today's is \w+/, "today's is <hash>")), [
    "system prompt changed: 3 repair rounds were recorded under 5c3d808c0eb5, today's is <hash> (fiscal-year-trap, margin-trend-loss-quarter, what-changed-gross-margin)",
  ]);
});

test("live --judge --update re-records a trace that recorded --check replays to the same blocks", async () => {
  const [source] = readTraces([traceFiles({ "segment-drill-down.json": TRACES.find(({ label }) => label === "segment-drill-down")!.trace })]);
  const { trace } = source!;
  const env = { LLM_CHANNELS: "openai", LLM_OPENAI_PROTOCOL: "openai", LLM_OPENAI_MODELS: "gpt-4.1", LITELLM_MODEL: "openai/gpt-4.1", JUDGE_LITELLM_MODEL: "openai/gpt-4.1" };
  const list = trace.exchange!.text.slice(trace.exchange!.text.indexOf("```assertions"));
  const createClient = () => async (_deployment: unknown, request: { messages: ReadonlyArray<{ content: string }> }) => {
    const transcript = request.messages.map((message) => message.content).join("\n");
    if (transcript.includes(REPAIR_INSTRUCTIONS)) return { text: "```assertions\n[]\n```" };
    if (transcript.startsWith("You check the analyst inferences")) {
      return { text: '{"verdicts":[{"id":3,"verdict":"entailed","worded_amount":false},{"id":4,"verdict":"unsupported","worded_amount":false,"reason":"no support measures the trend."}]}' };
    }
    return { text: list };
  };
  const composed = await composeTraced(trace.input, { env, createClient: createClient as never });
  const answer = await judgedLive(trace.input, composed, { env, createClient: createClient as never });
  rerecord(source!, answer, "openai/gpt-4.1");

  const [written] = readTraces([source!.file]);
  assert.equal(written!.trace.exchange!.text, list);
  assert.equal("removed" in written!.trace, false, "a field TurnTrace no longer has does not carry over");
  const { judge_input_changed, repair_input_changed, ...replayed } = await replayRecorded(written!.trace);
  assert.deepEqual([judge_input_changed, repair_input_changed], [false, false]);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(replayed.blocks)), written!.trace.blocks);
  assert.deepEqual(replayed.assertions?.judged?.map((verdict) => [verdict.index, verdict.verdict]), [[3, "entailed"], [4, "unsupported"]]);
});

test("live --judge --update leaves a trace as it was when the answer was cut off, the judge failed, or no judge is configured", async () => {
  const { trace } = TRACES.find(({ label }) => label === "segment-drill-down")!;
  const env = { LLM_CHANNELS: "openai", LLM_OPENAI_PROTOCOL: "openai", LLM_OPENAI_MODELS: "gpt-4.1", LITELLM_MODEL: "openai/gpt-4.1", JUDGE_LITELLM_MODEL: "openai/gpt-4.1" };
  const list = trace.exchange!.text.slice(trace.exchange!.text.indexOf("```assertions"));
  const entailed = async () => ({ text: '{"verdicts":[{"id":3,"verdict":"entailed","worded_amount":false},{"id":4,"verdict":"entailed","worded_amount":false}]}' });
  const { JUDGE_LITELLM_MODEL: _, ...unjudged } = env;
  const runs = {
    "cut off": { env, truncated: true, judge: entailed },
    "judge failed": { env, truncated: false, judge: async () => { throw new Error("judge unavailable"); } },
    "no judge": { env: unjudged, truncated: false, judge: entailed },
  };
  const skipped: Array<[string, string | undefined]> = [];
  for (const [name, run] of Object.entries(runs)) {
    const [source] = readTraces([traceFiles({ "segment-drill-down.json": trace })]);
    const before = readFileSync(source!.file, "utf8");
    const createClient = () => async (_deployment: unknown, request: { messages: ReadonlyArray<{ content: string }> }) => {
      if (request.messages.map((message) => message.content).join("\n").startsWith("You check the analyst inferences")) return run.judge();
      return { text: list, truncated: run.truncated };
    };
    const composed = await composeTraced(trace.input, { env: run.env, createClient: createClient as never });
    const answer = await judgedLive(trace.input, composed, { env: run.env, createClient: createClient as never });
    skipped.push([name, rerecord(source!, answer, "openai/gpt-4.1")]);
    assert.equal(readFileSync(source!.file, "utf8"), before, name);
  }
  assert.deepEqual(skipped, [
    ["cut off", "the answer was cut off at the token limit"],
    ["judge failed", "judge call failed: all LLM deployments failed"],
    ["no judge", "no judge model is configured"],
  ]);
});

test("live --judge --update leaves a trace as it was when a fallback model answered or repaired, or the judge gave an inference no verdict", async () => {
  const { trace } = TRACES.find(({ label }) => label === "segment-drill-down")!;
  const env = {
    LLM_CHANNELS: "openai", LLM_OPENAI_PROTOCOL: "openai", LLM_OPENAI_MODELS: "gpt-4.1,gpt-4.1-mini",
    LITELLM_MODEL: "openai/gpt-4.1", LITELLM_FALLBACK_MODELS: "openai/gpt-4.1-mini", JUDGE_LITELLM_MODEL: "openai/gpt-4.1",
  };
  assert.equal(await primaryDeployment(env), "openai/gpt-4.1");
  const list = trace.exchange!.text.slice(trace.exchange!.text.indexOf("```assertions"));
  const contradicted = '{"verdicts":[{"id":3,"verdict":"contradicted","worded_amount":false},{"id":4,"verdict":"entailed","worded_amount":false}]}';
  const runs = {
    "answer on a fallback": { primaryFails: "answer", judge: contradicted },
    "repair on a fallback": { primaryFails: "repair", judge: contradicted },
    "no verdict for an inference": { primaryFails: null, judge: '{"verdicts":[]}' },
  };
  const written = [];
  const skipped: Array<[string, string | undefined]> = [];
  for (const [name, run] of Object.entries(runs)) {
    const [source] = readTraces([traceFiles({ "segment-drill-down.json": trace })]);
    const before = readFileSync(source!.file, "utf8");
    const createClient = () => async (deployment: { model: string }, request: { messages: ReadonlyArray<{ content: string }> }) => {
      const transcript = request.messages.map((message) => message.content).join("\n");
      const call = transcript.includes(REPAIR_INSTRUCTIONS) ? "repair" : transcript.startsWith("You check the analyst inferences") ? "judge" : "answer";
      if (call === run.primaryFails && deployment.model === "gpt-4.1") throw new Error("primary unavailable");
      return { text: call === "judge" ? run.judge : call === "repair" ? "```assertions\n[]\n```" : list };
    };
    const composed = await composeTraced(trace.input, { env, createClient: createClient as never });
    // Today's repair deadline fits one attempt; these fit its fallback too.
    const answer = await judgedLive(trace.input, composed, { env, createClient: createClient as never, repairDeadlines: { attemptMs: 15_000, totalMs: 45_000 } });
    skipped.push([name, rerecord(source!, answer, "openai/gpt-4.1")]);
    if (readFileSync(source!.file, "utf8") !== before) written.push(name);
  }
  assert.deepEqual(written, []);
  assert.deepEqual(skipped, [
    ["answer on a fallback", "the answer came from openai/gpt-4.1-mini, not the primary openai/gpt-4.1"],
    ["repair on a fallback", "the repair came from openai/gpt-4.1-mini, not the primary openai/gpt-4.1"],
    ["no verdict for an inference", "inference 3 has no verdict: no verdict for this inference"],
  ]);
});

test("live --judge --update re-records a thread's turns in their order, each later one asked after the answer its earlier turn just recorded", async () => {
  const turn = (n: number) => TRACES.find(({ label }) => label === `follow-up-memory.turn-${n}`)!.trace;
  const traces = readTraces([traceFiles({ "a-turn-2.json": turn(2), "b-turn-1.json": withNote(turn(1), "Segment revenue is not available for NVDA in this data.") })]);
  const env = { LLM_CHANNELS: "openai", LLM_OPENAI_PROTOCOL: "openai", LLM_OPENAI_MODELS: "gpt-4.1", LITELLM_MODEL: "openai/gpt-4.1", JUDGE_LITELLM_MODEL: "openai/gpt-4.1" };
  const asked: unknown[] = [];
  const createClient = () => async (_deployment: unknown, request: { messages: ReadonlyArray<{ content: string }> }) => {
    asked.push(JSON.parse(request.messages[1]!.content).conversation);
    return { text: "```assertions\n[]\n```" };
  };
  await live(traces, 1, 2, true, (traced, answer) => rerecord(traced, answer, "openai/gpt-4.1"), { env, createClient: createClient as never });

  const first = [{ role: "user", text: "Analyze NVDA." }];
  const second = [
    ...first,
    { role: "assistant", text: "The reported figures below come from the company's filings; select any value to see its source. Segment revenue is not available for NVDA in this data." },
    { role: "user", text: "Compare it with AMD YTD." },
  ];
  assert.deepEqual(asked, [first, second]);
  assert.deepEqual(readTraces([traces[0]!.file])[0]!.trace.input.conversation, second);
});

function withNote(trace: (typeof TRACES)[number]["trace"], note: string) {
  const gap = { kind: "rich_text", segments: [{ type: "text", text: note }] };
  return { ...trace, input: { ...trace.input, factBlocks: [...(trace.input.factBlocks ?? []), gap] } };
}

test("live --judge --update chains a thread's turns by question, so a window that opens mid-thread holds each answer re-recorded in it after its own question", async () => {
  const turn = (n: number) => TRACES.find(({ label }) => label === `follow-up-memory.turn-${n}`)!.trace;
  const [, answer1, question2, answer2, question3] = turn(3).input.conversation!;
  const fourth = {
    ...turn(3),
    run_id: "turn-4",
    question: "And INTC?",
    input: { ...turn(3).input, conversation: [answer1!, question2!, answer2!, question3!, { role: "assistant", text: "an old answer" }, { role: "user", text: "And INTC?" }] },
  };
  const traces = readTraces([traceFiles({ "a-turn-4.json": fourth, "b-turn-3.json": withNote(turn(3), "Third."), "c-turn-2.json": withNote(turn(2), "Second."), "d-turn-1.json": withNote(turn(1), "First.") })]);
  const env = { LLM_CHANNELS: "openai", LLM_OPENAI_PROTOCOL: "openai", LLM_OPENAI_MODELS: "gpt-4.1", LITELLM_MODEL: "openai/gpt-4.1", JUDGE_LITELLM_MODEL: "openai/gpt-4.1" };
  const asked = new Map<string, unknown>();
  const createClient = () => async (_deployment: unknown, request: { messages: ReadonlyArray<{ content: string }> }) => {
    const { conversation } = JSON.parse(request.messages[1]!.content) as { conversation: Array<{ text: string }> };
    asked.set(conversation.at(-1)!.text, conversation);
    return { text: "```assertions\n[]\n```" };
  };
  await live(traces, 1, 2, true, (traced, answer) => rerecord(traced, answer, "openai/gpt-4.1"), { env, createClient: createClient as never });

  const saved = (note: string) => `The reported figures below come from the company's filings; select any value to see its source. ${note}`;
  assert.deepEqual(asked.get("And INTC?"), [
    { role: "assistant", text: saved("First.") },
    question2,
    { role: "assistant", text: saved("Second.") },
    question3,
    { role: "assistant", text: saved("Third.") },
    { role: "user", text: "And INTC?" },
  ]);
});

test("recorded --check fails a thread whose later turn quotes an earlier turn's answer other than as that turn recorded it", async () => {
  const script = fileURLToPath(new URL("../scripts/answer-lab.ts", import.meta.url));
  const check = (dir: string) => promisify(execFile)(process.execPath, ["--experimental-strip-types", script, "recorded", dir, "--check"]).then(() => 0, (error: { code: number; stdout: string }) => error);
  assert.equal(await check(fileURLToPath(new URL("./answer-lab/traces", import.meta.url))), 0);

  const turn = (n: number) => TRACES.find(({ label }) => label === `follow-up-memory.turn-${n}`)!.trace;
  const [question1, , question2] = turn(2).input.conversation!;
  const stale = { ...turn(2), input: { ...turn(2).input, conversation: [question1!, { role: "assistant", text: "an old answer" }, question2!] } };
  const failed = await check(traceFiles({ "follow-up-memory.turn-1.json": turn(1), "follow-up-memory.turn-2.json": stale, "follow-up-memory.turn-3.json": turn(3) }));
  assert.notEqual(failed, 0);
  const { code, stdout } = failed as { code: number; stdout: string };
  assert.equal(code, 1);
  assert.deepEqual(stdout.split("\n").filter((line) => line.startsWith("stale")), [
    'stale follow-up-memory.turn-2: its answer to "Analyze NVDA." is not the one follow-up-memory.turn-1 recorded',
  ]);
});

test("live --judge --update does not run a turn whose earlier turn was not given, and says why", async () => {
  const turn = (n: number) => TRACES.find(({ label }) => label === `follow-up-memory.turn-${n}`)!.trace;
  const traces = readTraces([traceFiles({ "turn-2.json": turn(2) })]);
  const before = readFileSync(traces[0]!.file, "utf8");
  const env = { LLM_CHANNELS: "openai", LLM_OPENAI_PROTOCOL: "openai", LLM_OPENAI_MODELS: "gpt-4.1", LITELLM_MODEL: "openai/gpt-4.1", JUDGE_LITELLM_MODEL: "openai/gpt-4.1" };
  let calls = 0;
  const createClient = () => async () => {
    calls += 1;
    return { text: "```assertions\n[]\n```" };
  };
  const run = await live(traces, 1, 2, true, (traced, answer) => rerecord(traced, answer, "openai/gpt-4.1"), { env, createClient: createClient as never });
  assert.equal(calls, 0);
  assert.deepEqual(run.results.map(({ error }) => error), ['not run: the turn asking "Analyze NVDA." was not re-recorded in this run']);
  assert.equal(readFileSync(traces[0]!.file, "utf8"), before);
});

test("live --judge --update runs no turn after one of its thread it left unrecorded, and says why", async () => {
  const turn = (n: number) => TRACES.find(({ label }) => label === `follow-up-memory.turn-${n}`)!.trace;
  const traces = readTraces([traceFiles({ "turn-1.json": turn(1), "turn-2.json": turn(2) })]);
  const before = traces.map(({ file }) => readFileSync(file, "utf8"));
  const env = { LLM_CHANNELS: "openai", LLM_OPENAI_PROTOCOL: "openai", LLM_OPENAI_MODELS: "gpt-4.1", LITELLM_MODEL: "openai/gpt-4.1", JUDGE_LITELLM_MODEL: "openai/gpt-4.1" };
  let calls = 0;
  const createClient = () => async () => {
    calls += 1;
    return { text: "```assertions\n[]\n```", truncated: true };
  };
  const run = await live(traces, 1, 2, true, (traced, answer) => rerecord(traced, answer, "openai/gpt-4.1"), { env, createClient: createClient as never });
  assert.equal(calls, 1);
  assert.deepEqual(run.results.map(({ skipped, error }) => [skipped, error]), [
    ["the answer was cut off at the token limit", undefined],
    [undefined, 'not run: the turn asking "Analyze NVDA." was not re-recorded in this run'],
  ]);
  assert.deepEqual(traces.map(({ file }) => readFileSync(file, "utf8")), before);
});

test("recorded --update --repair leaves a trace as it was when the repair was cut off, or the repair's judge gave no verdict a repaired inference could be read by", async () => {
  const { trace } = TRACES.find(({ label }) => label === "segment-drill-down")!;
  const env = { LLM_CHANNELS: "openai", LLM_OPENAI_PROTOCOL: "openai", LLM_OPENAI_MODELS: "gpt-4.1", LITELLM_MODEL: "openai/gpt-4.1", JUDGE_LITELLM_MODEL: "openai/gpt-4.1" };
  const worded = '{"verdicts":[{"id":3,"verdict":"entailed","worded_amount":true},{"id":4,"verdict":"entailed","worded_amount":false}]}';
  const recordedJudge = { outcome: "replied", exchange: { messages: [], text: worded, truncated: false, deployment: "openai/gpt-4.1", latency_ms: 1 } };
  const repaired = '```assertions\n[{"index":3,"kind":"analyst_inference","text":"Data Center carries its revenue, with every other segment far smaller."}]\n```';
  const runs = {
    "repair cut off": { truncated: true, judge: '{"verdicts":[{"id":3,"verdict":"entailed","worded_amount":false}]}' },
    "repair's judge unreadable": { truncated: false, judge: "{}" },
    "repair's judge silent on it": { truncated: false, judge: '{"verdicts":[]}' },
    "healthy": { truncated: false, judge: '{"verdicts":[{"id":3,"verdict":"entailed","worded_amount":false}]}' },
  };
  const written = [];
  for (const [name, run] of Object.entries(runs)) {
    const traces = readTraces([traceFiles({ "segment-drill-down.json": { ...trace, judge: recordedJudge } })]);
    const before = readFileSync(traces[0]!.file, "utf8");
    const createClient = () => async (_deployment: unknown, request: { messages: ReadonlyArray<{ content: string }> }) =>
      request.messages.map((message) => message.content).join("\n").includes(REPAIR_INSTRUCTIONS) ? { text: repaired, truncated: run.truncated } : { text: run.judge };
    await recorded(traces, true, "repair", { env, createClient: createClient as never });
    if (readFileSync(traces[0]!.file, "utf8") !== before) written.push(name);
  }
  assert.deepEqual(written, ["healthy"]);
});

test("recorded --update --judge and --repair write a live round over the trace only when it was not degraded", async () => {
  const { trace } = TRACES.find(({ label }) => label === "segment-drill-down")!;
  const env = {
    LLM_CHANNELS: "openai", LLM_OPENAI_PROTOCOL: "openai", LLM_OPENAI_MODELS: "gpt-4.1,gpt-4.1-mini",
    LITELLM_MODEL: "openai/gpt-4.1", LITELLM_FALLBACK_MODELS: "openai/gpt-4.1-mini", JUDGE_LITELLM_MODEL: "openai/gpt-4.1",
  };
  const contradicted = '{"verdicts":[{"id":3,"verdict":"contradicted","worded_amount":false},{"id":4,"verdict":"entailed","worded_amount":false}]}';
  const runs = {
    "judge failed": { rerun: "judge", primaryFails: null, judge: null },
    "repair on a fallback": { rerun: "judge", primaryFails: "repair", judge: contradicted },
    "--repair, repair on a fallback": { rerun: "repair", primaryFails: "repair", judge: contradicted },
    "healthy": { rerun: "judge", primaryFails: null, judge: contradicted },
  } as const;
  const recordedJudge = [{ outcome: "replied", exchange: { messages: [], text: contradicted, truncated: false, deployment: "openai/gpt-4.1", latency_ms: 1 } }];
  const written = [];
  const skipped: Array<[string, string | undefined]> = [];
  for (const [name, run] of Object.entries(runs)) {
    const traces = readTraces([traceFiles({ "segment-drill-down.json": run.rerun === "repair" ? { ...trace, judge: recordedJudge } : trace })]);
    const before = readFileSync(traces[0]!.file, "utf8");
    const createClient = () => async (deployment: { model: string }, request: { messages: ReadonlyArray<{ content: string }> }) => {
      const transcript = request.messages.map((message) => message.content).join("\n");
      const call = transcript.includes(REPAIR_INSTRUCTIONS) ? "repair" : "judge";
      if (call === run.primaryFails && deployment.model === "gpt-4.1") throw new Error("primary unavailable");
      if (call === "judge" && run.judge === null) throw new Error("judge unavailable");
      return { text: call === "judge" ? run.judge : "```assertions\n[]\n```" };
    };
    const [result] = await recorded(traces, true, run.rerun, { env, createClient: createClient as never, repairDeadlines: { attemptMs: 15_000, totalMs: 45_000 } });
    skipped.push([name, result!.skipped]);
    if (readFileSync(traces[0]!.file, "utf8") !== before) written.push(name);
  }
  assert.deepEqual(written, ["healthy"]);
  assert.deepEqual(skipped, [
    ["judge failed", "judge call failed: all LLM deployments failed"],
    ["repair on a fallback", "the repair came from openai/gpt-4.1-mini, not the primary openai/gpt-4.1"],
    ["--repair, repair on a fallback", "the repair came from openai/gpt-4.1-mini, not the primary openai/gpt-4.1"],
    ["healthy", undefined],
  ]);
});
