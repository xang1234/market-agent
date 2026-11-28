import assert from "node:assert/strict";
import test from "node:test";

import {
  atPrecisionOf,
  derive,
  enumerateNumerals,
  linkedVerdict,
  presentedQuantity,
  statedFigures,
  statedQuantity,
  verdictFor,
  withinPrecision,
  writtenAs,
  type Derivation,
  type FigureLabel,
  type Operand,
  type Quantity,
  type ValueOf,
} from "../src/figure-check.ts";

// Values as the golden dataset holds them (services/chat/test/golden/dataset.ts), by a
// pointer that is just their name.
const DATA: Readonly<Record<string, number>> = {
  "NVDA revenue Q4 FY2026": 62_100e6,
  "NVDA revenue Q3 FY2026": 57_006e6,
  "NVDA gross profit Q4 FY2026": 46_200e6,
  "NVDA revenue Q1 FY2026": 44_062e6,
  "NVDA gross profit Q1 FY2026": 26_668e6,
  "NVDA revenue Q2 FY2026": 46_743e6,
  "NVDA gross profit Q2 FY2026": 33_853e6,
  "NVDA gross profit Q3 FY2026": 41_849e6,
  "NVDA operating income Q4 FY2026": 40_300e6,
  "NVDA revenue Q4 FY2025": 39_331e6,
  "NVDA gross profit Q4 FY2025": 28_723e6,
  "NVDA revenue FY2026": 209_911e6,
  "NVDA Data Center revenue Q4 FY2026": 55_200e6,
  "NVDA price": 178.4,
  "AMD revenue FY2025": 34_669e6,
  "AMD revenue Q1 FY2025": 7_438e6,
  "AMD revenue Q2 FY2025": 7_685e6,
  "AMD operating income Q2 FY2025": -134e6,
  "AMD net income Q2 FY2025": 872e6,
};
const valueOf: ValueOf<string> = (ref) => (ref in DATA ? { kind: "amount", value: DATA[ref]! } : undefined);

const of = (value: string, over: string | null = null): Operand<string> => ({ add: [value], subtract: [], over: over === null ? null : [over] });
const total = (add: string[], subtract: string[] = [], over: string[] | null = null): Operand<string> => ({ add, subtract, over });
const reported = (source: string, extra: Partial<Pick<FigureLabel<string> & { basis: "reported" }, "sign" | "scale">> = {}): FigureLabel<string> =>
  ({ basis: "reported", source, sign: null, scale: null, ...extra });
const derived = (derivation: Derivation, operands: Operand<string>[], extra: Partial<Pick<FigureLabel<string> & { basis: "derived" }, "sign" | "scale">> = {}) =>
  ({ basis: "derived", derivation, operands, sign: null, scale: null, ...extra }) as const;
// One numeral, as the enumerator reads it.
const numeral = (text: string) => {
  const [found] = enumerateNumerals(text);
  assert.equal(found?.text, text, `${text} reads as one numeral`);
  return found!;
};
const check = (text: string, label: FigureLabel<string>) => verdictFor(numeral(text), label, valueOf);
const amount = (value: number) => ({ kind: "amount", value }) as const;

