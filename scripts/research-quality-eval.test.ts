import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  blankScores,
  checkCounts,
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
  runStamp,
  summarize,
  threadTraces,
  type RunRecord,
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
  const counts = checkCounts({
    status: "checked",
    accepted: [{ kind: "observation", text: "a", evidence: ["F1"] }, { kind: "comparison", text: "b", evidence: ["F1", "F2"] }],
    rejected: [
      { index: 2, check: "binding", reason: "r" },
      { index: 3, check: "judge", reason: "r" },
      { index: 4, check: "binding", reason: "r" },
    ],
  });
  assert.deepEqual(counts, { accepted: 2, rejected: { binding: 2, judge: 1 } });
  assert.equal(formatChecks(counts!), "2 accepted, 3 rejected (binding 2, judge 1)");
  assert.equal(checkCounts(null), null);
});

test("each turn shows its outcome, time, model and checks, and a field a run didn't record renders unknown (#220)", () => {
  const [first] = QUESTIONS;
  const report = renderReport("r", "m", "http://app", [{ question: first, threadId: "t1", turns: [
    { message: "q1", outcome: "completed", blocks: [], elapsedMs: 12_340, answeredBy: "a/m", checks: { accepted: 3, rejected: { binding: 1 } } },
    { message: "q2", outcome: "timeout", blocks: [], elapsedMs: 180_000, answeredBy: null, checks: null },
    { message: "q3", outcome: "skipped", blocks: [], elapsedMs: null, answeredBy: null, checks: null },
    { message: "q4", outcome: "completed", blocks: [] },
  ] }]);
  assert.match(report, /### Q: q1\n\n_Outcome: completed; time: 12\.3s; answered by: `a\/m`; checks: 3 accepted, 1 rejected \(binding 1\)\._/);
  assert.match(report, /\*\*Turn ended with timeout\.\*\*\n\n_Outcome: timeout; time: 180\.0s; answered by: none; checks: none\._/);
  assert.match(report, /\*\*Not sent: an earlier turn didn't complete\.\*\*\n\n_Outcome: skipped; time: none; answered by: none; checks: none\._/);
  assert.match(report, /### Q: q4\n\n_Outcome: completed; time: unknown; answered by: unknown; checks: unknown\._/);
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

test("provenance names the evaluated stack's commit and dataset, not the runner's (#220)", async () => {
  const stack = await mkdtemp(join(tmpdir(), "eval-stack-"));
  git(stack, "init", "-q");
  await mkdir(join(stack, "db", "seed"), { recursive: true });
  await writeFile(join(stack, "db", "seed", "metrics.sql"), "select 1;\n");
  git(stack, "add", ".");
  git(stack, "commit", "-q", "-m", "seed");
  const head = git(stack, "rev-parse", "HEAD");

  const provenance = runProvenance(stack);
  assert.equal(provenance.revision, head);
  assert.notEqual(provenance.revision, git(process.cwd(), "rev-parse", "HEAD"));
  assert.equal(provenance.dirty, false);
  assert.equal(provenance.datasetRevision, "f51f3c9ea0560d1d00244bee96120e3dfd8ae54680d021c9062419ae4e04b53f");
  assert.equal(provenance.questionSetDigest, questionSetDigest());

  // An untracked file leaves the tree clean; a changed seed is dirty and a new dataset.
  await writeFile(join(stack, "notes.txt"), "");
  assert.equal(runProvenance(stack).dirty, false);
  await writeFile(join(stack, "db", "seed", "metrics.sql"), "select 2;\n");
  assert.equal(runProvenance(stack).dirty, true);
  assert.notEqual(datasetRevision(stack), provenance.datasetRevision);

  const bare = await mkdtemp(join(tmpdir(), "eval-no-git-"));
  assert.throws(() => runProvenance(bare), /not a git repository/);
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
    provenance: { revision: "0123456789abcdef0123", dirty: true, questionSetDigest: "aaaaaaaaaaaaaaaa", datasetRevision: "bbbbbbbbbbbbbbbb" },
    questions: [{ question: first, threadId: "t1", turns: [{ message: "q1", outcome: "completed", blocks: [{ kind: "rich_text", segments: [] }], elapsedMs: 1200, answeredBy: "a/m", usage: null, assertions: null, checks: null }] }],
  };
  const path = join(await mkdtemp(join(tmpdir(), "eval-run-")), "r.run.json");
  await writeFile(path, serializeRun(record));
  assert.deepEqual(readRunRecord(path), record);
  assert.deepEqual(Object.keys(JSON.parse(serializeRun(record))), ["run", "model", "provenance", "questions"]);

  const report = renderReport(record.run, record.model, "http://app", record.questions, record.provenance);
  assert.match(report, /^# Research-quality eval: 2026-10-27T100000\n\nStack revision: `0123456789ab` with uncommitted changes\. Question set: `aaaaaaaaaaaa`\. Dataset: `bbbbbbbbbbbb`\./);
  assert.match(renderReport("r", "m", "http://app", []), /Stack revision: unknown\. Question set: unknown\. Dataset: unknown\./);
});
