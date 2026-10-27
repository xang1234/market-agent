import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  BLIND_RUNS_DIR,
  RUNS_DIR,
  Refusal,
  blankScores,
  buildPair,
  confounded,
  datasetRevision,
  formatChecks,
  questionSetDigest,
  readRunRecord,
  runProvenance,
  serializeRun,
  modelForRun,
  turnOutcome,
  answeredBySummary,
  usageSummary,
  assertionSummary,
  modelLabel,
  readRuns,
  renderBlock,
  renderReport,
  reveal,
  runCli,
  runStamp,
  summarize,
  threadTraces,
  traceDirFor,
  type AnsweredTurn,
  type Arm,
  type PairKey,
  type PairScores,
  type RunRecord,
  type Score,
  type ScoresFile,
} from "./research-quality-eval.ts";
import { QUESTIONS, RUBRIC } from "./research-quality-questions.ts";

test("blocks render for scoring: cited figures bold, tables as tables, the rest by title and figures", () => {
  assert.equal(
    renderBlock({
      kind: "rich_text",
      segments: [{ type: "text", text: "Revenue was " }, { type: "ref", ref_kind: "fact", format: "$57.0B" }, { type: "text", text: "." }],
    }),
    "Revenue was **$57.0B**.",
  );
  assert.equal(
    renderBlock({ kind: "rich_text", segments: [{ type: "text", text: "Revenue " }, { type: "mention", format: "NVDA" }, { type: "text", text: "." }] }),
    "Revenue [mention segment not shown].",
  );
  assert.equal(
    renderBlock({
      kind: "metrics_comparison",
      title: "Side by side",
      metrics: ["Revenue", "Gross Margin"],
      subject_labels: ["NVDA", "AMD"],
      cells: [[{ format: "$209.9B" }, { format: "70.8%" }], [{ format: "$34.6B" }, { format: "52.5%" }]],
    }),
    "*Side by side*\n\n| | Revenue | Gross Margin |\n|---|---|---|\n| NVDA | $209.9B | 70.8% |\n| AMD | $34.6B | 52.5% |",
  );
  assert.equal(
    renderBlock({ kind: "metric_row", title: "Latest quarter", items: [{ label: "Revenue", format: "$57.0B" }], data_ref: { format: "x" } }),
    "*[metric_row] Latest quarter*: Revenue $57.0B",
  );
});

test("an engine answer renders its figures with labels and periods, its gaps with reasons, and its commentary", () => {
  const value = (text: string) => ({ kind: "value", text, full_text: text, value: "1", unit: { kind: "currency", currency: "USD" }, exact: false });
  const result = (id: string, subject: string | null, measure: string, period: string, presented: Record<string, unknown>) =>
    ({ result_id: id, output_id: "o", disposition: "verified", subject_label_id: subject, measure_label_id: measure, period_label_id: period, presented, result_hash: "0".repeat(64) });
  const block = {
    kind: "financial_answer",
    presentation_hash: "0".repeat(64),
    financial: {
      presentation_version: "financial-presentation.v2",
      coverage: { state: "partial", requested: 5, verified: 4 },
      labels: {
        "subject:nvda": { kind: "subject", text: "NVDA", slot_id: "nvda" },
        "subject:amd": { kind: "subject", text: "AMD", slot_id: "amd" },
        "measure:m1": { kind: "measure", text: "Revenue" },
        "measure:m2": { kind: "measure", text: "Free cash flow" },
        "period:p1": { kind: "period", text: "FY2026" },
        "period:p2": { kind: "period", text: "FY2025" },
      },
      results: [
        result("r1", "subject:nvda", "measure:m1", "period:p1", value("USD 130.5B")),
        result("r2", "subject:amd", "measure:m1", "period:p2", value("USD 34.6B")),
        result("r3", "subject:amd", "measure:m2", "period:p2", { kind: "gap", text: "Cash flow is not in the data", reason_code: "no_source" }),
        result("r4", "subject:nvda", "measure:m1", "period:p2", value("USD 60.9B")),
        result("r5", null, "measure:m1", "period:p1", { kind: "predicate", text: "NVDA's revenue is above AMD's", outcome: true }),
      ],
      presentations: [
        { kind: "scalar", result_id: "r1" },
        { kind: "gap", result_id: "r3" },
        { kind: "predicate", result_id: "r5" },
        { kind: "scalar", result_id: "7f1c0d9e-0000-4000-8000-000000000000" },
        {
          kind: "table",
          caption: "Revenue by company",
          columns: [{ column_id: "c1", measure_label_id: "measure:m1", period_label_id: null }],
          rows: [{ subject_label_id: "subject:nvda", cells: ["r1"] }, { subject_label_id: "subject:amd", cells: [null] }],
          ascending: {},
        },
        { kind: "series", subject_label_id: "subject:nvda", measure_label_id: "measure:m1", points: [{ period_label_id: "period:p2", result_id: "r4" }, { period_label_id: "period:p1", result_id: "r1" }] },
      ],
    },
  };
  assert.equal(renderBlock(block), [
    "*Engine answer: 4 of 5 requested results verified*",
    "",
    "- NVDA, Revenue, FY2026: USD 130.5B",
    "- AMD, Free cash flow, FY2025: gap (no_source): Cash flow is not in the data",
    "- Revenue, FY2026: NVDA's revenue is above AMD's",
    "- a result not in this answer: —",
    "",
    "*Revenue by company*",
    "",
    "| | Revenue |",
    "|---|---|",
    "| NVDA | USD 130.5B (FY2026) |",
    "| AMD | — |",
    "",
    "*NVDA, Revenue*: FY2025 USD 60.9B; FY2026 USD 130.5B",
  ].join("\n"));
  assert.equal(
    renderBlock({ kind: "financial_answer", financial: { presentation_version: "financial-presentation.v9" } }),
    "*Engine answer in an unsupported presentation (financial-presentation.v9)*",
  );
  assert.equal(
    renderBlock({ kind: "rich_text", analyst_commentary: true, segments: [{ type: "text", text: "Scale funds research." }] }),
    "_Analyst commentary:_ Scale funds research.",
  );
});