test("every numeral is found with its span, value, precision, unit and sign", () => {
  const text = "NVDA's revenue was **$62.1B** in Q4 FY2026 (ended 2026-01-25), up 9% from $57,006 million; operating income of -$134.0M; "
    + "margin fell 12.5 points (−1,250 bps); 3.2x; ($134M) and (10.84%); as of 2026-09-01T00:00:00.000Z; 74.40%; 1,010,000 shares at $178.40. Q3 FY2024–Q2 FY2026.";
  const found = enumerateNumerals(text);
  assert.deepEqual(found.map((n) => n.text), [
    "$62.1B", "4", "2026", "2026-01-25", "9%", "$57,006 million", "-$134.0M", "12.5 points", "−1,250 bps", "3.2x", "$134M", "10.84%",
    "2026-09-01T00:00:00.000Z", "74.40%", "1,010,000", "$178.40", "3", "2024", "2", "2026",
  ]);
  assert.deepEqual(found.slice(0, 3).map((n) => n.id), ["n1", "n2", "n3"]);
  for (const n of found) assert.equal(text.slice(n.start, n.end), n.text);
  const by = (t: string) => found.find((n) => n.text === t)!;
  assert.deepEqual([by("$62.1B").value, by("$62.1B").unit, by("$62.1B").scaled, by("$62.1B").signed], [62.1e9, "amount", true, false]);
  assert.ok(Math.abs(by("$62.1B").step - 1e8) < 1);
  assert.deepEqual([by("$57,006 million").value, by("$57,006 million").step], [57_006e6, 1e6]);
  assert.deepEqual([by("-$134.0M").value, by("-$134.0M").signed], [-134e6, true]);
  assert.deepEqual([by("$134M").value, by("$134M").signed, by("10.84%").signed], [134e6, false, false], "parentheses hold an aside, not a negative");
  assert.deepEqual([by("12.5 points").unit, by("−1,250 bps").unit, by("−1,250 bps").value, by("3.2x").unit], ["points", "bps", -1250, "multiple"]);
  assert.equal(by("2026-01-25").unit, "date");
  assert.equal(found.filter((n) => n.text === "2026").every((n) => !n.signed), true, "a range dash isn't a minus sign");
  assert.deepEqual([by("74.40%").step, by("$178.40").step], [0.01, 0.01]);
  assert.equal(by("1,010,000").step, 10_000, "a whole number's trailing zeros aren't significant");
  assert.deepEqual([by("1,010,000").place, by("74.40%").place, by("$62.1B").place], [1, 0.01, by("$62.1B").step], "its last digit as written, trailing zeros counted");
});

test("a figure matches the data at the precision it shows", () => {
  assert.equal(withinPrecision(62.1e9, 62.149e9, 1e8), true);
  assert.equal(withinPrecision(62.1e9, 62.151e9, 1e8), false);
  // A brief value rounded to cents sits exactly half a cent from the data: NVDA's first
  // golden daily close.
  const close = 167.35165816326528;
  assert.equal(withinPrecision(Number(close.toFixed(2)), close, 0.01), true);
  const revenue = "NVDA revenue Q4 FY2026";
  assert.deepEqual(check("$62.1B", reported(revenue)), { kind: "matched" });
  assert.deepEqual(check("$62,100 million", reported(revenue)), { kind: "matched" });
  assert.deepEqual(check("$62.2B", reported(revenue)), { kind: "near", expected: amount(62_100e6) }, "one unit of the last digit off is near");
  assert.deepEqual(check("$62.3B", reported(revenue)), { kind: "wrong", expected: amount(62_100e6) }, "two units off is a misstatement");
  assert.deepEqual(check("$60B", reported(revenue)), { kind: "matched" }, "a round number is read at its last significant digit");
  assert.deepEqual(check("62,100", reported(revenue, { scale: "millions" })), { kind: "matched" }, "a table in $ millions");
  assert.equal(check("62,100", reported(revenue)).kind, "wrong");
  assert.deepEqual(check("$178.40", reported("NVDA price")), { kind: "matched" });
  assert.deepEqual(check("$55.2B", reported("NVDA Data Center revenue Q4 FY2026")), { kind: "matched" });
});

