import assert from "node:assert/strict";
import test from "node:test";

import { blankScores, renderBlock, renderReport, summarize, type ScoresFile } from "./research-quality-eval.ts";
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
