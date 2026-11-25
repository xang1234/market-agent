import assert from "node:assert/strict";
import test from "node:test";

import { enumerateNumerals, type Operand } from "../services/financial-core/src/figure-check.ts";
import { GOLDEN_COMPANIES, goldenDailyBars } from "../services/chat/test/golden/dataset.ts";
import { questionSetDigest, type RunRecord } from "./research-quality-eval.ts";
import { Refusal } from "./research-quality-eval.ts";
import {
  LABELS_SCHEMA,
  anthropicLabeller,
  checkRun,
  labellerPrompt,
  labellerSystemPrompt,
  markNumerals,
  rejudge,
  sentenceAt,
  summaryLines,
  verdictFor,
  type FiguresFile,
  type GoldenRef,
  type LabelledFigure,
  type Labeller,
} from "./research-quality-figures.ts";
import { QUESTIONS } from "./research-quality-questions.ts";

const ref = (company: string, metric: GoldenRef["metric"], fiscal_year: number | null, fiscal_period: GoldenRef["fiscal_period"], extra: Partial<GoldenRef> = {}): GoldenRef =>
  ({ company, metric, fiscal_year, fiscal_period, segment: null, date: null, ...extra });
const of = (value: GoldenRef, over: GoldenRef | null = null): Operand<GoldenRef> => ({ add: [value], subtract: [], over: over === null ? null : [over] });
const reported = (id: string, source: GoldenRef | null, extra: Partial<LabelledFigure> = {}): LabelledFigure =>
  ({ id, company: source?.company ?? null, metric: "m", period: "p", basis: "reported", source, derivation: null, operands: [], sign: null, scale: null, ...extra });
const derived = (id: string, derivation: LabelledFigure["derivation"], operands: Operand<GoldenRef>[], extra: Partial<LabelledFigure> = {}): LabelledFigure =>
  ({ id, company: null, metric: "m", period: "p", basis: "derived", source: null, derivation, operands, sign: null, scale: null, ...extra });
// One numeral, as the enumerator reads it.
const numeral = (text: string) => {
  const found = enumerateNumerals(text);
  assert.equal(found.length === 1 && text.endsWith(found[0]!.text), true, `${text} ends in its one numeral`);
  return found[0]!;
};
const check = (text: string, label: LabelledFigure) => verdictFor(numeral(text), label);