// #816: "$100B" matched 62.1B at its last nonzero digit, and "$200B" was near it.
test("a round figure matches at its last nonzero digit only within a tenth of the data, and is near only one and a half units of its last digit as written", () => {
  const revenue = reported("NVDA revenue Q4 FY2026");
  assert.deepEqual(check("$60B", revenue), { kind: "matched" });
  assert.deepEqual(check("$200B", reported("NVDA revenue FY2026")), { kind: "matched" }, "209.9B to its last nonzero digit, within a tenth");
  for (const text of ["$100B", "$70B", "$200B"]) assert.deepEqual(check(text, revenue), { kind: "wrong", expected: amount(62_100e6) }, text);
  assert.deepEqual(check("$62.2B", revenue), { kind: "near", expected: amount(62_100e6) }, "a last-digit slip stays near");
  const value = (quantity: Quantity) => () => quantity;
  assert.equal(verdictFor(numeral("$100B"), reported("r"), value(amount(1e9))).kind, "wrong");
  assert.equal(verdictFor(numeral("100%"), reported("r"), value({ kind: "fraction", value: 0.01 })).kind, "wrong");
  assert.equal(verdictFor(numeral("200%"), reported("r"), value({ kind: "fraction", value: 1.4 })).kind, "wrong", "200% growth for 140%");
  assert.equal(verdictFor(numeral("10%"), reported("r"), value({ kind: "fraction", value: 0.08936 })).kind, "near", "12% off, one and a half units of its last digit");
  assert.deepEqual(verdictFor(numeral("0%"), reported("r"), value({ kind: "fraction", value: 0.004 })), { kind: "matched" }, "never narrower than its last digit as written");
  // ponytail: a bound is read as its figure, so "over $100B" for $140B is wrong.
  assert.equal(verdictFor(enumerateNumerals("over $100B")[0]!, reported("r"), value(amount(140e9))).kind, "wrong");
});

test("a sign comes from the text, then from its words; with neither only the size counts", () => {
  const loss = "AMD operating income Q2 FY2025";
  assert.deepEqual(check("-$134.0M", reported(loss)), { kind: "matched" });
  assert.deepEqual(check("$134M", reported(loss, { sign: "-" })), { kind: "matched" }, "an operating loss of $134M");
  assert.deepEqual(check("$134M", reported(loss)), { kind: "matched" });
  assert.equal(check("$134M", reported(loss, { sign: "+" })).kind, "wrong", "operating income rose to $134M");
  assert.equal(check("$134M", reported("AMD net income Q2 FY2025", { sign: "-" })).kind, "wrong");
  const nvda = [of("NVDA gross profit Q1 FY2026"), of("NVDA revenue Q1 FY2026")];
  assert.deepEqual(check("60.5%", derived("margin", nvda, { sign: "-" })), { kind: "derived_ok" }, "gross margin fell to 60.5%: a level keeps its own sign");
  assert.equal(check("-60.5%", derived("margin", nvda)).kind, "wrong", "the text's own minus sign still counts");
  const amd = [of(loss), of("AMD revenue Q2 FY2025")];
  assert.deepEqual([numeral("+1.7%").value, numeral("+1.7%").signed], [1.7, true]);
  assert.equal(check("+1.7%", derived("margin", amd, { sign: "+" })).kind, "wrong", "a written plus sign on a negative margin");
  assert.deepEqual(check("-1.7%", derived("margin", amd)), { kind: "derived_ok" });
});

