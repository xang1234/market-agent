import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

import { replayRecorded } from "../src/answer-trace.ts";
import { answerText, assertionSummary, judgeSummary, mutationSummary, mutationVariants, readTraces, replyFixture } from "../scripts/answer-lab.ts";
import { createReplayLlmChatClient } from "../../llm/src/replay-client.ts";

// One live research-quality eval run's turns (scripts/research-quality-eval.ts).
const TRACES = readTraces([fileURLToPath(new URL("./answer-lab/traces/", import.meta.url))]);

test("the recorded traces cover the eval", () => {
  assert.equal(TRACES.length, 14);
});

for (const { label, trace } of TRACES) {
  test(`${label}: the recorded reply replays to the recorded blocks`, async () => {
    const replayed = await replayRecorded(trace);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(replayed.blocks)), trace.blocks);
    const judgeRejections = (report: typeof trace.assertions) => (report?.rejected ?? []).filter((entry) => entry.check === "judge");
    assert.deepStrictEqual(JSON.parse(JSON.stringify(judgeRejections(replayed.assertions))), judgeRejections(trace.assertions));
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
  const metrics = { figure_refs: 0, plain_numbers: 0, fallback: false, accepted: 0, rejected: 0, inferences_shown: 0, inferences_unverified: 0, inferences_hidden: 0, output_tokens: 0, latency_ms: 0 };
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

test("the judge's held-out set: every original and mutation passes the turn's own checks, so each is a gap only the judge can catch (#302)", () => {
  const variants = mutationVariants(MUTATIONS);
  const count = (key: (variant: (typeof variants)[number]) => string) =>
    Object.fromEntries([...new Set(variants.map(key))].map((value) => [value, variants.filter((variant) => key(variant) === value).length]));
  assert.deepEqual(count((variant) => variant.kind), {
    original: 10,
    worded_amount: 5,
    unsupported_claim: 5,
    contradicted_ranking: 4,
    hedged_valuation: 3,
    flipped_direction: 3,
  });
  // The judge reads a case on its trace's packet: the peer case's label is its comparisons' checked results.
  const peer = variants.find((variant) => variant.id === "peer-lead" && variant.kind === "original")!;
  assert.deepEqual([peer.judged.subject, peer.judged.checked, peer.companies], ["NVDA", ["NVDA highest on revenue, gross margin, net margin, and revenue growth (YoY)"], ["NVDA", "AMD"]]);
});

test("a set inference the turn's checks already reject fails the set, rather than inflate the catch rate", () => {
  const dir = mkdtempSync(join(tmpdir(), "judge-mutations-"));
  const file = join(dir, "set.json");
  writeFileSync(file, JSON.stringify({ cases: [{
    id: "typed",
    trace: fileURLToPath(new URL("./answer-lab/traces/segment-drill-down.json", import.meta.url)),
    index: 6,
    supports: [5],
    originals: ["Data Center dominates the top line."],
    mutations: [{ kind: "worded_amount", text: "Data Center brings in 90% of the top line." }],
  }] }));
  assert.throws(() => mutationVariants(file), {
    message: "typed worded_amount: the turn's checks reject it (an inference rests on its supports; it writes no figure); the set holds only inferences they pass",
  });
});

test("the mutation summary counts catches by kind and false alarms on originals; an error is neither", () => {
  const result = (id: string, kind: string, verdict: string, reason?: string) =>
    ({ id, kind, text: `${id} ${kind}`, verdict: { index: 0, verdict, ...(reason ? { reason } : {}) } }) as Parameters<typeof mutationSummary>[0][number];
  assert.equal(mutationSummary([
    result("a", "original", "entailed"),
    result("a", "worded_amount", "worded_amount", "says tens of billions"),
    result("a", "hedged_valuation", "entailed"),
    result("b", "original", "unsupported", "no figure shows it"),
    result("b", "flipped_direction", "error", "judge call failed: timeout"),
  ]), [
    "caught: 1 of 3 mutations (1 errors)",
    "  worded_amount          1 of 1",
    "  unsupported_claim      0 of 0",
    "  hedged_valuation       0 of 1",
    "  flipped_direction      0 of 1",
    "  contradicted_ranking   0 of 0",
    "false alarms: 1 of 2 originals (0 errors)",
    "misses, false alarms and errors:",
    "  a hedged_valuation: entailed\n      a hedged_valuation",
    "  b original: unsupported (no figure shows it)\n      b original",
    "  b flipped_direction: error (judge call failed: timeout)\n      b flipped_direction",
  ].join("\n"));
});

test("a run with no judge configured counts each inference not called", () => {
  const metrics = { figure_refs: 0, plain_numbers: 0, fallback: false, accepted: 0, rejected: 0, inferences_shown: 0, inferences_unverified: 0, inferences_hidden: 2, output_tokens: 0, latency_ms: 0 };
  const none = { outcome: "not_called" as const, reason: "no judge model is configured" };
  const judge = { records: [none, none], unverified: [], hidden: [] };
  const summary = judgeSummary({ results: [{ trace: "a", sample: 0, metrics, judge }, { trace: "b", sample: 0, metrics, judge }] });
  assert.equal(summary.split("\n")[0], "judge: 0 shown, 0 unverified, 4 hidden, in 2 answers (0 replied, 0 failed, 4 not called)");
});

test("a judged run's summary counts the inferences shown, unverified and hidden, what the judge did per inference, its cost per reply, and each inference it showed as unverified or left out", () => {
  const metrics = (shown: number, unverified: number, hidden: number) =>
    ({ figure_refs: 0, plain_numbers: 0, fallback: false, accepted: 0, rejected: 0, inferences_shown: shown, inferences_unverified: unverified, inferences_hidden: hidden, output_tokens: 0, latency_ms: 0 });
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
          unverified: [{ index: 11, text: "Its lead may narrow.", reason: "unsupported: a forecast the figures do not show." }],
          hidden: [{ index: 10, text: "amd leads.", reason: "contradicted: NVDA is highest." }],
        },
      },
      { trace: "a", sample: 2, metrics: metrics(0, 0, 1), judge: { records: [{ outcome: "failed", reason: "judge call failed: timeout", latency_ms: 8000 }], unverified: [], hidden: [{ index: 3, text: "It leads.", reason: "error: judge call failed: timeout" }] } },
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
    reply('{"verdicts":[{"id":6,"verdict":"entailed"}]}', 3000, { input_tokens: 500, output_tokens: 100 }),
    reply('{"verdicts":[{"id":7,"verdict":"unsupported","reason":"no support measures diversification."}]}', 4000, { input_tokens: 600, output_tokens: 200 }),
  ];
  const root = traceFiles({ "judged.json": { ...trace, judge }, "missing-cash-flow.json": TRACES.find(({ label }) => label === "missing-cash-flow")!.trace });
  const script = fileURLToPath(new URL("../scripts/answer-lab.ts", import.meta.url));
  const { stdout } = await promisify(execFile)(process.execPath, ["--experimental-strip-types", script, "recorded", root]);
  assert.equal(stdout.slice(stdout.indexOf("as recorded")), [
    "as recorded, judge: 1 shown, 1 unverified, 0 hidden, in 1 answers (2 replied, 0 failed, 0 not called)",
    "judge per reply: 3500 ms, 550 in / 150 out tokens, on anthropic/claude-haiku-5-5",
    "  unverified  judged #0 [7] The other four segments provide limited diversification cushion relative to Data Center's dominance.",
    "      unsupported: no support measures diversification.",
    "",
  ].join("\n"));
});

test("recorded counts the cost of a trace's one batched judge call once, though each inference replays its verdict from it", async () => {
  const { trace } = TRACES.find(({ label }) => label === "segment-drill-down")!;
  const judge = {
    outcome: "replied",
    exchange: {
      messages: [],
      text: '{"verdicts":[{"id":6,"verdict":"entailed"},{"id":7,"verdict":"contradicted","reason":"Data Center outweighs the other four together."}]}',
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