// The numerals and the verdict rules are financial-core's (test/figure-check.test.ts); these
// cases cover what the eval adds: golden pointers, the labeller's shape and the saved verdict.
test("each golden pointer reads its value on file, and a verdict saves its expected value in the numeral's unit", () => {
  const revenue = ref("NVDA", "revenue", 2026, "Q4");
  assert.deepEqual(check("$62.1B", reported("n1", revenue)), { verdict: "matched" });
  assert.deepEqual(check("$62.2B", reported("n1", revenue)), { verdict: "near", expected: 62_100e6 }, "one unit of the last digit off");
  assert.deepEqual(check("$62.3B", reported("n1", revenue)), { verdict: "wrong", expected: 62_100e6 }, "two units off is a misstatement");
  assert.deepEqual(check("$178.40", reported("n1", ref("NVDA", "quote_price", null, null))), { verdict: "matched" });
  const last = goldenDailyBars(GOLDEN_COMPANIES[2]!).at(-1)!;
  assert.deepEqual(check(`$${last.close.toFixed(2)}`, reported("n1", ref("AAPL", "bar_close", null, null, { date: last.ts.slice(0, 10) }))), { verdict: "matched" });
  assert.deepEqual(check("$55.2B", reported("n1", ref("NVDA", "segment_revenue", 2026, "Q4", { segment: "Data Center" }))), { verdict: "matched" });
  assert.deepEqual(check("$800 million", reported("n1", ref("AMD", "filed_claim", 2025, "Q2"))), { verdict: "matched" });
  assert.equal(check("$900 million", reported("n1", ref("AMD", "filed_claim", 2025, "Q2"))).verdict, "near", "one unit of $100M off");
  assert.equal(check("$950 million", reported("n1", ref("AMD", "filed_claim", 2025, "Q2"))).verdict, "wrong");
  const q4 = (metric: GoldenRef["metric"]) => of(ref("NVDA", metric, 2026, "Q4"));
  assert.deepEqual(check("74.4%", derived("n1", "margin", [q4("gross_profit"), q4("revenue")])), { verdict: "derived_ok" });
  assert.deepEqual(check("75.1%", derived("n1", "margin", [q4("gross_profit"), q4("revenue")])), { verdict: "wrong", expected: 46_200 / 62_100 * 100 }, "a margin's expected value is a percent");
  assert.deepEqual(check("0.77", derived("n1", "margin", [q4("gross_profit"), q4("revenue")])), { verdict: "wrong", expected: 46_200 / 62_100 }, "a bare fraction's expected value keeps its scale");
  assert.deepEqual(check("about 74.4%", derived("n1", "margin", [q4("gross_profit"), q4("revenue")])).verdict, "near");
  // AMD's Q2 FY2025 operating income before the filed $800M charge: -134 + 800 = 666.
  const amd = (metric: GoldenRef["metric"]) => ref("AMD", metric, 2025, "Q2");
  const beforeCharge = derived("n1", "sum", [{ add: [amd("operating_income"), amd("filed_claim")], subtract: [], over: null }]);
  assert.deepEqual(check("$666M", beforeCharge), { verdict: "derived_ok" });
  assert.equal(check("$766M", beforeCharge).verdict, "wrong");
  assert.deepEqual(check("$666M", derived("n1", "sum", [of(amd("operating_income")), of(amd("filed_claim"))])), { verdict: "derived_ok" }, "one operand each");
  assert.deepEqual(check("10.4%", derived("n1", "share_of_total", [of(amd("filed_claim")), of(amd("revenue"))])), { verdict: "derived_ok" }, "the charge as a share of revenue");
  // A difference never adds the charge back: it would expect $934M for the right $666M (#805).
  const alone = { verdict: "not_checkable", reason: "a difference from the filed charge alone" };
  assert.deepEqual(check("$666M", derived("n1", "difference", [of(amd("operating_income")), of(amd("filed_claim"))])), alone);
  assert.deepEqual(check("$934M", derived("n1", "difference", [of(amd("filed_claim")), of(amd("operating_income"))])), alone, "in either order");
});

test("a figure the golden data can't settle is not checkable, with its reason", () => {
  assert.deepEqual(verdictFor(numeral("$2.1B"), undefined), { verdict: "not_checkable", reason: "the labeller skipped it" });
  assert.deepEqual(check("$2.1B", reported("n1", null, { metric: "free cash flow" })), { verdict: "not_checkable", reason: "free cash flow (p) isn't in the data" });
  assert.deepEqual(check("$2.1B", derived("n1", null, [])), { verdict: "not_checkable", reason: "derived, but no derivation given" });
  assert.equal(check("$6.8B", reported("n1", ref("AMD", "revenue", 2024, "Q1"))).reason, "its source isn't in the data", "a quarter that isn't seeded");
  assert.equal(check("$2.1B", derived("n1", "growth", [of(ref("AMD", "revenue", 2024, "Q1")), of(ref("AMD", "revenue", 2025, "Q1"))])).reason, "an operand isn't in the data");
});

test("the labeller sees each numeral marked by its id", () => {
  const text = "NVDA's revenue was **$62.1B** in Q4 FY2026 (ended 2026-01-25).";
  assert.equal(markNumerals(text, enumerateNumerals(text)), "NVDA's revenue was **⟦n1:$62.1B⟧** in Q⟦n2:4⟧ FY⟦n3:2026⟧ (ended ⟦n4:2026-01-25⟧).");
});