test("each derivation is recomputed from its operands", () => {
  const margin = (quarter: string) => of(`NVDA gross profit ${quarter}`, `NVDA revenue ${quarter}`);
  const q4 = [of("NVDA gross profit Q4 FY2026"), of("NVDA revenue Q4 FY2026")];
  // 46,200 / 62,100 = 74.396%
  assert.deepEqual(check("74.4%", derived("margin", q4)), { kind: "derived_ok" });
  assert.equal(check("74.5%", derived("margin", q4)).kind, "near", "one unit of the last digit off");
  assert.equal(check("74.6%", derived("margin", q4)).kind, "wrong");
  assert.deepEqual(check("74.4", derived("margin", q4)), { kind: "derived_ok" }, "a table cell in percent");
  // (62,100 - 57,006) / 57,006 = 8.936%
  const growth = [of("NVDA revenue Q3 FY2026"), of("NVDA revenue Q4 FY2026")];
  assert.deepEqual(check("8.9%", derived("growth", growth, { sign: "+" })), { kind: "derived_ok" });
  assert.equal(check("8.9%", derived("growth", growth, { sign: "-" })).kind, "wrong");
  // 62,100 - 57,006 = 5,094
  assert.deepEqual(check("$5.1B", derived("difference", [...growth].reverse())), { kind: "derived_ok" });
  // 60.524% - 73.029% = -12.505 points
  const fell = [margin("Q1 FY2026"), margin("Q4 FY2025")];
  assert.deepEqual(check("12.5 points", derived("difference", fell, { sign: "-" })), { kind: "derived_ok" });
  assert.deepEqual(check("−1,250 bps", derived("difference", fell)), { kind: "derived_ok" });
  assert.equal(check("13.5 points", derived("difference", fell)).kind, "wrong");
  // "AMD's gross margin is 12.5 points lower": the operands come in either order.
  assert.deepEqual(check("12.5 points", derived("difference", [...fell].reverse(), { sign: "-" })), { kind: "derived_ok" });
  // 209,911 / 34,669 = 6.055x
  const scale = [of("NVDA revenue FY2026"), of("AMD revenue FY2025")];
  assert.deepEqual(check("6.1x", derived("ratio", scale)), { kind: "derived_ok" });
  assert.equal(check("6.0x", derived("ratio", scale)).kind, "near");
  assert.equal(check("5.9x", derived("ratio", scale)).kind, "wrong");
  // 55,200 / 62,100 = 88.889%
  assert.deepEqual(check("88.9%", derived("share_of_total", [of("NVDA Data Center revenue Q4 FY2026"), of("NVDA revenue Q4 FY2026")])), { kind: "derived_ok" });
  assert.equal(derive(derived("difference", [margin("Q1 FY2026"), of("NVDA revenue Q1 FY2026")]), valueOf), "a difference between a ratio and an amount");
  assert.equal(derive(derived("growth", [of("NVDA revenue Q4 FY2026")]), valueOf), "growth needs two operands, got 1");
});

test("anything the data can't settle is not checkable, with its reason", () => {
  assert.deepEqual(check("$2.1B", { basis: "off_file", what: "free cash flow (p)" }), { kind: "not_checkable", reason: "free cash flow (p) isn't in the data" });
  assert.deepEqual(check("$6.8B", reported("AMD revenue Q1 FY2024")), { kind: "not_checkable", reason: "its source isn't in the data" }, "a quarter that isn't seeded");
  assert.deepEqual(check("$2.1B", derived("growth", [of("AMD revenue Q1 FY2024"), of("AMD revenue Q1 FY2025")])), { kind: "not_checkable", reason: "an operand isn't in the data" });
  assert.deepEqual(check("74.4%", reported("NVDA gross profit Q4 FY2026")), { kind: "not_checkable", reason: "a reported amount shown as percent" }, "a margin labelled as a reported amount");
  assert.deepEqual(check("2026-01-25", reported("NVDA revenue Q4 FY2026")), { kind: "not_checkable", reason: "a date labelled as a figure" });
});

const QUARTERS = ["Q1", "Q2", "Q3", "Q4"].map((quarter) => `${quarter} FY2026`);
const each = (metric: string) => QUARTERS.map((quarter) => `NVDA ${metric} ${quarter}`);

