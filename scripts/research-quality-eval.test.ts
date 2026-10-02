import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  blankScores,
  modelForRun,
  modelLabel,
  readRuns,
  renderBlock,
  renderReport,
  runStamp,
  summarize,
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

test("the report shows every turn, its expectation, and a failed turn as failed", () => {
  const question = QUESTIONS.find((q) => q.id === "ticker-page-compare")!;
  const report = renderReport("2026-10-01T1000", "gpt-x", "http://app", [
    { question, threadId: "t1", turns: [{ message: question.turns[0]!.message, outcome: "timeout", blocks: [] }] },
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

test("a run with fallbacks configured is labelled with them, and its report warns", () => {
  assert.equal(modelLabel("opencode-go/qwen3.8-max", []), "opencode-go/qwen3.8-max");
  assert.equal(modelLabel("opencode-go/qwen3.8-max", undefined), "opencode-go/qwen3.8-max");
  const label = modelLabel("opencode-go/qwen3.8-max", ["opencode-go/kimi-k2.7-code"]);
  assert.equal(label, "opencode-go/qwen3.8-max (fallbacks: opencode-go/kimi-k2.7-code)");
  assert.match(renderReport("r", label, "http://app", []), /Fallbacks were configured/);
  assert.doesNotMatch(renderReport("r", "opencode-go/qwen3.8-max", "http://app", []), /Fallbacks were configured/);
});

test("summary on a fresh checkout reads no runs instead of failing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "eval-runs-"));
  assert.deepEqual(readRuns(join(dir, "missing")), []);
});

test("turns after one that didn't complete are shown as not sent", () => {
  const question = QUESTIONS.find((q) => q.id === "follow-up-memory")!;
  const report = renderReport("r", "m", "http://app", [{
    question,
    threadId: "t",
    turns: [
      { message: question.turns[0]!.message, outcome: "timeout", blocks: [] },
      { message: question.turns[1]!.message, outcome: "skipped", blocks: [] },
    ],
  }]);
  assert.match(report, /Turn ended with timeout/);
  assert.match(report, /Not sent: an earlier turn didn't complete/);
});
