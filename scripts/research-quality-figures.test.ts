import assert from "node:assert/strict";
import test from "node:test";

import { GOLDEN_COMPANIES, goldenDailyBars } from "../services/chat/test/golden/dataset.ts";
import { questionSetDigest, type RunRecord } from "./research-quality-eval.ts";
import {
  LABELS_SCHEMA,
  anthropicLabeller,
  checkRun,
  derive,
  enumerateNumerals,
  labellerPrompt,
  labellerSystemPrompt,
  markNumerals,
  sentenceAt,
  summaryLines,
  verdictFor,
  withinPrecision,
  type DataRef,
  type FigureLabel,
  type Labeller,
  type Operand,
} from "./research-quality-figures.ts";
import { QUESTIONS } from "./research-quality-questions.ts";

const ref = (company: string, metric: DataRef["metric"], fiscal_year: number | null, fiscal_period: DataRef["fiscal_period"], extra: Partial<DataRef> = {}): DataRef =>
  ({ company, metric, fiscal_year, fiscal_period, segment: null, date: null, ...extra });
const of = (value: DataRef, over: DataRef | null = null): Operand => ({ value, over });
const reported = (id: string, source: DataRef | null, extra: Partial<FigureLabel> = {}): FigureLabel =>
  ({ id, company: source?.company ?? null, metric: "m", period: "p", basis: "reported", source, derivation: null, operands: [], sign: null, scale: null, ...extra });
const derived = (id: string, derivation: FigureLabel["derivation"], operands: Operand[], extra: Partial<FigureLabel> = {}): FigureLabel =>
  ({ id, company: null, metric: "m", period: "p", basis: "derived", source: null, derivation, operands, sign: null, scale: null, ...extra });
// One numeral, as the enumerator reads it.
const numeral = (text: string) => {
  const [found] = enumerateNumerals(text);
  assert.equal(found?.text, text, `${text} reads as one numeral`);
  return found!;
};
const check = (text: string, label: FigureLabel) => verdictFor(numeral(text), label);