test("the labeller's schema is strict JSON schema and its prompt carries no values", () => {
  const objects: Array<Record<string, unknown>> = [];
  const walk = (node: unknown) => {
    if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === "object") {
      if ((node as { type?: unknown }).type === "object") objects.push(node as Record<string, unknown>);
      Object.values(node).forEach(walk);
    }
  };
  walk(LABELS_SCHEMA);
  for (const object of objects) {
    assert.equal(object.additionalProperties, false);
    assert.deepEqual([...(object.required as string[])].sort(), Object.keys(object.properties as object).sort());
  }
  const prompt = labellerSystemPrompt();
  assert.match(prompt, /Q4 FY2026 \(2025-10-27 to 2026-01-25\)/u);
  assert.doesNotMatch(prompt, /62,100|62\.1|46,200|178\.4/u, "no value the labeller could match a figure to");
});

const runWith = (turns: RunRecord["questions"][number]["turns"]): RunRecord => ({
  run: "2026-11-25T000000",
  model: "anthropic/claude-sonnet-5-5",
  blind: true,
  provenance: { revision: "r", runnerRevision: "r", dirty: false, questionSetDigest: questionSetDigest(), datasetRevision: "d" },
  planned: [QUESTIONS[0]!.id],
  complete: true,
  questions: [{ question: QUESTIONS[0]!, threadId: "", turns }],
});
const text = (markdown: string) => [{ kind: "rich_text", segments: [{ type: "text", text: markdown }] }];