test("a sum adds its operands, and an operand adds and subtracts values", () => {
  // 44,062 + 46,743 + 57,006 + 62,100 = 209,911: a trailing four-quarter total.
  assert.deepEqual(check("$209.9B", derived("sum", [total(each("revenue"))])), { kind: "derived_ok" });
  assert.equal(check("$219.9B", derived("sum", [total(each("revenue"))])).kind, "wrong");
  assert.deepEqual(check("$209.9B", derived("sum", each("revenue").map((quarter) => of(quarter)))), { kind: "derived_ok" }, "one operand per quarter");
  // Operating expenses: 46,200 - 40,300 = 5,900.
  assert.deepEqual(check("$5.9B", derived("sum", [total(["NVDA gross profit Q4 FY2026"], ["NVDA operating income Q4 FY2026"])])), { kind: "derived_ok" });
  // 148,570 / 209,911 = 70.778%: a trailing four-quarter margin, as two sums or as one over the other.
  assert.deepEqual(check("70.8%", derived("margin", [total(each("gross profit")), total(each("revenue"))])), { kind: "derived_ok" });
  assert.deepEqual(check("70.8%", derived("margin", [total(each("gross profit"), [], each("revenue"))])), { kind: "derived_ok" });
  assert.equal(derive(derived("sum", []), valueOf), "sum needs an operand");
  assert.equal(derive(derived("sum", [of("NVDA revenue Q4 FY2026"), of("NVDA gross profit Q4 FY2026", "NVDA revenue Q4 FY2026")]), valueOf), "a sum of ratios and amounts");
  assert.equal(derive(derived("sum", [total(["NVDA revenue Q4 FY2026", "AMD revenue Q1 FY2024"])]), valueOf), "an operand isn't in the data");
  // over [] names a denominator with no value in it; only over null skips division.
  assert.deepEqual(check("$62.1B", derived("sum", [total(["NVDA revenue Q4 FY2026"], [], [])])), { kind: "not_checkable", reason: "it divides by zero" });
  assert.equal(check("74.4%", derived("margin", [total(["NVDA gross profit Q4 FY2026"], [], []), of("NVDA revenue Q4 FY2026")])).kind, "not_checkable");
});

test("a hedged figure is near within one and a half units of its last digit, and wrong further off", () => {
  const found = enumerateNumerals("about $62.1B, roughly 75%, ~9%, nearly 41%, ≈ $5B, approximately 6x, almost 3, around 2026 and $62.1B; up 9% about.");
  assert.deepEqual(found.map((n) => [n.text, n.hedged]), [
    ["$62.1B", true], ["75%", true], ["9%", true], ["41%", true], ["$5B", true], ["6x", true], ["3", true], ["2026", true], ["$62.1B", false], ["9%", false],
  ]);
  const revenue = reported("NVDA revenue Q4 FY2026");
  const hedged = (text: string) => verdictFor(enumerateNumerals(`about ${text}`)[0]!, revenue, valueOf);
  assert.deepEqual(hedged("$62.1B"), { kind: "near", expected: amount(62_100e6) }, "a hedged figure never claims the exact value");
  assert.deepEqual(hedged("$62.2B"), { kind: "near", expected: amount(62_100e6) });
  assert.deepEqual(hedged("$62.3B"), { kind: "wrong", expected: amount(62_100e6) }, "two units off is wrong, hedged or not");
  assert.deepEqual(check("$62.1B", revenue), { kind: "matched" });
  assert.deepEqual(hedged("$60B"), { kind: "near", expected: amount(62_100e6) }, "a hedged round figure that would match is near");
  assert.deepEqual(hedged("$100B"), { kind: "wrong", expected: amount(62_100e6) });
});

test("the data's value is written at the precision and in the form the figure used", () => {
  const at = (text: string, expected: Parameters<typeof atPrecisionOf>[1], label?: Parameters<typeof atPrecisionOf>[2]) => atPrecisionOf(numeral(text), expected, label);
  assert.equal(at("41%", { kind: "fraction", value: 0.3445 }), "34%", "not 34.45%");
  assert.equal(at("0.41", { kind: "fraction", value: 0.3445 }), "0.34", "a bare fraction keeps its scale");
  assert.equal(at("41", { kind: "fraction", value: 0.3445 }), "34", "a bare percent keeps its own");
  assert.equal(at("41", { kind: "fraction", value: -0.3445 }), "34", "by size, whatever the sign");
  assert.equal(at("$13.9B", amount(12_934e6)), "$12.9B");
  assert.equal(at("$57,006 million", amount(62_100e6)), "$62,100 million");
  assert.equal(at("6.0x", { kind: "ratio", value: 6.0547 }), "6.1x");
  assert.equal(at("13.5 points", { kind: "fraction", value: -0.12505 }), "12.5 points", "an unsigned figure gives the size; its words carry the sign");
  assert.equal(at("−1,350 bps", { kind: "fraction", value: -0.12505 }), "−1,250 bps");
  assert.equal(at("-$134.0M", amount(666e6)), "$666.0M");
  assert.equal(at("+1.7%", { kind: "fraction", value: -0.01744 }), "-1.7%");
  assert.equal(at("62,500", amount(62_100e6), reported("r", { scale: "millions" })), "62,100", "a table in $ millions");
  assert.equal(at("$60B", amount(74_396e6)), "$70B", "a round figure's data is rounded the same way");
  assert.equal(at("$100B", amount(62_100e6)), "$62B", "unless that is more than a tenth off: then at its last digit as written");
  assert.equal(at("200%", { kind: "fraction", value: 1.4 }), "140%");
});

