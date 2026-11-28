import assert from "node:assert/strict";
import test from "node:test";

import {
  derive,
  enumerateNumerals,
  verdictFor,
  withinPrecision,
  type Derivation,
  type FigureLabel,
  type Operand,
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

const of = (value: string, over: string | null = null): Operand<string> => ({ value, over });
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
const wrong = (value: number, lastDigit = false) => ({ kind: "wrong", expected: { kind: "amount", value }, lastDigit });

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
  assert.deepEqual(check("$62.2B", reported(revenue)), wrong(62_100e6, true), "one unit of the last digit off");
  assert.deepEqual(check("$62.3B", reported(revenue)), wrong(62_100e6), "two units off is a misstatement");
  assert.deepEqual(check("$60B", reported(revenue)), { kind: "matched" }, "a round number is read at its last significant digit");
  assert.deepEqual(check("62,100", reported(revenue, { scale: "millions" })), { kind: "matched" }, "a table in $ millions");
  assert.equal(check("62,100", reported(revenue)).kind, "wrong");
  assert.deepEqual(check("$178.40", reported("NVDA price")), { kind: "matched" });
  assert.deepEqual(check("$55.2B", reported("NVDA Data Center revenue Q4 FY2026")), { kind: "matched" });
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
  assert.equal(check("74.5%", derived("margin", q4)).kind, "wrong");
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
  assert.equal(check("6.0x", derived("ratio", scale)).kind, "wrong");
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
