import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { answerMetrics, writeTurnTrace, type TurnTrace } from "../src/answer-trace.ts";

const TRACE: TurnTrace = {
  version: 2,
  thread_id: "thread-1",
  run_id: "run-1",
  question: "How did NVDA's revenue change?",
  recorded_at: "2026-10-15T00:00:00.000Z",
  input: { context: { userIntent: "How did NVDA's revenue change?", bundleId: "single_subject_analysis" }, blocks: [], toolCalls: [] },
  exchange: {
    messages: [{ role: "system", content: "Write." }],
    text: "NVDA revenue rose to $130.5B in FY2025.",
    truncated: false,
    deployment: "opencode-go/qwen3.8-max",
    latency_ms: 41_200,
    usage: { input_tokens: 9000, output_tokens: 700 },
  },
  assertions: {
    status: "checked",
    accepted: [{ index: 0, kind: "observation", text: "NVDA revenue rose to [[F1]].", evidence: ["F1"] }],
    rejected: [{ index: 1, check: "kind", reason: "cites no figure" }],
    rendered: true,
  },
  blocks: [
    {
      kind: "rich_text",
      segments: [
        { type: "text", text: "NVDA revenue rose to " },
        { type: "ref", ref_kind: "fact", ref_id: "f1", format: "$130.5B" },
        { type: "text", text: " in FY2025, from 60.9 billion and 1,234 units." },
        { type: "ref", ref_kind: "claim", ref_id: "c1", format: "Demand stayed strong" },
        { type: "text", text: "; its shares returned " },
        { type: "ref", ref_kind: "series", ref_id: "s1", format: "6.6%" },
      ],
    },
    { kind: "metric_row", segments: [{ type: "text", text: "99" }] },
  ],
};

test("a trace is written under its thread, one file per run", async () => {
  const dir = await mkdtemp(join(tmpdir(), "answer-trace-"));
  await writeTurnTrace(dir, TRACE);
  assert.deepEqual(JSON.parse(await readFile(join(dir, "thread-1", "run-1.json"), "utf8")), TRACE);
});

test("a written trace leaves no partial file behind", async () => {
  const dir = await mkdtemp(join(tmpdir(), "answer-trace-"));
  await writeTurnTrace(dir, TRACE);
  assert.deepEqual(await readdir(join(dir, "thread-1")), ["run-1.json"]);
});

test("two turns of one run keep a trace each", async () => {
  const dir = await mkdtemp(join(tmpdir(), "answer-trace-"));
  await writeTurnTrace(dir, { ...TRACE, turn_id: "turn-1" });
  await writeTurnTrace(dir, { ...TRACE, turn_id: "turn-2" });
  assert.deepEqual((await readdir(join(dir, "thread-1"))).sort(), ["run-1.turn-1.json", "run-1.turn-2.json"]);
});

test("a turn id that would leave the trace directory is not written", async () => {
  const dir = await mkdtemp(join(tmpdir(), "answer-trace-"));
  await writeTurnTrace(dir, { ...TRACE, turn_id: "../escaped" });
  assert.deepEqual(await readdir(dir), []);
});

test("a run id that would leave the trace directory is not written", async () => {
  const dir = await mkdtemp(join(tmpdir(), "answer-trace-"));
  await writeTurnTrace(dir, { ...TRACE, run_id: "../escaped" });
  assert.deepEqual(await readdir(dir), []);
});

test("a failed trace write does not fail the turn", async () => {
  const dir = await mkdtemp(join(tmpdir(), "answer-trace-"));
  // A file where the thread's directory would go.
  await writeFile(join(dir, "thread-1"), "");
  await writeTurnTrace(dir, TRACE);
  assert.deepEqual(await readdir(dir), ["thread-1"]);
});

test("answerMetrics counts the answer's sealed figures, a price return's series among them, and plain numbers", () => {
  assert.deepEqual(answerMetrics(TRACE), {
    figure_refs: 2,
    plain_numbers: 3,
    fallback: false,
    accepted: 1,
    rejected: 1,
    inferences_shown: 0,
    inferences_unverified: 0,
    inferences_hidden: 0,
    inferences_repaired: 0,
    inferences_recovered: 0,
    repair_latency_ms: 0,
    repair_input_tokens: 0,
    repair_output_tokens: 0,
    output_tokens: 700,
    latency_ms: 41_200,
  });
});

test("answerMetrics reads an answer no assertion rendered as the fallback; with no model called there is none", () => {
  const fallback = {
    ...TRACE,
    assertions: { status: "missing" as const, accepted: [], rejected: [] },
    blocks: [{ kind: "rich_text", segments: [{ type: "text", text: "No written answer is available for this question; try asking again." }] }],
  };
  assert.deepEqual(answerMetrics(fallback), {
    figure_refs: 0,
    plain_numbers: 0,
    fallback: true,
    accepted: 0,
    rejected: 0,
    inferences_shown: 0,
    inferences_unverified: 0,
    inferences_hidden: 0,
    inferences_repaired: 0,
    inferences_recovered: 0,
    repair_latency_ms: 0,
    repair_input_tokens: 0,
    repair_output_tokens: 0,
    output_tokens: 700,
    latency_ms: 41_200,
  });
  assert.equal(answerMetrics({ ...fallback, exchange: null, assertions: null }).fallback, false);
});

test("answerMetrics counts the judged inferences shown, those shown as unverified, and those the judge left out", () => {
  const judged = {
    ...TRACE,
    assertions: {
      status: "checked" as const,
      accepted: [
        { index: 0, kind: "observation" as const, text: "NVDA revenue rose to [[F1]].", evidence: ["F1"] },
        { index: 1, kind: "analyst_inference" as const, text: "Demand held up.", evidence: [], supports: [0] },
        { index: 2, kind: "analyst_inference" as const, text: "It will keep growing.", evidence: [], supports: [0] },
      ],
      rejected: [
        { index: 3, text: "Its revenue fell.", check: "judge" as const, reason: "contradicted: revenue rose." },
        { index: 4, text: "Revenue rose by tens of billions.", check: "judge" as const, reason: "entailed, worded_amount: it says tens of billions." },
        { index: 5, text: "Its margin doubled.", check: "binding" as const, reason: "an inference rests on its supports; it writes no figure" },
      ],
      rendered: true,
      judged: [
        { index: 1, verdict: "entailed" as const, worded_amount: false },
        { index: 2, verdict: "unsupported" as const, worded_amount: false, reason: "a forecast." },
        { index: 3, verdict: "contradicted" as const, worded_amount: false, reason: "revenue rose." },
        { index: 4, verdict: "entailed" as const, worded_amount: true, reason: "it says tens of billions." },
      ],
    },
  };
  const { inferences_shown, inferences_unverified, inferences_hidden } = answerMetrics(judged);
  assert.deepEqual({ inferences_shown, inferences_unverified, inferences_hidden }, { inferences_shown: 1, inferences_unverified: 1, inferences_hidden: 2 });
});