test("every numeral is found with its span, value, precision, unit and sign", () => {
  const text = "NVDA's revenue was **$62.1B** in Q4 FY2026 (ended 2026-01-25), up 9% from $57,006 million; operating income of -$134.0M; "
    + "margin fell 12.5 points (−1,250 bps); 3.2x; ($134M) and (10.84%); as of 2026-09-01T00:00:00.000Z; 74.40%; 1,010,000 shares at $178.40. Q3 FY2024–Q2 FY2026.";
  const found = enumerateNumerals(text);
  assert.deepEqual(found.map((n) => n.text), [
    "$62.1B", "4", "2026", "2026-01-25", "9%", "$57,006 million", "-$134.0M", "12.5 points", "−1,250 bps", "3.2x", "($134M)", "10.84%",
    "2026-09-01T00:00:00.000Z", "74.40%", "1,010,000", "$178.40", "3", "2024", "2", "2026",
  ]);
  for (const n of found) assert.equal(text.slice(n.start, n.end), n.text);
  const by = (t: string) => found.find((n) => n.text === t)!;
  assert.deepEqual([by("$62.1B").value, by("$62.1B").unit, by("$62.1B").scaled, by("$62.1B").signed], [62.1e9, "amount", true, false]);
  assert.ok(Math.abs(by("$62.1B").step - 1e8) < 1);
  assert.deepEqual([by("$57,006 million").value, by("$57,006 million").step], [57_006e6, 1e6]);
  assert.deepEqual([by("-$134.0M").value, by("-$134.0M").signed], [-134e6, true]);
  assert.deepEqual([by("($134M)").value, by("($134M)").signed], [-134e6, true]);
  assert.deepEqual([by("10.84%").value, by("10.84%").signed, by("10.84%").unit], [10.84, false, "percent"], "a parenthesized percentage is an aside, not a negative");
  assert.deepEqual([by("12.5 points").unit, by("−1,250 bps").unit, by("−1,250 bps").value, by("3.2x").unit], ["points", "bps", -1250, "multiple"]);
  assert.equal(by("2026-01-25").unit, "date");
  assert.equal(found.filter((n) => n.text === "2026").every((n) => !n.signed), true, "a range dash isn't a minus sign");
  assert.deepEqual([by("74.40%").step, by("$178.40").step], [0.01, 0.01]);
  assert.equal(by("1,010,000").step, 10_000, "a whole number's trailing zeros aren't significant");
  assert.match(markNumerals(text, found), /^NVDA's revenue was \*\*⟦n1:\$62\.1B⟧\*\* in Q⟦n2:4⟧ FY⟦n3:2026⟧ \(ended ⟦n4:2026-01-25⟧\)/u);
});

test("a figure matches the data at the precision it shows", () => {
  assert.equal(withinPrecision(62.1e9, 62.149e9, 1e8), true);
  assert.equal(withinPrecision(62.1e9, 62.151e9, 1e8), false);
  // A brief value rounded to cents sits exactly half a cent from the data.
  const close = goldenDailyBars(GOLDEN_COMPANIES[0]!)[0]!.close;
  assert.equal(withinPrecision(Number(close.toFixed(2)), close, 0.01), true);
  const revenue = ref("NVDA", "revenue", 2026, "Q4");
  assert.deepEqual(check("$62.1B", reported("n1", revenue)), { verdict: "matched" });
  assert.deepEqual(check("$62,100 million", reported("n1", revenue)), { verdict: "matched" });
  assert.deepEqual(check("$62.2B", reported("n1", revenue)), { verdict: "wrong", expected: 62_100e6 });
  assert.deepEqual(check("$60B", reported("n1", revenue)), { verdict: "matched" }, "a round number is read at its last significant digit");
  assert.deepEqual(check("62,100", reported("n1", revenue, { scale: "millions" })), { verdict: "matched" }, "a table in $ millions");
  assert.equal(check("62,100", reported("n1", revenue)).verdict, "wrong");
  assert.deepEqual(check("$178.40", reported("n1", ref("NVDA", "quote_price", null, null))), { verdict: "matched" });
  const last = goldenDailyBars(GOLDEN_COMPANIES[2]!).at(-1)!;
  assert.deepEqual(check(`$${last.close.toFixed(2)}`, reported("n1", ref("AAPL", "bar_close", null, null, { date: last.ts.slice(0, 10) }))), { verdict: "matched" });
  assert.deepEqual(check("$55.2B", reported("n1", ref("NVDA", "segment_revenue", 2026, "Q4", { segment: "Data Center" }))), { verdict: "matched" });
  assert.deepEqual(check("$800 million", reported("n1", ref("AMD", "filed_claim", 2025, "Q2"))), { verdict: "matched" });
  assert.equal(check("$900 million", reported("n1", ref("AMD", "filed_claim", 2025, "Q2"))).verdict, "wrong");
});

test("a sign comes from the text, then from its words; with neither only the size counts", () => {
  const loss = ref("AMD", "operating_income", 2025, "Q2");
  assert.deepEqual(check("-$134.0M", reported("n1", loss)), { verdict: "matched" });
  assert.deepEqual(check("$134M", reported("n1", loss, { sign: "-" })), { verdict: "matched" }, "an operating loss of $134M");
  assert.deepEqual(check("$134M", reported("n1", loss)), { verdict: "matched" });
  assert.equal(check("$134M", reported("n1", loss, { sign: "+" })).verdict, "wrong", "operating income rose to $134M");
  assert.equal(check("$134M", reported("n1", ref("AMD", "net_income", 2025, "Q2"), { sign: "-" })).verdict, "wrong");
});

test("each derivation is recomputed from its operands", () => {
  const nvda = (metric: DataRef["metric"], year: number, period: DataRef["fiscal_period"]) => ref("NVDA", metric, year, period);
  const margin = (year: number, period: DataRef["fiscal_period"]) => of(nvda("gross_profit", year, period), nvda("revenue", year, period));
  // 46,200 / 62,100 = 74.396%
  assert.deepEqual(check("74.4%", derived("n1", "margin", [of(nvda("gross_profit", 2026, "Q4")), of(nvda("revenue", 2026, "Q4"))])), { verdict: "derived_ok" });
  assert.equal(check("74.5%", derived("n1", "margin", [of(nvda("gross_profit", 2026, "Q4")), of(nvda("revenue", 2026, "Q4"))])).verdict, "wrong");
  assert.deepEqual(check("74.4", derived("n1", "margin", [of(nvda("gross_profit", 2026, "Q4")), of(nvda("revenue", 2026, "Q4"))])), { verdict: "derived_ok" }, "a table cell in percent");
  // (62,100 - 57,006) / 57,006 = 8.936%
  assert.deepEqual(check("8.9%", derived("n1", "growth", [of(nvda("revenue", 2026, "Q3")), of(nvda("revenue", 2026, "Q4"))], { sign: "+" })), { verdict: "derived_ok" });
  assert.equal(check("8.9%", derived("n1", "growth", [of(nvda("revenue", 2026, "Q3")), of(nvda("revenue", 2026, "Q4"))], { sign: "-" })).verdict, "wrong");
  // 62,100 - 57,006 = 5,094
  assert.deepEqual(check("$5.1B", derived("n1", "difference", [of(nvda("revenue", 2026, "Q4")), of(nvda("revenue", 2026, "Q3"))])), { verdict: "derived_ok" });
  // 60.524% - 73.029% = -12.505 points
  const fell = [margin(2026, "Q1"), margin(2025, "Q4")];
  assert.deepEqual(check("12.5 points", derived("n1", "difference", fell, { sign: "-" })), { verdict: "derived_ok" });
  assert.deepEqual(check("−1,250 bps", derived("n1", "difference", fell)), { verdict: "derived_ok" });
  assert.equal(check("13.5 points", derived("n1", "difference", fell)).verdict, "wrong");
  // 209,911 / 34,669 = 6.055x
  const scale = [of(nvda("revenue", 2026, "FY")), of(ref("AMD", "revenue", 2025, "FY"))];
  assert.deepEqual(check("6.1x", derived("n1", "ratio", scale)), { verdict: "derived_ok" });
  assert.equal(check("6.0x", derived("n1", "ratio", scale)).verdict, "wrong");
  // 55,200 / 62,100 = 88.889%
  assert.deepEqual(check("88.9%", derived("n1", "share_of_total", [of(ref("NVDA", "segment_revenue", 2026, "Q4", { segment: "Data Center" })), of(nvda("revenue", 2026, "Q4"))])), { verdict: "derived_ok" });
  assert.equal(derive("difference", [margin(2026, "Q1"), of(nvda("revenue", 2026, "Q1"))]), "a difference between a ratio and an amount");
  assert.equal(derive("growth", [of(nvda("revenue", 2026, "Q4"))]), "growth needs two operands, got 1");
});

test("anything the data can't settle is not checkable, with its reason", () => {
  assert.deepEqual(verdictFor(numeral("$2.1B"), undefined), { verdict: "not_checkable", reason: "the labeller skipped it" });
  assert.equal(check("$2.1B", reported("n1", null, { metric: "free cash flow" })).reason, "free cash flow (p) isn't in the data");
  assert.equal(check("$6.8B", reported("n1", ref("AMD", "revenue", 2024, "Q1"))).reason, "its source isn't in the data", "a quarter that isn't seeded");
  assert.equal(check("$2.1B", derived("n1", "growth", [of(ref("AMD", "revenue", 2024, "Q1")), of(ref("AMD", "revenue", 2025, "Q1"))])).reason, "an operand isn't in the data");
  assert.equal(check("74.4%", reported("n1", ref("NVDA", "gross_profit", 2026, "Q4"))).verdict, "not_checkable", "a margin labelled as a reported amount");
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
  assert.deepEqual(file.totals, { figures: 3, matched: 1, derived_ok: 0, wrong: 1, not_checkable: 1 });
  const [turn] = file.turns;
  assert.deepEqual(turn!.numerals.map((n) => [n.text, n.verdict]), [["4", null], ["2026", null], ["$62.1B", "matched"], ["75.1%", "wrong"], ["$30B", "not_checkable"]]);
  assert.equal(turn!.numerals[4]!.reason, "the labeller skipped it");
  const lines = summaryLines(file);
  assert.equal(lines[0], "2026-11-25T000000: figures 3, matched 1, derived_ok 0, wrong 1, not_checkable 1");
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
  assert.deepEqual(failed.totals, { figures: 1, matched: 0, derived_ok: 0, wrong: 0, not_checkable: 1 });
  assert.equal(failed.turns[0]!.labeller.error, "unreadable labels (stop reason max_tokens)");
  assert.match(summaryLines(failed)[0]!, /\(1 turns not labelled\)$/u);
});

test("a wrong figure's sentence is the one it sits in", () => {
  const body = "Revenue rose. Margin was 75.1% in Q4 FY2026, up from 73.0%.\n| x | 4.2 |";
  assert.equal(sentenceAt(body, body.indexOf("75.1"), body.indexOf("75.1") + 5), "Margin was 75.1% in Q4 FY2026, up from 73.0%.");
  assert.equal(sentenceAt(body, body.indexOf("4.2"), body.indexOf("4.2") + 3), "| x | 4.2 |");
});