test("a run's completed turns are rendered, labelled and judged; a skipped numeral still counts", async () => {
  const answer = "NVDA's Q4 FY2026 revenue was $62.1B.\nGross margin was 75.1% and free cash flow $30B.";
  const seen: string[] = [];
  const label: Labeller = async (input) => {
    seen.push(labellerPrompt(input));
    return {
      ok: true,
      labels: {
        labels: ["n1", "n2"],
        figures: [
          reported("n3", ref("NVDA", "revenue", 2026, "Q4")),
          derived("n4", "margin", [of(ref("NVDA", "gross_profit", 2026, "Q4")), of(ref("NVDA", "revenue", 2026, "Q4"))]),
        ],
      },
    };
  };
  const file = await checkRun(runWith([
    { message: "Analyze NVDA's latest quarter.", outcome: "completed", blocks: text(answer), answeredBy: "anthropic/claude-sonnet-5-5" },
  ]), label);
  assert.equal(seen.length, 1);
  assert.match(seen[0]!, /1\. Analyze NVDA's latest quarter\./u);
  assert.match(seen[0]!, /revenue was ⟦n3:\$62\.1B⟧/u);
  assert.deepEqual(file.totals, { figures: 3, matched: 1, derived_ok: 0, near: 0, wrong: 1, not_checkable: 1 });
  const [turn] = file.turns;
  assert.deepEqual(turn!.numerals.map((n) => [n.text, n.verdict]), [["4", null], ["2026", null], ["$62.1B", "matched"], ["75.1%", "wrong"], ["$30B", "not_checkable"]]);
  assert.equal(turn!.numerals[4]!.reason, "the labeller skipped it");
  const lines = summaryLines(file);
  assert.equal(lines[0], "2026-11-25T000000: figures 3, matched 1, derived_ok 0, near 0, wrong 1, not_checkable 1");
  assert.equal(lines[1], "  wrong single-latest-quarter turn 1: 75.1% (data: 74.3961): Gross margin was 75.1% and free cash flow $30B.");
});

test("a turn that didn't complete isn't checked, and a labeller failure leaves every figure not checkable", async () => {
  const file = await checkRun(runWith([
    { message: "a", outcome: "timeout", blocks: [], answeredBy: null },
  ]), async () => assert.fail("nothing to label"));
  assert.deepEqual(file.turns, []);
  const failed = await checkRun(runWith([
    { message: "a", outcome: "completed", blocks: text("Revenue was $62.1B."), answeredBy: "m" },
  ]), anthropicLabeller(async () => ({ ok: true, model: "claude-opus-5-5", content: [], text: "{\"labels\": [", stopReason: "max_tokens", usage: { input_tokens: 1, output_tokens: 1 } })));
  assert.deepEqual(failed.totals, { figures: 1, matched: 0, derived_ok: 0, near: 0, wrong: 0, not_checkable: 1 });
  assert.equal(failed.turns[0]!.labeller.error, "unreadable labels (stop reason max_tokens)");
  assert.match(summaryLines(failed)[0]!, /\(1 turns not labelled\)$/u);
});

test("a checked run is judged again from its saved labels, and refused when its numerals moved", async () => {
  const label: Labeller = async () => ({ ok: true, labels: { labels: [], figures: [reported("n1", ref("NVDA", "revenue", 2026, "Q4"), { sign: "+" })] } });
  const file = await checkRun(runWith([{ message: "a", outcome: "completed", blocks: text("Revenue was $62.1B, and $1B more."), answeredBy: "m" }]), label);
  assert.deepEqual(file.totals, { figures: 2, matched: 1, derived_ok: 0, near: 0, wrong: 0, not_checkable: 1 });
  assert.deepEqual(rejudge(JSON.parse(JSON.stringify(file))), file);
  const fixed = JSON.parse(JSON.stringify(file));
  fixed.turns[0].numerals[0].label.source.fiscal_period = "Q3";
  fixed.turns[0].numerals[0].label.source.fiscal_year = 2026;
  assert.equal(rejudge(fixed).turns[0]!.numerals[0]!.verdict, "wrong", "verdicts come from the saved labels");
  const moved = JSON.parse(JSON.stringify(file));
  moved.turns[0].text = "Revenue was $62.1B.";
  assert.throws(() => rejudge(moved), (error: unknown) => error instanceof Refusal && /run check again/u.test(error.message));
});

test("a wrong figure's sentence is the one it sits in", () => {
  const body = "Revenue rose. Margin was 75.1% in Q4 FY2026, up from 73.0%.\n| x | 4.2 |";
  assert.equal(sentenceAt(body, body.indexOf("75.1"), body.indexOf("75.1") + 5), "Margin was 75.1% in Q4 FY2026, up from 73.0%.");
  assert.equal(sentenceAt(body, body.indexOf("4.2"), body.indexOf("4.2") + 3), "| x | 4.2 |");
});

test("a figures file saved before operands could sum still rejudges, its operands read as one value each", () => {
  const nvda = (metric: GoldenRef["metric"]) => ref("NVDA", metric, 2026, "Q4");
  const old = { value: nvda("gross_profit"), over: nvda("revenue") };
  const saved = {
    run: "2026-11-25T000000",
    checkedAgainst: { datasetRevision: "d", asOf: "a" },
    labeller: { model: "anthropic/claude-opus-5-5", effort: "medium", max_tokens: 32_000 },
    totals: { figures: 1, matched: 0, derived_ok: 1, wrong: 0, not_checkable: 0 },
    turns: [{
      question: "q", turn: 1, message: "m", text: "Gross margin was 74.4%.", labeller: {},
      numerals: [{ id: "n1", text: "74.4%", start: 17, end: 22, label: { ...derived("n1", "share_of_total", []), operands: [old] }, verdict: "derived_ok" }],
    }],
  } as unknown as FiguresFile;
  const rejudged = rejudge(saved);
  assert.deepEqual(rejudged.totals, { figures: 1, matched: 0, derived_ok: 1, near: 0, wrong: 0, not_checkable: 0 });
  const label = rejudged.turns[0]!.numerals[0]!.label as { operands: unknown };
  assert.deepEqual(label.operands, [{ add: [nvda("gross_profit")], subtract: [], over: [nvda("revenue")] }], "saved in the current shape");
});