test("the report shows every turn, its expectation, and a failed turn as failed", () => {
  const question = QUESTIONS.find((q) => q.id === "ticker-page-compare")!;
  const report = renderReport("2026-10-01T1000", "gpt-x", "http://app", [
    { question, threadId: "t1", turns: [{ message: question.turns[0]!.message, outcome: "timeout" as const, blocks: [] }] },
  ]);
  assert.match(report, /## ticker-page-compare/);
  assert.match(report, /Thread: http:\/\/app\/chat\/t1/);
  assert.match(report, /### Q: Compare with NVDA\. \(opened from the AAPL page\)/);
  assert.match(report, /\*\*Turn ended with timeout\.\*\*/);
  for (const criterion of RUBRIC) assert.match(report, new RegExp(criterion.id));
});

test("blank scores mark not-applicable criteria n/a and leave the rest for the owner", () => {
  const scores = blankScores("r", "m").scores;
  assert.deepEqual(Object.keys(scores), QUESTIONS.map((q) => q.id));
  assert.equal(scores["missing-cash-flow"]!.counterarguments, "n/a");
  assert.equal(scores["missing-cash-flow"]!.no_invented_numbers, null);
  assert.equal(scores["peer-two"]!.counterarguments, null);
});

test("summary totals each run, leaves out n/a and unscored, and flags invented numbers", () => {
  const scored: ScoresFile = blankScores("2026-10-01T1000", "gpt-x");
  scored.scores["peer-two"] = { ...scored.scores["peer-two"]!, correct_companies: 2, no_invented_numbers: 1 };
  scored.scores["missing-cash-flow"] = { ...scored.scores["missing-cash-flow"]!, correct_companies: 2, no_invented_numbers: 0 };
  const lines = summarize([scored]).split("\n");
  // 2+1+2+0 of four scored criteria; four n/a left out; the rest unscored.
  const [run, model, total, companies, , , , , invented, unscored] = lines[1]!.split(" | ");
  assert.deepEqual([run, model, total, companies, invented], ["2026-10-01T1000", "gpt-x", "5/8", "4/4", "1/4"]);
  const naCount = QUESTIONS.reduce((n, q) => n + (q.notApplicable?.length ?? 0), 0);
  assert.equal(Number(unscored), QUESTIONS.length * RUBRIC.length - naCount - 4);
  assert.match(lines.join("\n"), /0 on no_invented_numbers[^\n]*\n {2}2026-10-01T1000 missing-cash-flow/);

  scored.scores["peer-two"]!.counterarguments = 3 as never;
  assert.throws(() => summarize([scored]), /peer-two\.counterarguments is 3/);
});

test("summary checks a hand-edited file against the question set before totalling it", () => {
  const unscoredIn = (file: ScoresFile) => Number(summarize([file]).split("\n")[1]!.split(" | ").at(-1));
  const complete = blankScores("r", "m");

  // A question deleted from the file still counts, as unscored: an incomplete run can't look complete.
  const missing = blankScores("r", "m");
  delete (missing.scores as Record<string, unknown>)["peer-two"];
  assert.equal(unscoredIn(missing), unscoredIn(complete));
  assert.equal(unscoredIn({ ...complete, scores: {} as ScoresFile["scores"] }), unscoredIn(complete));

  const typo = blankScores("r", "m");
  (typo.scores as Record<string, unknown>)["peer-tow"] = typo.scores["peer-two"];
  assert.throws(() => summarize([typo]), /unknown question 'peer-tow'/);

  // "n/a" only where the question declares it, and only "n/a" there.
  const hidden = blankScores("r", "m");
  hidden.scores["peer-two"]!.no_invented_numbers = "n/a";
  assert.throws(() => summarize([hidden]), /peer-two\.no_invented_numbers is "n\/a", but it applies/);
  const overwritten = blankScores("r", "m");
  overwritten.scores["missing-cash-flow"]!.counterarguments = 2;
  assert.throws(() => summarize([overwritten]), /missing-cash-flow\.counterarguments is 2, but this question declares it N\/A/);
});

test("a run names its model or doesn't start, and its files are stamped to the second", () => {
  assert.equal(modelForRun("opencode-go/qwen3.8-max", undefined), "opencode-go/qwen3.8-max");
  assert.equal(modelForRun(undefined, "openai/o3"), "openai/o3", "EVAL_MODEL names it when settings can't");
  assert.throws(() => modelForRun(undefined, undefined, "reading /v1/dev/llm-settings failed: 403"), /403.*EVAL_MODEL/);
  assert.throws(() => modelForRun(null, "  "), /EVAL_MODEL/);
  assert.equal(runStamp(new Date("2026-10-02T04:55:12.345Z")), "2026-10-02T045512");
});

test("a run with fallbacks configured is labelled with them", () => {
  assert.equal(modelLabel("opencode-go/qwen3.8-max", []), "opencode-go/qwen3.8-max");
  const label = modelLabel("opencode-go/qwen3.8-max", ["opencode-go/kimi-k2.7-code"]);
  assert.equal(label, "opencode-go/qwen3.8-max (fallbacks: opencode-go/kimi-k2.7-code)");
  // Settings unreadable (EVAL_MODEL named the run): fallbacks are unknown, not absent.
  const unknown = modelLabel("openai/o3", null);
  assert.equal(unknown, "openai/o3 (fallbacks: unknown)");
});

test("the report shows the model that answered each turn, and the mix across the run (#183)", () => {
  const [first, second] = QUESTIONS;
  const report = renderReport("r", "opencode-go/qwen3.8-max (fallbacks: opencode-go/kimi-k2.7-code)", "http://app", [
    { question: first, threadId: "t1", turns: [{ message: "q1", outcome: "completed" as const, blocks: [], answeredBy: "opencode-go/qwen3.8-max" }] },
    { question: second, threadId: "t2", turns: [{ message: "q2", outcome: "completed" as const, blocks: [], answeredBy: "opencode-go/kimi-k2.7-code" }] },
  ]);
  assert.match(report, /Answered by: `opencode-go\/qwen3\.8-max` \(1 turn\), `opencode-go\/kimi-k2\.7-code` \(1 turn\)\./);
  assert.match(report, /### Q: q2\n\n_Outcome: completed; time: unknown; answered by: `opencode-go\/kimi-k2\.7-code`; checks: unknown\._/);
  assert.doesNotMatch(report, /Fallbacks may have answered/);
  assert.equal(answeredBySummary([{ question: first, threadId: "t", turns: [{ message: "q", outcome: "provider_error" as const, blocks: [], answeredBy: null }] }]), "not recorded (1 turn)");
  assert.equal(answeredBySummary([{ question: first, threadId: "t", turns: [
    { message: "q1", outcome: "completed" as const, blocks: [], answeredBy: "a/m" },
    { message: "q2", outcome: "completed" as const, blocks: [], answeredBy: null },
    { message: "q3", outcome: "completed" as const, blocks: [], answeredBy: null },
    { message: "q4", outcome: "completed" as const, blocks: [] },
  ] }]), "`a/m` (1 turn), no model (2 turns), not recorded (1 turn)");
});

test("the report links each thread's turn traces, oldest first", async () => {
  const root = await mkdtemp(join(tmpdir(), "eval-traces-"));
  const threadDir = join(root, ".dev", "traces", "t1");
  await mkdir(threadDir, { recursive: true });
  await writeFile(join(threadDir, "run-b.json"), "{}");
  await utimes(join(threadDir, "run-b.json"), new Date(2000), new Date(2000));
  await writeFile(join(threadDir, "run-a.json"), "{}");
  await writeFile(join(threadDir, "notes.txt"), "");
  const traces = threadTraces(join(root, ".dev", "traces"), "t1", root);
  assert.deepEqual(traces, [".dev/traces/t1/run-b.json", ".dev/traces/t1/run-a.json"]);
  assert.deepEqual(threadTraces(join(root, ".dev", "traces"), "t2", root), []);

  const [first] = QUESTIONS;
  const report = renderReport("r", "m", "http://app", [{ question: first, threadId: "t1", traces, turns: [] }]);
  assert.match(report, /Thread: http:\/\/app\/chat\/t1\nTrace: \.dev\/traces\/t1\/run-b\.json\nTrace: \.dev\/traces\/t1\/run-a\.json\n\n\*\*Expect/);
});

test("summary on a fresh checkout reads no runs instead of failing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "eval-runs-"));
  assert.deepEqual(readRuns(join(dir, "missing")), []);
});

test("a turn's outcome is one of five, and a completed turn that saved nothing is a missing answer (#220)", () => {
  assert.deepEqual(
    [
      turnOutcome("turn.completed", true),
      turnOutcome("turn.completed", false),
      turnOutcome("turn.error", false),
      turnOutcome("turn.error", true),
      turnOutcome("timeout", true),
      turnOutcome("skipped", false),
    ],
    ["completed", "missing_answer", "provider_error", "provider_error", "timeout", "skipped"],
  );
});

test("a turn's checks count accepted assertions and rejected ones by the check they failed (#220)", () => {
  assert.equal(formatChecks({
    status: "checked",
    accepted: [{ kind: "observation", text: "a", evidence: ["F1"] }, { kind: "comparison", text: "b", evidence: ["F1", "F2"] }],
    rejected: [
      { index: 2, check: "binding", reason: "r" },
      { index: 3, check: "judge", reason: "r" },
      { index: 4, check: "binding", reason: "r" },
    ],
  }), "2 accepted, 3 rejected (binding 2, judge 1)");
  assert.equal(formatChecks({ status: "checked", accepted: [], rejected: [] }), "0 accepted, 0 rejected");
});

test("each turn shows its outcome, time, model and checks; a completed turn no model wrote says so, and a field a run didn't record renders unknown (#220)", () => {
  const [first] = QUESTIONS;
  const report = renderReport("r", "m", "http://app", [{ question: first, threadId: "t1", turns: [
    { message: "q1", outcome: "completed", blocks: [], elapsedMs: 12_340, answeredBy: "a/m", assertions: {
      status: "checked",
      accepted: [1, 2, 3].map((n) => ({ kind: "observation", text: `a${n}`, evidence: ["F1"] })),
      rejected: [{ index: 3, check: "binding", reason: "r" }],
    } },
    { message: "q2", outcome: "timeout", blocks: [], elapsedMs: 180_000, answeredBy: null, assertions: null },
    { message: "q3", outcome: "skipped", blocks: [], elapsedMs: null, answeredBy: null, assertions: null },
    { message: "q4", outcome: "completed", blocks: [] },
    // Chat omits answered_by when no model wrote the answer, and the runner records that as null.
    { message: "q5", outcome: "completed", blocks: [], elapsedMs: 900, answeredBy: null, assertions: null },
  ] }]);
  assert.match(report, /### Q: q1\n\n_Outcome: completed; time: 12\.3s; answered by: `a\/m`; checks: 3 accepted, 1 rejected \(binding 1\)\._/);
  assert.match(report, /\*\*Turn ended with timeout\.\*\*\n\n_Outcome: timeout; time: 180\.0s; answered by: none; checks: none\._/);
  assert.match(report, /\*\*Not sent: an earlier turn didn't complete\.\*\*\n\n_Outcome: skipped; time: none; answered by: none; checks: none\._/);
  assert.match(report, /### Q: q4\n\n_Outcome: completed; time: unknown; answered by: unknown; checks: unknown\._/);
  assert.match(report, /### Q: q5\n\n_Outcome: completed; time: 0\.9s; answered by: none \(no model wrote it\); checks: none\._/);
});

test("turns after one that didn't complete are shown as not sent", () => {
  const question = QUESTIONS.find((q) => q.id === "follow-up-memory")!;
  const report = renderReport("r", "m", "http://app", [{
    question,
    threadId: "t",
    turns: [
      { message: question.turns[0]!.message, outcome: "timeout" as const, blocks: [] },
      { message: question.turns[1]!.message, outcome: "skipped" as const, blocks: [] },
    ],
  }]);
  assert.match(report, /Turn ended with timeout/);
  assert.match(report, /Not sent: an earlier turn didn't complete/);
});

test("the report shows each turn's answer tokens and the run's mean (#181)", () => {
  const [first, second] = QUESTIONS;
  const answered = [
    { question: first, threadId: "t1", turns: [{ message: "q1", outcome: "completed" as const, blocks: [], answeredBy: "a/m", usage: { input_tokens: 1000, output_tokens: 200, reasoning_tokens: 100 } }] },
    { question: second, threadId: "t2", turns: [{ message: "q2", outcome: "completed" as const, blocks: [], answeredBy: "a/m", usage: { input_tokens: 2000, output_tokens: 400, reasoning_tokens: 300 } }] },
  ];
  assert.equal(usageSummary(answered), "mean 1500 input / 300 output per turn (200 reasoning) over 2 turns");
  const report = renderReport("r", "a/m", "http://app", answered);
  assert.match(report, /Answer tokens: mean 1500 input \/ 300 output per turn \(200 reasoning\) over 2 turns\./);
  assert.match(report, /answered by: `a\/m`; checks: unknown; 1000 input \/ 200 output tokens \(100 reasoning\)\._/);
  assert.equal(usageSummary([]), "not reported");
});

test("the report shows each turn's assertion check and the run's totals (#208)", () => {
  const [first, second] = QUESTIONS;
  const answered = [
    { question: first, threadId: "t1", turns: [{
      message: "q1", outcome: "completed" as const, blocks: [],
      assertions: {
        status: "checked" as const,
        accepted: [{ kind: "observation", text: "NVDA's margin was 75.0%.", evidence: ["F1"] }],
        rejected: [{ index: 1, text: "Mix lifted margins.", check: "kind" as const, reason: "a management attribution cites the claim that makes it" }],
      },
    }] },
    { question: second, threadId: "t2", turns: [
      { message: "q2", outcome: "completed" as const, blocks: [], assertions: { status: "missing" as const, accepted: [], rejected: [] } },
      { message: "q3", outcome: "completed" as const, blocks: [], assertions: { status: "checked" as const, accepted: [], rejected: [] } },
      { message: "q4", outcome: "completed" as const, blocks: [], assertions: { status: "checked" as const, accepted: [{ kind: "observation", text: "x", evidence: ["F1"] }], rejected: [], rendered: true } },
    ] },
  ];
  assert.equal(assertionSummary(answered), "2 accepted, 1 rejected (kind 1) over 4 answered turns; 1 missing, 0 malformed, 0 with no figures; 1 rendered");
  const report = renderReport("r", "a/m", "http://app", answered);
  assert.match(report, /Assertions: 2 accepted, 1 rejected \(kind 1\) over 4 answered turns; 1 missing, 0 malformed, 0 with no figures; 1 rendered\./);
  assert.match(report, /_Assertions \(fallback\): 0 accepted, 0 rejected:_/);
  assert.match(report, /_Assertions \(rendered\): 1 accepted, 0 rejected:_/);
  assert.match(report, /_Assertions \(rendered\): 1 accepted, 0 rejected:_/);
  assert.match(report, /- ✓ observation \[F1\] \(text not shown\): NVDA's margin was 75\.0%\.\n- ✗ \[kind\] a management attribution cites the claim that makes it: Mix lifted margins\./);
  assert.match(report, /_Assertions \(fallback\): missing\._/);
  assert.equal(assertionSummary([]), "not reported");
});

test("an accepted assertion's text is marked not shown unless it is an inference's, whose words the page shows (#302)", () => {
  const report = renderReport("r", "a/m", "http://app", [{ question: QUESTIONS[0], threadId: "t1", turns: [{
    message: "q1", outcome: "completed" as const, blocks: [],
    assertions: { status: "checked" as const, rendered: true, rejected: [], accepted: [
      { kind: "observation", text: "NVDA's revenue was $99B.", evidence: ["F1"] },
      { kind: "analyst_inference", text: "Scale funds research.", evidence: [] },
    ] },
  }] }]);
  assert.match(report, /- ✓ observation \[F1\] \(text not shown\): NVDA's revenue was \$99B\.\n- ✓ analyst_inference \[\]: Scale funds research\./);
  const fallback = renderReport("r", "a/m", "http://app", [{ question: QUESTIONS[0], threadId: "t1", turns: [{
    message: "q1", outcome: "completed" as const, blocks: [],
    assertions: { status: "checked" as const, rejected: [], accepted: [{ kind: "analyst_inference", text: "Scale funds research.", evidence: [] }] },
  }] }]);
  assert.match(fallback, /- ✓ analyst_inference \[\] \(text not shown\): Scale funds research\./);
});

const git = (dir: string, ...args: string[]) =>
  execFileSync("git", ["-C", dir, "-c", "user.name=eval", "-c", "user.email=eval@example.com", ...args], { encoding: "utf8" }).trim();

const FROZEN_LINE = (asOf: string) => `// cutoff\nexport const FROZEN_AS_OF = "${asOf}";\nexport const other = 1;\n`;

async function stackCheckout(): Promise<string> {
  const stack = await mkdtemp(join(tmpdir(), "eval-stack-"));
  git(stack, "init", "-q");
  const files: Record<string, string> = {
    "services/chat/test/golden/dataset.ts": "dataset\n",
    "db/seed/metrics.sql": "select 1;\n",
    "db/seed/sources.sql": "sources\n",
    "services/shared/src/golden-issuers.ts": "issuers\n",
    "services/chat/src/ytd-hydration.ts": FROZEN_LINE("2026-09-01T00:00:00.000Z"),
  };
  for (const [path, text] of Object.entries(files)) {
    await mkdir(join(stack, path, ".."), { recursive: true });
    await writeFile(join(stack, path), text);
  }
  git(stack, "add", ".");
  git(stack, "commit", "-q", "-m", "seed");
  return stack;
}

test("provenance names the evaluated stack's commit and dataset, and the runner's commit (#220)", async () => {
  const stack = await stackCheckout();
  const head = git(stack, "rev-parse", "HEAD");

  const provenance = runProvenance(stack);
  assert.equal(provenance.revision, head);
  assert.equal(provenance.runnerRevision, git(process.cwd(), "rev-parse", "HEAD"));
  assert.notEqual(provenance.revision, provenance.runnerRevision);
  assert.equal(provenance.dirty, false);
  // printf 'services/chat/test/golden/dataset.ts\0dataset\n\0db/seed/metrics.sql\0select 1;\n\0db/seed/sources.sql\0sources\n\0services/shared/src/golden-issuers.ts\0issuers\n\0FROZEN_AS_OF\0002026-09-01T00:00:00.000Z' | shasum -a 256
  assert.equal(provenance.datasetRevision, "f1f39a93d799c00ca3bb9e0d8b521015c2e04c2bf1f0c3b9c68997303c19a81d");
  assert.equal(provenance.questionSetDigest, questionSetDigest());

  // An untracked file leaves the tree clean; a changed seed is dirty and a new dataset.
  await writeFile(join(stack, "notes.txt"), "");
  assert.equal(runProvenance(stack).dirty, false);
  await writeFile(join(stack, "db", "seed", "metrics.sql"), "select 2;\n");
  assert.equal(runProvenance(stack).dirty, true);
  assert.notEqual(datasetRevision(stack), provenance.datasetRevision);
});

test("the frozen cutoff moves the dataset revision, and nothing else in its file does (#220)", async () => {
  const stack = await stackCheckout();
  const cutoff = join(stack, "services/chat/src/ytd-hydration.ts");
  await writeFile(cutoff, `${FROZEN_LINE("2026-09-01T00:00:00.000Z")}export const unrelated = 2;\n`);
  assert.equal(datasetRevision(stack), "f1f39a93d799c00ca3bb9e0d8b521015c2e04c2bf1f0c3b9c68997303c19a81d");
  await writeFile(cutoff, FROZEN_LINE("2026-09-02T00:00:00.000Z"));
  assert.equal(datasetRevision(stack), "278983d63194f10f7a74315a90a2da0894258acc067f362c21a4bf71148489ae");
  await writeFile(cutoff, "export const FROZEN_AS_OF = new Date().toISOString();\n");
  assert.throws(() => datasetRevision(stack), (error) => error instanceof Refusal && /can't read FROZEN_AS_OF from services\/chat\/src\/ytd-hydration\.ts/.test(error.message));
});

test("--stack-dir must be the top of a checkout that holds the dataset (#220)", async () => {
  const stack = await stackCheckout();
  const refused = (dir: string, pattern: RegExp) =>
    assert.throws(() => runProvenance(dir), (error) => error instanceof Refusal && pattern.test(error.message));
  // A case-insensitive volume (macOS) opens the checkout under another case; it is still the top.
  const otherCase = stack.replace(/eval-stack-/u, "EVAL-STACK-");
  if (existsSync(otherCase)) assert.equal(runProvenance(otherCase).revision, git(stack, "rev-parse", "HEAD"));
  refused(join(stack, "db"), /--stack-dir .*\/db is inside the checkout .*; pass the checkout's top/);
  refused(await mkdtemp(join(tmpdir(), "eval-no-git-")), /is not a git checkout \(fatal: not a git repository/);
  refused(join(stack, "nowhere"), /--stack-dir .*nowhere does not exist/);
  git(stack, "rm", "-q", "db/seed/sources.sql");
  refused(stack, /has no db\/seed\/sources\.sql, so its frozen dataset can't be named/);
});

test("turn traces are read from the evaluated stack's checkout (#220)", () => {
  assert.equal(traceDirFor("/stack", {}), "/stack/.dev/traces");
  assert.equal(traceDirFor("/stack", { CHAT_TRACE_DIR: " tmp/tr " }), "/stack/tmp/tr");
  assert.equal(traceDirFor("/stack", { CHAT_TRACE_DIR: "/var/tr" }), "/var/tr");
});

test("a blind run's files are ignored by git, and a scored run's are not (#222)", () => {
  const ignored = (path: string) => spawnSync("git", ["check-ignore", "-q", path], { cwd: process.cwd() }).status === 0;
  assert.equal(ignored(join(BLIND_RUNS_DIR, "2026-10-27T100000.run.json")), true);
  assert.equal(ignored(join(RUNS_DIR, "2026-10-27T100000.run.json")), false);
});

test("an expected refusal is one line and exit 1; any other error keeps its stack", async () => {
  const cli = (...args: string[]) => spawnSync(process.execPath, ["--experimental-strip-types", "scripts/research-quality-eval.ts", ...args], { encoding: "utf8" });
  const unknownFlag = cli("summary", "--bogus");
  assert.equal(unknownFlag.status, 1);
  assert.equal(unknownFlag.stderr.trim().split("\n").length, 1, unknownFlag.stderr);
  assert.match(unknownFlag.stderr, /Unknown option '--bogus'/);
  const notACheckout = cli("run", "http://127.0.0.1:1", "--stack-dir", tmpdir());
  assert.equal(notACheckout.status, 1);
  assert.match(notACheckout.stderr, /^--stack-dir .* is not a git checkout/);

  const exitCode = process.exitCode;
  await runCli(() => {
    throw new Refusal("no");
  });
  assert.equal(process.exitCode, 1);
  process.exitCode = exitCode;
  await assert.rejects(runCli(() => {
    throw new TypeError("bug");
  }), TypeError);
});

test("the question-set digest is stable and moves when a question or the rubric changes (#220)", () => {
  const question = { id: "q", kind: "k", turns: [{ message: "m" }], expect: "e" };
  const criterion = { id: "correct_companies" as const, question: "Q", anchors: ["a", "b", "c"] as const };
  assert.equal(questionSetDigest([question], [criterion]), "8b995fb4b3fa2fe1a80b86bf593dff847dffbcd1481f9627147cd1cc6f691e42");
  assert.notEqual(questionSetDigest([{ ...question, expect: "e2" }], [criterion]), "8b995fb4b3fa2fe1a80b86bf593dff847dffbcd1481f9627147cd1cc6f691e42");
  assert.notEqual(questionSetDigest([question], [{ ...criterion, question: "Q2" }]), "8b995fb4b3fa2fe1a80b86bf593dff847dffbcd1481f9627147cd1cc6f691e42");
  assert.equal(questionSetDigest(), questionSetDigest(QUESTIONS, RUBRIC));
});

test("a run record round-trips through run.json, and the report heads with its provenance (#220)", async () => {
  const [first] = QUESTIONS;
  const record: RunRecord = {
    run: "2026-10-27T100000",
    model: "a/m",
    blind: true,
    provenance: { revision: "0123456789abcdef0123", runnerRevision: "fedcba9876543210fedc", dirty: true, questionSetDigest: "aaaaaaaaaaaaaaaa", datasetRevision: "bbbbbbbbbbbbbbbb" },
    planned: QUESTIONS.map((q) => q.id),
    complete: false,
    questions: [{ question: first, threadId: "t1", turns: [{ message: "q1", outcome: "completed", blocks: [{ kind: "rich_text", segments: [] }], elapsedMs: 1200, answeredBy: "a/m", usage: null, assertions: null }] }],
  };
  const path = join(await mkdtemp(join(tmpdir(), "eval-run-")), "r.run.json");
  await writeFile(path, serializeRun(record));
  assert.deepEqual(readRunRecord(path), record);
  assert.deepEqual(Object.keys(JSON.parse(serializeRun(record))), ["run", "model", "blind", "provenance", "planned", "complete", "questions"]);

  const report = renderReport(record.run, record.model, "http://app", record.questions, record.provenance, record);
  assert.match(report, new RegExp([
    "^# Research-quality eval: 2026-10-27T100000\n\n",
    `\\*\\*Incomplete run:\\*\\* 1 of ${QUESTIONS.length} planned questions asked; not asked: ${QUESTIONS.slice(1).map((q) => q.id).join(", ")}\\.\n\n`,
    "Stack revision: `0123456789ab` with uncommitted changes\\. Runner revision: `fedcba987654`\\. Question set: `aaaaaaaaaaaa`\\. Dataset: `bbbbbbbbbbbb`\\.",
  ].join("")));
  const done = renderReport(record.run, record.model, "http://app", record.questions, record.provenance, { planned: [first.id], complete: true });
  assert.match(done, /^# Research-quality eval: 2026-10-27T100000\n\nStack revision:/);
  assert.match(renderReport("r", "m", "http://app", []), /Stack revision: unknown\. Runner revision: unknown\. Question set: unknown\. Dataset: unknown\./);
});

const said = (text: string, answeredBy = "a/m"): AnsweredTurn =>
  ({ message: "m", outcome: "completed", blocks: [{ kind: "rich_text", segments: [{ type: "text", text }] }], elapsedMs: 1000, answeredBy, checks: null });
const failed = (outcome: AnsweredTurn["outcome"]): AnsweredTurn => ({ message: "m", outcome, blocks: [], elapsedMs: 180_000, answeredBy: null, checks: null });
const runOf = (run: string, revision: string, turns: Record<string, AnsweredTurn[]>): RunRecord => ({
  run,
  model: `${run}-route/model`,
  provenance: { revision, dirty: false, questionSetDigest: "1".repeat(64), datasetRevision: "2".repeat(64) },
  questions: Object.entries(turns).map(([id, t]) => ({ question: QUESTIONS.find((q) => q.id === id)!, threadId: `thread-${run}-${id}`, turns: t })),
});
const baselineRun = runOf("2026-10-01T000000", "baserev0000000000aaaa", {
  "single-latest-quarter": [said("Ottawa on the latest quarter.")],
  "peer-two": [said("Ottawa on NVDA and AMD.")],
  "missing-cash-flow": [said("Ottawa: cash flow is not available.")],
  "ticker-page-compare": [said("Ottawa on AAPL and NVDA.")],
});
const candidateRun = runOf("2026-10-02T000000", "candrev1111111111bbbb", {
  "single-latest-quarter": [said("Lisbon on the latest quarter.")],
  "peer-two": [said("Lisbon on NVDA and AMD.", "fallback/other")],
  "missing-cash-flow": [failed("timeout")],
  "ticker-page-compare": [said("Lisbon on AAPL and NVDA.")],
});
const ORDER_7 = ["missing-cash-flow", "peer-two", "ticker-page-compare", "single-latest-quarter"];
const SIDES_7 = [["missing-cash-flow", "candidate"], ["peer-two", "candidate"], ["ticker-page-compare", "baseline"], ["single-latest-quarter", "baseline"]];
const ORDER_8 = ["missing-cash-flow", "ticker-page-compare", "peer-two", "single-latest-quarter"];
const packetOrder = (packet: string) => [...packet.matchAll(/^## \d+\. (\S+)/gmu)].map((match) => match[1]);

test("a seed fixes the packet's question order and A/B sides, and another seed shuffles differently (#222)", () => {
  const first = buildPair(baselineRun, candidateRun, 7, "s");
  assert.deepEqual(buildPair(baselineRun, candidateRun, 7, "s"), first);
  assert.deepEqual(packetOrder(first.packet), ORDER_7);
  assert.deepEqual(Object.entries(first.key.pairs).map(([id, pair]) => [id, pair.A]), SIDES_7);
  assert.deepEqual(packetOrder(buildPair(baselineRun, candidateRun, 8, "s").packet), ORDER_8);
  assert.equal(first.key.seed, 7);
});

test("two runs of different question sets or datasets are not paired (#222)", () => {
  const otherQuestions = { ...candidateRun, provenance: { ...candidateRun.provenance, questionSetDigest: "3".repeat(64) } };
  assert.throws(() => buildPair(baselineRun, otherQuestions, 7, "s"), /can't pair 2026-10-01T000000 with 2026-10-02T000000: their questionSetDigest differs/);
  const otherData = { ...candidateRun, provenance: { ...candidateRun.provenance, datasetRevision: "3".repeat(64) } };
  assert.throws(() => buildPair(baselineRun, otherData, 7, "s"), /their datasetRevision differs/);
  const { provenance: _, ...legacy } = candidateRun;
  assert.throws(() => buildPair(baselineRun, legacy as RunRecord, 7, "s"), /questionSetDigest differs \(1{64} vs unknown\)/);
});

test("the packet shows both answers and never which run, revision or model wrote them (#222)", () => {
  const { packet, scores, key } = buildPair(baselineRun, candidateRun, 7, "s");
  for (const answer of ["Ottawa on NVDA and AMD.", "Lisbon on NVDA and AMD.", "Ottawa: cash flow is not available."]) assert.match(packet, new RegExp(answer));
  assert.match(packet, /\*\*Expect:\*\* Side-by-side latest fiscal year/);
  assert.match(packet, /N\/A: comparable_periods, figures_match_sources, conclusions_justified, counterarguments/);
  assert.match(packet, /- \*\*no_invented_numbers\*\*: Is missing data stated honestly/);
  assert.match(packet, /\*\*Q:\*\* Compare with NVDA\. \(opened from the AAPL page\)/);
  for (const hidden of ["baserev", "candrev", "2026-10-01T000000", "2026-10-02T000000", "route/model", "a/m", "fallback/other", "thread-", "baseline", "candidate"]) {
    assert.doesNotMatch(packet, new RegExp(hidden, "i"), hidden);
  }

  // A turn that timed out is no answer, and its cells are not scored.
  const side = key.pairs["missing-cash-flow"]!.A === "candidate" ? "A" : "B";
  assert.match(packet, /_Not scored: a turn didn't complete, so every cell of this answer is n\/a\._\n\n\*\*Q:\*\* What is AMD's free cash flow\?\n\n_No answer \(timeout\)\._/);
  assert.deepEqual(Object.values(scores.pairs["missing-cash-flow"]![side]), ["n/a", "n/a", "n/a", "n/a", "n/a", "n/a"]);
  assert.deepEqual(scores.pairs["missing-cash-flow"]!.labels[side], ["operational_failure"]);
  assert.deepEqual(scores.pairs["peer-two"]!.A, { correct_companies: null, comparable_periods: null, figures_match_sources: null, conclusions_justified: null, counterarguments: null, no_invented_numbers: null });
});

test("a pair is confounded when the arms' answering models differ on a turn both answered (#222)", () => {
  const { key } = buildPair(baselineRun, candidateRun, 7, "s");
  assert.deepEqual(Object.fromEntries(Object.entries(key.pairs).map(([id, pair]) => [id, pair.confounded])), {
    ...Object.fromEntries(ORDER_7.map((id) => [id, false])),
    "peer-two": true,
  });
  assert.equal(confounded([said("x", "a/m")], [said("y", "a/m")]), false);
  assert.equal(confounded([said("x", "a/m")], [said("y", "b/m")]), true);
  assert.equal(confounded([said("x", "a/m")], [failed("provider_error")]), false);
  assert.equal(confounded([{ outcome: "completed" }], [said("y", "a/m")]), true, "an unrecorded model can't be ruled out");
});

function scoreArm(scores: PairScores, key: PairKey, id: string, arm: Arm, values: number[]): void {
  const side = key.pairs[id]!.A === arm ? "A" : "B";
  RUBRIC.forEach((criterion, i) => {
    if (scores.pairs[id]![side][criterion.id] !== "n/a") scores.pairs[id]![side][criterion.id] = values[i] as Score;
  });
}

test("reveal refuses while a cell is unscored, unless the review is named incomplete (#222)", () => {
  const { scores, key } = buildPair(baselineRun, candidateRun, 7, "s");
  assert.throws(() => reveal(key, scores), /38 applicable cells are unscored \(.*\); score them, or pass --incomplete/);
  const partial = reveal(key, scores, true);
  assert.match(partial, /^# Blinded comparison: baseline 2026-10-01T000000 vs candidate 2026-10-02T000000\n\n\*\*Incomplete review:\*\* 38 applicable cells were left unscored/);
  assert.match(partial, /## Unscored cells\n\n- [a-z-]+ [AB] correct_companies\n/);

  // A cell of an answer that wasn't given stays n/a.
  const side = key.pairs["missing-cash-flow"]!.A === "candidate" ? "A" : "B";
  scores.pairs["missing-cash-flow"]![side].correct_companies = 2;
  assert.throws(() => reveal(key, scores, true), new RegExp(`missing-cash-flow\\.${side}\\.correct_companies is 2, but this answer was not given`));
});

test("reveal totals each arm per criterion and attributes deltas only to unconfounded pairs (#222)", () => {
  const { scores, key } = buildPair(baselineRun, candidateRun, 7, "s");
  scoreArm(scores, key, "single-latest-quarter", "baseline", [1, 1, 1, 1, 1, 1]);
  scoreArm(scores, key, "single-latest-quarter", "candidate", [2, 2, 2, 2, 2, 2]);
  scoreArm(scores, key, "peer-two", "baseline", [2, 2, 2, 2, 2, 2]);
  scoreArm(scores, key, "peer-two", "candidate", [0, 2, 2, 2, 2, 2]);
  scoreArm(scores, key, "missing-cash-flow", "baseline", [2, 0, 0, 0, 0, 2]);
  scoreArm(scores, key, "ticker-page-compare", "baseline", [2, 0, 2, 1, 1, 2]);
  scoreArm(scores, key, "ticker-page-compare", "candidate", [2, 2, 2, 1, 0, 2]);
  const peerSide = key.pairs["peer-two"]!.A === "candidate" ? "A" : "B";
  scores.pairs["peer-two"]!.labels[peerSide] = ["wrong_subject"];

  const report = reveal(key, scores);
  assert.doesNotMatch(report, /Incomplete/);
  assert.match(report, /\| baseline \| 2026-10-01T000000 \| `baserev00000` \| `111111111111` \| `222222222222` \|/);
  assert.ok(report.includes([
    "| criterion | baseline | candidate | attributed delta | confounded delta |",
    "|---|---|---|---|---|",
    "| correct_companies | 7/8 | 4/6 | +1 | -2 |",
    "| comparable_periods | 3/6 | 6/6 | +3 | 0 |",
    "| figures_match_sources | 5/6 | 6/6 | +1 | 0 |",
    "| conclusions_justified | 4/6 | 5/6 | +1 | 0 |",
    "| counterarguments | 4/6 | 4/6 | 0 | 0 |",
    "| no_invented_numbers | 7/8 | 6/6 | +1 | 0 |",
  ].join("\n")), report);
  assert.match(report, /\| single-latest-quarter \| \+1 \| \+1 \| \+1 \| \+1 \| \+1 \| \+1 \|/);
  assert.match(report, /\| ticker-page-compare \| 0 \| \+2 \| 0 \| 0 \| -1 \| 0 \|/);
  assert.match(report, /\| missing-cash-flow \| — \| — \| — \| — \| — \| — \|/);
  assert.match(report, /## Confounded pairs \(not attributed to the change\)\n\n\| question[^\n]*\n\|---[^\n]*\n\| peer-two \| -2 \| 0 \| 0 \| 0 \| 0 \| 0 \|\n\n/);
  assert.match(report, /## Not compared\n\n- missing-cash-flow: the candidate gave no answer \(timeout\)\.\n/);
  assert.match(report, /## Unscored cells\n\nNone\./);
  assert.match(report, /\| peer-two \| 1 \| completed, `a\/m` \| completed, `fallback\/other` \|/);
  assert.match(report, /\| missing-cash-flow \| 1 \| completed, `a\/m` \| timeout, none \|/);
  assert.match(report, /\| wrong_subject \| 0 \| 1 \|\n\| wrong_period \| 0 \| 0 \|\n/);
  assert.match(report, /\| operational_failure \| 0 \| 1 \|\n$/);
});