// #817: "Revenue fell 58%" against +58% was told "they give 58%".
test("a correction names the data's sign when it turns the sign the figure's words give", () => {
  const rose = [of("NVDA revenue Q4 FY2025"), of("NVDA revenue Q4 FY2026")];
  const corrected = (text: string, label: FigureLabel<string>) => {
    const verdict = check(text, label);
    assert.equal(verdict.kind, "wrong", text);
    return atPrecisionOf(numeral(text), (verdict as { expected: Quantity }).expected, label);
  };
  assert.equal(corrected("58%", derived("growth", rose, { sign: "-" })), "+58%", "revenue fell 58%");
  assert.equal(corrected("40%", derived("growth", rose, { sign: "-" })), "+60%", "revenue fell 40%, rounded as the figure is");
  assert.equal(corrected("$134M", reported("AMD operating income Q2 FY2025", { sign: "+" })), "-$134M", "operating profit was $134M");
  assert.equal(corrected("45%", derived("growth", [...rose].reverse(), { sign: "-" })), "37%", "revenue fell 45%: its words have the sign right");
  const q1 = [of("NVDA gross profit Q1 FY2026"), of("NVDA revenue Q1 FY2026")];
  assert.equal(corrected("50.5%", derived("margin", q1, { sign: "-" })), "60.5%", "gross margin fell to 50.5%: a level has no sign");
});

test("a text's figures are its numerals but dates and the digits of a name", () => {
  const text = "Our MI308 GPUs in Q2 FY2025 (ended 2025-06-28) led to approximately $800 million in charges, 10.4% of revenue.";
  assert.deepEqual(statedFigures(text).map((figure) => figure.text), ["$800 million", "10.4%"]);
});

test("a numeral states the quantity writtenAs would write it as", () => {
  const stated = (text: string) => statedQuantity(numeral(text));
  assert.deepEqual(stated("$800 million"), amount(800e6));
  assert.deepEqual(stated("-$134.0M"), amount(-134e6));
  assert.deepEqual(stated("12.5%"), { kind: "fraction", value: 0.125 });
  assert.deepEqual(stated("3.1 points"), { kind: "points", value: 0.031 }, "a change in points (#812)");
  assert.deepEqual(stated("120 bps"), { kind: "fraction", value: 0.012 });
  assert.deepEqual(stated("6.1x"), { kind: "ratio", value: 6.1 });
  assert.equal(stated("2026-01-25"), undefined, "a date states no quantity");
  for (const text of ["$800 million", "12.5%", "120 bps", "6.1x"]) {
    assert.ok(withinPrecision(numeral(text).value, writtenAs(stated(text)!, numeral(text).unit)[0]!, 1e-9), text);
  }
});

// Devin on #812: a linked difference took "+3.3 percentage points" for operands that
// subtract to -3.3, and "3.3%" for a change between 38.7% and 35.4%.
test("a difference honours its text's own sign, and leaves its words to the relation check", () => {
  const fell = [of("NVDA gross profit Q1 FY2026", "NVDA revenue Q1 FY2026"), of("NVDA gross profit Q4 FY2025", "NVDA revenue Q4 FY2025")];
  assert.equal(check("+12.5 points", derived("difference", fell)).kind, "wrong", "60.5% less 73.0% is -12.5 points");
  assert.deepEqual(check("-12.5 points", derived("difference", fell)), { kind: "derived_ok" });
  assert.deepEqual(check("12.5 points", derived("difference", fell, { sign: "+" })), { kind: "derived_ok" }, "\"rose 12.5 points\" is the relation check's to judge");
  const margins = [{ kind: "fraction", value: 0.387 }, { kind: "fraction", value: 0.354 }] as const;
  const change = (text: string, order: [number, number]) =>
    linkedVerdict({ text, sources: margins, derivation: "difference", operands: order.map((index) => ({ add: [index], subtract: [], over: null })) }, (index) => margins[index]);
  assert.deepEqual(change("+3.3 percentage points", [0, 1]), { kind: "derived_ok" });
  assert.equal(change("+3.3 percentage points", [1, 0]).kind, "wrong");
});

test("a change between two percents is in points, so a percent there is wrong and its data is written in points", () => {
  const fell = [of("NVDA gross profit Q1 FY2026", "NVDA revenue Q1 FY2026"), of("NVDA gross profit Q4 FY2025", "NVDA revenue Q4 FY2025")];
  const expected = derive(derived("difference", fell), valueOf);
  assert.equal(typeof expected === "object" && expected.kind, "points");
  assert.deepEqual(check("12.5%", derived("difference", fell)), { kind: "wrong", expected });
  assert.deepEqual(verdictFor(enumerateNumerals("about 12%")[0]!, derived("difference", fell), valueOf), { kind: "wrong", expected }, "hedged or not");
  assert.deepEqual(check("12.5 percentage points", derived("difference", fell)), { kind: "derived_ok" });
  assert.deepEqual(check("1,250 bps", derived("difference", fell)), { kind: "derived_ok" });
  assert.equal(atPrecisionOf(numeral("12.5%"), expected as Quantity), "12.5 percentage points");
  assert.equal(atPrecisionOf(numeral("-12.5 percent"), expected as Quantity), "-12.5 percentage points");
  const margins = [{ kind: "fraction", value: 0.387 }, { kind: "fraction", value: 0.354 }] as const;
  const linked = linkedVerdict({ text: "3.3%", sources: margins, derivation: "difference", operands: [0, 1].map((index) => ({ add: [index], subtract: [], over: null })) }, (index) => margins[index]);
  assert.equal(linked.kind, "wrong");
  assert.deepEqual(check("8.9%", derived("growth", [of("NVDA revenue Q3 FY2026"), of("NVDA revenue Q4 FY2026")])), { kind: "derived_ok" }, "growth stays a percent");
  // 46,200 / 62,100 less 40,300 / 62,100 = 9.5% of revenue, as 21 saved eval runs label it.
  const costs = [of("NVDA gross profit Q4 FY2026", "NVDA revenue Q4 FY2026"), of("NVDA operating income Q4 FY2026", "NVDA revenue Q4 FY2026")];
  assert.deepEqual(check("9.5%", derived("difference", costs)), { kind: "derived_ok" }, "two shares of one total differ by a share of it");
});

test("an engine result in percentage points and a claim's points are points too", () => {
  const points = presentedQuantity({ kind: "value", text: "+3.3 pts", unit: { kind: "percentage_points" }, exact: true, value: "3.3", full_text: "3.3 percentage points" } as Parameters<typeof presentedQuantity>[0]);
  assert.deepEqual(points, { kind: "points", value: 0.033 });
  assert.deepEqual(verdictFor(numeral("3.3%"), { basis: "reported", source: "r", sign: null, scale: null }, () => points), { kind: "wrong", expected: points });
  assert.deepEqual(verdictFor(numeral("3.3 points"), { basis: "reported", source: "r", sign: null, scale: null }, () => points), { kind: "matched" });
  assert.deepEqual(statedQuantity(numeral("3.1 points")), { kind: "points", value: 0.031 });
});
