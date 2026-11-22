import test from "node:test";
import assert from "node:assert/strict";

import { canonicalText } from "../src/canonical-text.ts";
import { readFigure } from "../src/release-figures.ts";

const NVDA_REVENUE = "Revenue is expected to be $45.0 billion, plus or minus 2%.";
const NVDA_MARGINS = "GAAP and non-GAAP gross margins are expected to be 71.8% and 72.0%, respectively, plus or minus 50 basis points.";
const AMD_REVENUE = "For the third quarter of 2025, AMD expects revenue to be approximately $8.7 billion, plus or minus $300 million.";
const AMD_MARGIN = "Non-GAAP gross margin is expected to be approximately 54%.";

const guidance = (metric: Parameters<typeof readFigure>[0]["metric"], quote: string) => ({ kind: "guidance" as const, metric, quote });
const result = (metric: Parameters<typeof readFigure>[0]["metric"], quote: string) => ({ kind: "result" as const, metric, quote });

test("a guide's figures are read from the phrases its sentence states: a value plus or minus a share, points or dollars, or a low and a high", () => {
  assert.deepEqual(readFigure(guidance("revenue", NVDA_REVENUE), { basis: "gaap", value: "$45.0 billion", plus_minus: "2%" }), { basis: "gaap", low: 44.1e9, high: 45.9e9 });
  assert.deepEqual(readFigure(guidance("gross_margin", NVDA_MARGINS), { basis: "gaap", value: "71.8%", plus_minus: "50 basis points" }), { basis: "gaap", low: 71.3, high: 72.3 });
  assert.deepEqual(readFigure(guidance("gross_margin", NVDA_MARGINS), { basis: "non_gaap", value: "72.0%", plus_minus: "50 basis points" }), { basis: "non_gaap", low: 71.5, high: 72.5 });
  assert.deepEqual(readFigure(guidance("revenue", AMD_REVENUE), { basis: "gaap", value: "approximately $8.7 billion", plus_minus: "$300 million" }), { basis: "gaap", low: 8.4e9, high: 9.0e9 });
  assert.deepEqual(readFigure(guidance("gross_margin", AMD_MARGIN), { basis: "non_gaap", value: "54%" }), { basis: "non_gaap", low: 54, high: 54 });
  // A low with no scale of its own takes its high's.
  assert.deepEqual(
    readFigure(guidance("capex", "Capital expenditures are expected to be $4.0 to $4.1 billion."), { basis: "gaap", low: "$4.0", high: "$4.1 billion" }),
    { basis: "gaap", low: 4.0e9, high: 4.1e9 },
  );
});

test("a result's figure is its one value, in dollars, dollars a share or percent", () => {
  assert.deepEqual(
    readFigure(result("revenue", "Revenue for the first quarter was $44.1 billion, up 12% from the previous quarter and up 69% from a year ago."), { basis: "gaap", value: "$44.1 billion" }),
    { basis: "gaap", low: 44.1e9, high: 44.1e9 },
  );
  assert.deepEqual(readFigure(result("eps", "Non-GAAP diluted earnings per share were $0.96."), { basis: "non_gaap", value: "$0.96" }), { basis: "non_gaap", low: 0.96, high: 0.96 });
  assert.deepEqual(
    readFigure(result("gross_margin", "GAAP and non-GAAP gross margins were 60.5% and 61.0%, respectively."), { basis: "non_gaap", value: "61.0%" }),
    { basis: "non_gaap", low: 61, high: 61 },
  );
});

test("a parse its sentence does not bear out is sent to review with the reason, never stored as read", () => {
  const reasons = [
    // The basis is the sentence's own.
    readFigure(guidance("revenue", NVDA_REVENUE), { basis: "non_gaap", value: "$45.0 billion", plus_minus: "2%" }),
    readFigure(guidance("gross_margin", AMD_MARGIN), { basis: "gaap", value: "54%" }),
    readFigure(guidance("revenue", NVDA_REVENUE), { basis: "adjusted", value: "$45.0 billion" }),
    // Every phrase is in the sentence, and is one figure.
    readFigure(guidance("revenue", NVDA_REVENUE), { basis: "gaap", value: "$46.0 billion", plus_minus: "2%" }),
    readFigure(guidance("revenue", "Revenue is expected to be between $4 billion and $5 billion."), { basis: "gaap", value: "between $4 billion and $5 billion" }),
    readFigure(guidance("revenue", NVDA_REVENUE), { basis: "gaap" }),
    // A growth rate is no level of revenue; a share of a margin could be points or a share.
    readFigure(guidance("revenue", "Revenue is expected to grow 10%."), { basis: "gaap", value: "10%" }),
    readFigure(guidance("gross_margin", "Gross margin is expected to be 72%, plus or minus 1%."), { basis: "gaap", value: "72%", plus_minus: "1%" }),
    readFigure(guidance("eps", "Diluted EPS is expected to be $1.2 billion."), { basis: "gaap", value: "$1.2 billion" }),
    // A loss would read as a positive figure.
    readFigure(guidance("operating_income", "Operating loss is expected to be approximately $50 million."), { basis: "gaap", value: "$50 million" }),
    readFigure(guidance("revenue", "Revenue is expected to be $5 billion to $4 billion."), { basis: "gaap", low: "$5 billion", high: "$4 billion" }),
    // A result is one value.
    readFigure(result("revenue", "Revenue was $44.1 billion, plus or minus nothing."), { basis: "gaap", low: "$44.1 billion", high: "$44.1 billion" }),
  ];
  for (const read of reasons) assert.ok("review" in read && read.review.length > 0, JSON.stringify(read));
});

const read = (kind: "guidance" | "result", metric: Parameters<typeof readFigure>[0]["metric"], quote: string, raw: Parameters<typeof readFigure>[1]) =>
  readFigure({ kind, metric, quote }, raw);
const reviewed = (figure: ReturnType<typeof readFigure>) => "review" in figure;

test("a minus sign or accounting parentheses make the figure negative; a phrase that leaves the sign out is no figure", () => {
  assert.deepEqual(read("result", "free_cash_flow", "Free cash flow was -$1.2 billion.", { basis: "gaap", value: "-$1.2 billion" }), { basis: "gaap", low: -1.2e9, high: -1.2e9 });
  assert.deepEqual(read("result", "eps", "GAAP diluted EPS was -$0.25.", { basis: "gaap", value: "-$0.25" }), { basis: "gaap", low: -0.25, high: -0.25 });
  assert.deepEqual(read("result", "eps", "GAAP diluted EPS was $(0.25).", { basis: "gaap", value: "$(0.25)" }), { basis: "gaap", low: -0.25, high: -0.25 });
  assert.deepEqual(read("result", "operating_income", "Operating income was ($50 million).", { basis: "gaap", value: "($50 million)" }), { basis: "gaap", low: -5e7, high: -5e7 });
  assert.deepEqual(read("result", "gross_margin", "Gross margin was -2.5%.", { basis: "gaap", value: "-2.5%" }), { basis: "gaap", low: -2.5, high: -2.5 });
  for (const figure of [
    read("result", "free_cash_flow", "Free cash flow was -$1.2 billion.", { basis: "gaap", value: "$1.2 billion" }),
    read("result", "eps", "GAAP diluted EPS was $(0.25).", { basis: "gaap", value: "0.25" }),
    read("result", "operating_income", "Operating income was ($50 million).", { basis: "gaap", value: "$50 million" }),
    read("result", "gross_margin", "Gross margin was -2.5%.", { basis: "gaap", value: "2.5%" }),
    // A cash flow, a margin or an income stated as a positive amount in words.
    read("result", "operating_cash_flow", "Net cash used in operating activities was $500 million.", { basis: "gaap", value: "$500 million" }),
    read("result", "free_cash_flow", "Free cash flow was negative $1.2 billion.", { basis: "gaap", value: "$1.2 billion" }),
    read("result", "net_income", "Net loss was $50 million.", { basis: "gaap", value: "$50 million" }),
    // Revenue, costs and capex are never negative, so a negative one is misread.
    read("result", "revenue", "Revenue was ($7.7 billion).", { basis: "gaap", value: "($7.7 billion)" }),
    read("guidance", "revenue", "Revenue is expected to be $45.0 billion, plus or minus -2%.", { basis: "gaap", value: "$45.0 billion", plus_minus: "-2%" }),
  ]) assert.ok(reviewed(figure), JSON.stringify(figure));
  // A dash between two amounts is a range, not a sign.
  assert.deepEqual(
    read("guidance", "eps", "Non-GAAP diluted EPS is expected to be $1.10-$1.20.", { basis: "non_gaap", low: "$1.10", high: "$1.20" }),
    { basis: "non_gaap", low: 1.1, high: 1.2 },
  );
});

test("a phrase is read only as a whole amount of its sentence, with its scale, never part of a longer number", () => {
  assert.deepEqual(read("result", "revenue", "Revenue was $45.0B.", { basis: "gaap", value: "$45.0B" }), { basis: "gaap", low: 45e9, high: 45e9 });
  assert.deepEqual(read("result", "eps", "Diluted earnings per share was $ 0.54 .", { basis: "gaap", value: "$ 0.54" }), { basis: "gaap", low: 0.54, high: 0.54 });
  for (const figure of [
    // The scale word left behind.
    read("guidance", "revenue", NVDA_REVENUE, { basis: "gaap", value: "$45.0", plus_minus: "2%" }),
    read("result", "revenue", "Revenue was $45.0Bn.", { basis: "gaap", value: "$45.0" }),
    // A figure inside a longer one, or one stated twice.
    read("result", "gross_margin", "Non-GAAP gross margin was 72.5%.", { basis: "non_gaap", value: "2.5%" }),
    read("result", "gross_margin", "Gross margin was 54%, flat with 54% a year ago.", { basis: "gaap", value: "54%" }),
    // A scaled dollar tolerance is no tolerance on dollars a share.
    read("guidance", "eps", "Diluted EPS is expected to be $1.10, plus or minus $300 million.", { basis: "gaap", value: "$1.10", plus_minus: "$300 million" }),
    // Nor is a tolerance with no scale on a scaled figure, whose scale it may have dropped.
    read("guidance", "revenue", "Revenue is expected to be $8.7 billion, plus or minus $300.", { basis: "gaap", value: "$8.7 billion", plus_minus: "$300" }),
  ]) assert.ok(reviewed(figure), JSON.stringify(figure));
});

test("a sentence stating both bases gives each figure the basis it names for that amount, or settles none", () => {
  const margins = "GAAP and non-GAAP gross margins are expected to be 71.0% and 72.0%, respectively, plus or minus 50 basis points.";
  assert.deepEqual(read("guidance", "gross_margin", margins, { basis: "gaap", value: "71.0%", plus_minus: "50 basis points" }), { basis: "gaap", low: 70.5, high: 71.5 });
  assert.deepEqual(read("guidance", "gross_margin", margins, { basis: "non_gaap", value: "72.0%", plus_minus: "50 basis points" }), { basis: "non_gaap", low: 71.5, high: 72.5 });
  const opex = "GAAP and non-GAAP operating expenses are expected to be approximately $5.2 billion and $3.6 billion, respectively.";
  assert.deepEqual(read("guidance", "operating_expenses", opex, { basis: "non_gaap", value: "$3.6 billion" }), { basis: "non_gaap", low: 3.6e9, high: 3.6e9 });
  // One figure both bases share.
  const both = "For the quarter, GAAP and non-GAAP gross margins were both 75.0%.";
  assert.deepEqual(read("result", "gross_margin", both, { basis: "gaap", value: "75.0%" }), { basis: "gaap", low: 75, high: 75 });
  assert.deepEqual(read("result", "gross_margin", both, { basis: "non_gaap", value: "75.0%" }), { basis: "non_gaap", low: 75, high: 75 });
  const shared = "GAAP and non-GAAP gross margins are expected to be 74.0%, plus or minus 50 basis points.";
  assert.deepEqual(read("guidance", "gross_margin", shared, { basis: "non_gaap", value: "74.0%", plus_minus: "50 basis points" }), { basis: "non_gaap", low: 73.5, high: 74.5 });
  // Two sentences, each on its own basis.
  const two = "Gross margin was 40%. On a non-GAAP basis, gross margin was 43%.";
  assert.deepEqual(read("result", "gross_margin", two, { basis: "gaap", value: "40%" }), { basis: "gaap", low: 40, high: 40 });
  assert.deepEqual(read("result", "gross_margin", two, { basis: "non_gaap", value: "43%" }), { basis: "non_gaap", low: 43, high: 43 });
  for (const figure of [
    read("guidance", "gross_margin", margins, { basis: "gaap", value: "72.0%", plus_minus: "50 basis points" }),
    read("guidance", "gross_margin", margins, { basis: "non_gaap", value: "71.0%", plus_minus: "50 basis points" }),
    read("result", "gross_margin", "GAAP and non-GAAP gross margins were 60.5% and 61.0%, respectively.", { basis: "gaap", value: "61.0%" }),
    read("guidance", "operating_expenses", opex, { basis: "gaap", value: "$3.6 billion" }),
    // Two amounts and no "respectively", so which is which is not stated.
    read("result", "gross_margin", "GAAP and non-GAAP gross margins were 60.5% and 61.0%.", { basis: "gaap", value: "60.5%" }),
    // A shared subject covers only the amounts after it.
    read("result", "revenue", "Revenue was $7.7 billion, as the GAAP and non-GAAP tables show.", { basis: "non_gaap", value: "$7.7 billion" }),
    // A non-GAAP label covers the amounts after it, not the GAAP one before.
    read("result", "gross_margin", "Gross margin was 40%, while non-GAAP gross margin was 43%.", { basis: "non_gaap", value: "40%" }),
    read("result", "gross_margin", two, { basis: "non_gaap", value: "40%" }),
    read("result", "gross_margin", "Gross margin was 43% on a non-GAAP basis.", { basis: "gaap", value: "43%" }),
  ]) assert.ok(reviewed(figure), JSON.stringify(figure));
});

test("EPS is diluted EPS, so a sentence naming basic EPS goes to review", () => {
  assert.deepEqual(read("result", "eps", "GAAP diluted EPS was $0.49.", { basis: "gaap", value: "$0.49" }), { basis: "gaap", low: 0.49, high: 0.49 });
  assert.ok(reviewed(read("result", "eps", "Basic and diluted EPS were $0.50 and $0.49, respectively.", { basis: "gaap", value: "$0.50" })));
  assert.ok(reviewed(read("result", "eps", "GAAP basic earnings per share was $0.50.", { basis: "gaap", value: "$0.50" })));
});

// Each figure kind as a sentence, with slots for how a filing may spell its
// minus sign or range dash ({-}), the hyphen of "non-GAAP" ({h}), its scale
// word ({B}, {M}) and words between a label and its amount ({at}). Every
// spelling below must read back the plain sentence's figure.
const KINDS: ReadonlyArray<{ kind: "guidance" | "result"; metric: Parameters<typeof readFigure>[0]["metric"]; text: string; raw: Parameters<typeof readFigure>[1]; want: ReturnType<typeof readFigure> }> = [
  { kind: "result", metric: "revenue", text: "Revenue{at} was $45.0{B}.", raw: { basis: "gaap", value: "$45.0{B}" }, want: { basis: "gaap", low: 45e9, high: 45e9 } },
  { kind: "guidance", metric: "revenue", text: "Revenue{at} is expected to be $45.0{B}, plus or minus $300{M}.", raw: { basis: "gaap", value: "$45.0{B}", plus_minus: "$300{M}" }, want: { basis: "gaap", low: 44.7e9, high: 45.3e9 } },
  { kind: "guidance", metric: "operating_expenses", text: "Non{h}GAAP operating expenses{at} are expected to be $1.0{B} to $1.1{B}.", raw: { basis: "non_gaap", low: "$1.0{B}", high: "$1.1{B}" }, want: { basis: "non_gaap", low: 1e9, high: 1.1e9 } },
  { kind: "guidance", metric: "eps", text: "Non{h}GAAP diluted EPS{at} is expected to be $1.10{-}$1.20.", raw: { basis: "non_gaap", low: "$1.10", high: "$1.20" }, want: { basis: "non_gaap", low: 1.1, high: 1.2 } },
  { kind: "result", metric: "free_cash_flow", text: "Free cash flow{at} was {-}$1.2{B}.", raw: { basis: "gaap", value: "{-}$1.2{B}" }, want: { basis: "gaap", low: -1.2e9, high: -1.2e9 } },
  { kind: "result", metric: "eps", text: "Non{h}GAAP diluted EPS{at} was $0.96.", raw: { basis: "non_gaap", value: "$0.96" }, want: { basis: "non_gaap", low: 0.96, high: 0.96 } },
  { kind: "guidance", metric: "gross_margin", text: "Non{h}GAAP gross margin{at} is expected to be 72.0%, plus or minus 50 basis points.", raw: { basis: "non_gaap", value: "72.0%", plus_minus: "50 basis points" }, want: { basis: "non_gaap", low: 71.5, high: 72.5 } },
];

const PLAIN = { "{-}": "-", "{h}": "-", "{B}": " billion", "{M}": " million", "{at}": "" };
const SPELLINGS: ReadonlyArray<Partial<typeof PLAIN>> = [
  ...[" Billion", " BILLION", " Bn", "BN", "bn", "B", "&nbsp;billion", "\u202fbillion", "&thinsp;billion"].map((word) => ({ "{B}": word })),
  ...[" Million", " MILLION", " Mn", "mn", "M", "&nbsp;million"].map((word) => ({ "{M}": word })),
  ...["&minus;", "&#8722;", "&#x2212;", "−", "&ndash;", "–", "—", "‒", "﹣", "－"].map((dash) => ({ "{-}": dash })),
  ...["‐", "‑", "&#8209;", "&hyphen;", " ", "­-", "-​"].map((hyphen) => ({ "{h}": hyphen })),
  ...[" in the U.S. Data Center market", " vs. Q3 last year", " of Acme Inc. Holdings", " for the Dec. Quarter"].map((at) => ({ "{at}": at })),
  { "{B}": "&nbsp;Billion", "{-}": "&minus;", "{h}": "&#8209;", "{at}": " in the U.S. Data Center market" },
];
const spell = (text: string, spelling: Partial<typeof PLAIN>) =>
  text.replace(/\{[-hBM]\}|\{at\}/g, (slot) => (spelling as Record<string, string>)[slot] ?? PLAIN[slot as keyof typeof PLAIN]);

test("a figure reads the same however its filing spells case, entities, minus signs, dashes, hyphens and abbreviations", () => {
  for (const { kind, metric, text, raw, want } of KINDS) {
    for (const spelling of [{}, ...SPELLINGS]) {
      const quote = canonicalText(spell(text, spelling));
      const given = Object.fromEntries(Object.entries(raw).map(([key, phrase]) => [key, key === "basis" ? phrase : canonicalText(spell(phrase as string, spelling))]));
      assert.deepEqual(readFigure({ kind, metric, quote }, given), want, `${JSON.stringify(spelling)}: ${quote}`);
      // The model may copy a phrase in the filing's own characters.
      const rawGiven = Object.fromEntries(Object.entries(raw).map(([key, phrase]) => [key, key === "basis" ? phrase : spell(phrase as string, spelling)]));
      if (!Object.values(rawGiven).some((phrase) => String(phrase).includes("&"))) {
        assert.deepEqual(readFigure({ kind, metric, quote }, rawGiven), want, `raw ${JSON.stringify(spelling)}: ${quote}`);
      }
    }
  }
});

test("a phrase that leaves the scale word behind is no figure, in any case", () => {
  for (const word of ["Billion", "BILLION", "Bn", "trillion"]) {
    assert.ok(reviewed(read("result", "revenue", `Revenue was $45.0 ${word}.`, { basis: "gaap", value: "$45.0" })), word);
  }
  assert.deepEqual(read("result", "revenue", "Revenue was $1.2 Trillion.", { basis: "gaap", value: "$1.2 Trillion" }), { basis: "gaap", low: 1.2e12, high: 1.2e12 });
});

test("a non-GAAP label reaches the figures right after it, and an opening \"on a non-GAAP basis\" its whole clause", () => {
  const amd = "On a non-GAAP (*) basis, gross margin was 56%, operating income was $3.9 billion, net income was $3.5 billion and diluted earnings per share was $2.09.";
  assert.deepEqual(read("result", "operating_income", amd, { basis: "non_gaap", value: "$3.9 billion" }), { basis: "non_gaap", low: 3.9e9, high: 3.9e9 });
  assert.deepEqual(read("result", "eps", amd, { basis: "non_gaap", value: "$2.09" }), { basis: "non_gaap", low: 2.09, high: 2.09 });
  const listed = "Non-GAAP operating income and net income were $3.9 billion and $3.5 billion, respectively.";
  assert.deepEqual(read("result", "net_income", listed, { basis: "non_gaap", value: "$3.5 billion" }), { basis: "non_gaap", low: 3.5e9, high: 3.5e9 });
  const perShare = "Non-GAAP net income for fiscal 2025 was $3.5 billion or $2.09 per diluted share.";
  assert.deepEqual(read("result", "eps", perShare, { basis: "non_gaap", value: "$2.09" }), { basis: "non_gaap", low: 2.09, high: 2.09 });
  for (const figure of [
    // A bare comma ends the label's reach.
    read("result", "eps", perShare.replace(" or", ", or"), { basis: "non_gaap", value: "$2.09" }),
    read("result", "revenue", "Non-GAAP gross margin was 43%, and revenue was $7.7 billion.", { basis: "non_gaap", value: "$7.7 billion" }),
    read("result", "revenue", "Non-GAAP gross margin was 43%, and revenue was $7.7 billion.", { basis: "gaap", value: "$7.7 billion" }),
    read("result", "operating_income", "Non-GAAP gross margin was 56%, operating income was $3.9 billion.", { basis: "non_gaap", value: "$3.9 billion" }),
    read("result", "revenue", "Non-GAAP results improved, and revenue was $7.7 billion.", { basis: "non_gaap", value: "$7.7 billion" }),
  ]) assert.ok(reviewed(figure), JSON.stringify(figure));
});

test("a negative word on a figure that is never negative, or two amounts not stated as a range, go to review", () => {
  for (const figure of [
    read("result", "operating_expenses", "Operating expenses were negative $50 million.", { basis: "gaap", value: "$50 million" }),
    read("result", "revenue", "Revenue was minus $50 million.", { basis: "gaap", value: "$50 million" }),
    read("guidance", "gross_margin", "GAAP and non-GAAP gross margins are expected to be 71.0% and 72.0%.", { basis: "gaap", low: "71.0%", high: "72.0%" }),
    read("guidance", "gross_margin", "GAAP and non-GAAP gross margins are expected to be 71.0% and 72.0%.", { basis: "non_gaap", low: "71.0%", high: "72.0%" }),
    read("guidance", "revenue", "Revenue is expected to be $4 billion and capex $5 billion.", { basis: "gaap", low: "$4 billion", high: "$5 billion" }),
  ]) assert.ok(reviewed(figure), JSON.stringify(figure));
  // "Plus or minus" is no negative word, and "between" makes "and" a range.
  assert.deepEqual(
    read("guidance", "operating_expenses", "Operating expenses are expected to be $1.2 billion, plus or minus $50 million.", { basis: "gaap", value: "$1.2 billion", plus_minus: "$50 million" }),
    { basis: "gaap", low: 1.15e9, high: 1.25e9 },
  );
  for (const quote of ["Revenue was $7.7 billion, despite a negative currency impact.", "Revenue is expected to be $7.7 billion, plus/minus 2%."]) {
    assert.ok(!reviewed(read(quote.includes("expected") ? "guidance" : "result", "revenue", quote, { basis: "gaap", value: "$7.7 billion" })), quote);
  }
  // A year is no amount of the shared subject.
  const fiscal = "GAAP and non-GAAP gross margins for fiscal 2026 were 74.9% and 75.0%, respectively.";
  assert.deepEqual(read("result", "gross_margin", fiscal, { basis: "non_gaap", value: "75.0%" }), { basis: "non_gaap", low: 75, high: 75 });
  const between = "GAAP and non-GAAP gross margins are expected to be between 71.0% and 72.0%.";
  assert.deepEqual(read("guidance", "gross_margin", between, { basis: "non_gaap", low: "71.0%", high: "72.0%" }), { basis: "non_gaap", low: 71, high: 72 });
});

// Every sentence shape a reviewer found across rounds 1 to 3 (Devin, Codex,
// the verifier), its siblings, and the shapes the round-4 brief names: each
// pick reads the basis its clause states, or goes to review, never another.
const REVIEW = "review" as const;
type Want = { basis: "gaap" | "non_gaap"; low: number; high: number } | typeof REVIEW;
type Shape = [from: string, kind: "guidance" | "result", metric: Parameters<typeof readFigure>[0]["metric"], quote: string, picks: ReadonlyArray<[raw: Parameters<typeof readFigure>[1], want: Want]>];
const at = (basis: "gaap" | "non_gaap", low: number, high = low): Want => ({ basis, low, high });
const SHAPES: ReadonlyArray<Shape> = [
  // Devin, round 1: a figure of one basis read as the other.
  ["devin r1", "result", "gross_margin", "GAAP and non-GAAP gross margins were 60.5% and 61.0%, respectively.", [
    [{ basis: "gaap", value: "60.5%" }, at("gaap", 60.5)], [{ basis: "non_gaap", value: "61.0%" }, at("non_gaap", 61)],
    [{ basis: "gaap", value: "61.0%" }, REVIEW], [{ basis: "non_gaap", value: "60.5%" }, REVIEW],
  ]],
  ["devin r1", "result", "free_cash_flow", "Free cash flow was -$150 million.", [[{ basis: "gaap", value: "-$150 million" }, at("gaap", -1.5e8)]]],
  ["devin r1", "result", "revenue", "Second quarter revenue was $7.7 billion.", [[{ basis: "gaap", value: "$7.7" }, REVIEW], [{ basis: "gaap", value: "$7.7 billion" }, at("gaap", 7.7e9)]]],
  ["devin r1", "result", "eps", "Basic and diluted earnings per share were $1.02 and $1.00, respectively.", [[{ basis: "gaap", value: "$1.00" }, REVIEW]]],
  ["codex r1", "result", "eps", "GAAP diluted EPS was ($0.50).", [[{ basis: "gaap", value: "($0.50)" }, at("gaap", -0.5)], [{ basis: "gaap", value: "$0.50" }, REVIEW]]],
  // The verifier, round 1: signs, scales and truncated amounts.
  ["verifier r1", "result", "operating_income", "Operating income was ($50 million).", [[{ basis: "gaap", value: "($50 million)" }, at("gaap", -5e7)]]],
  ["verifier r1", "result", "gross_margin", "Non-GAAP gross margin was 72.5%.", [[{ basis: "non_gaap", value: "72.5%" }, at("non_gaap", 72.5)], [{ basis: "non_gaap", value: "2.5%" }, REVIEW]]],
  ["verifier r1", "guidance", "eps", "Diluted EPS is expected to be $1.10, plus or minus $300 million.", [[{ basis: "gaap", value: "$1.10", plus_minus: "$300 million" }, REVIEW]]],
  // The verifier, round 2: case, abbreviations, entities, a label's noun phrase, two bases.
  ["verifier r2", "result", "revenue", "Revenue was $45.0 Billion.", [[{ basis: "gaap", value: "$45.0 Billion" }, at("gaap", 45e9)], [{ basis: "gaap", value: "$45.0" }, REVIEW]]],
  ["verifier r2", "result", "revenue", "Non-GAAP revenue in the U.S. Data Center segment was $5.0 billion.", [[{ basis: "non_gaap", value: "$5.0 billion" }, at("non_gaap", 5e9)], [{ basis: "gaap", value: "$5.0 billion" }, REVIEW]]],
  ["verifier r2", "result", "gross_margin", "Non-GAAP gross margin for Q1 vs. Q2 was 72.0%.", [[{ basis: "non_gaap", value: "72.0%" }, at("non_gaap", 72)], [{ basis: "gaap", value: "72.0%" }, REVIEW]]],
  ["verifier r2", "result", "free_cash_flow", canonicalText("<p>Free cash flow was &minus;$1.2 billion.</p>"), [[{ basis: "gaap", value: "-$1.2 billion" }, at("gaap", -1.2e9)]]],
  ["verifier r2", "result", "gross_margin", canonicalText("<p>Non&#8209;GAAP gross margin was 72.0%.</p>"), [[{ basis: "non_gaap", value: "72.0%" }, at("non_gaap", 72)], [{ basis: "gaap", value: "72.0%" }, REVIEW]]],
  ["verifier r2", "result", "gross_margin", "Non-GAAP gross margin was 43%, and revenue was $7.7 billion.", [[{ basis: "non_gaap", value: "43%" }, at("non_gaap", 43)], [{ basis: "gaap", value: "43%" }, REVIEW]]],
  ["verifier r2", "result", "revenue", "Non-GAAP gross margin was 43%, and revenue was $7.7 billion.", [[{ basis: "non_gaap", value: "$7.7 billion" }, REVIEW], [{ basis: "gaap", value: "$7.7 billion" }, REVIEW]]],
  ["verifier r2", "result", "operating_expenses", "Operating expenses were negative $50 million.", [[{ basis: "gaap", value: "$50 million" }, REVIEW]]],
  ["verifier r2", "guidance", "gross_margin", "GAAP and non-GAAP gross margins are expected to be 71.0% and 72.0%.", [[{ basis: "gaap", low: "71.0%", high: "72.0%" }, REVIEW], [{ basis: "non_gaap", low: "71.0%", high: "72.0%" }, REVIEW]]],
  // The verifier, round 3: exclusions, a postposed basis, preambles, flattened cells, parentheticals.
  ["verifier r3", "result", "gross_margin", "Gross margin excluding stock-based compensation was 72.0%.", [[{ basis: "gaap", value: "72.0%" }, REVIEW], [{ basis: "non_gaap", value: "72.0%" }, REVIEW]]],
  ["verifier r3", "result", "gross_margin", "Excluding the $4.5 billion charge, Q1 gross margin would have been 71.3%.", [[{ basis: "gaap", value: "71.3%" }, REVIEW], [{ basis: "non_gaap", value: "71.3%" }, REVIEW]]],
  ["verifier r3", "result", "operating_expenses", "Excluding the $4.5 billion charge, Q1 gross margin would have been 71.3%.", [[{ basis: "gaap", value: "$4.5 billion" }, REVIEW], [{ basis: "non_gaap", value: "$4.5 billion" }, REVIEW]]],
  ["verifier r3", "result", "gross_margin", "Gross margin was 43% on a non-GAAP basis, and revenue was $7.7 billion.", [[{ basis: "non_gaap", value: "43%" }, at("non_gaap", 43)], [{ basis: "gaap", value: "43%" }, REVIEW]]],
  ["verifier r3", "result", "revenue", "Gross margin was 43% on a non-GAAP basis, and revenue was $7.7 billion.", [[{ basis: "non_gaap", value: "$7.7 billion" }, REVIEW], [{ basis: "gaap", value: "$7.7 billion" }, REVIEW]]],
  ["verifier r3", "guidance", "operating_expenses", "Gross margin is expected to be 72.0% on a non-GAAP basis, and operating expenses are expected to be $3.5 billion.", [[{ basis: "non_gaap", value: "$3.5 billion" }, REVIEW], [{ basis: "gaap", value: "$3.5 billion" }, REVIEW]]],
  ["verifier r3", "result", "gross_margin", "We report GAAP and non-GAAP results; non-GAAP gross margin was 72.0%.", [[{ basis: "non_gaap", value: "72.0%" }, at("non_gaap", 72)], [{ basis: "gaap", value: "72.0%" }, REVIEW]]],
  ["verifier r3", "result", "gross_margin", "GAAP and non-GAAP financial measures are discussed below, and GAAP gross margin was 70.0%.", [[{ basis: "gaap", value: "70.0%" }, at("gaap", 70)], [{ basis: "non_gaap", value: "70.0%" }, REVIEW]]],
  ["verifier r3", "result", "gross_margin", "Non-GAAP gross margin 43% $7.7 billion", [[{ basis: "non_gaap", value: "43%" }, at("non_gaap", 43)], [{ basis: "gaap", value: "43%" }, REVIEW]]],
  ["verifier r3", "result", "revenue", "Non-GAAP gross margin 43% $7.7 billion", [[{ basis: "non_gaap", value: "$7.7 billion" }, REVIEW], [{ basis: "gaap", value: "$7.7 billion" }, REVIEW]]],
  ["verifier r3", "result", "gross_margin", "Non-GAAP gross margin (excluding stock-based compensation of $200 million) was 72.0%.", [[{ basis: "non_gaap", value: "72.0%" }, at("non_gaap", 72)], [{ basis: "gaap", value: "72.0%" }, REVIEW]]],
  ["verifier r3", "result", "operating_expenses", "Non-GAAP gross margin (excluding stock-based compensation of $200 million) was 72.0%.", [[{ basis: "non_gaap", value: "$200 million" }, REVIEW], [{ basis: "gaap", value: "$200 million" }, REVIEW]]],
  ["verifier r3", "result", "gross_margin", "Non-GAAP gross margin was 43% and GAAP gross margin was 41%.", [[{ basis: "non_gaap", value: "43%" }, REVIEW], [{ basis: "gaap", value: "41%" }, REVIEW]]],
  ["verifier r3", "result", "eps", "Adjusted diluted EPS was $1.20.", [[{ basis: "non_gaap", value: "$1.20" }, at("non_gaap", 1.2)], [{ basis: "gaap", value: "$1.20" }, REVIEW]]],
  // Codex, round 3: a growth rate is no tolerance.
  ["codex r3", "guidance", "revenue", "Revenue is expected to be $45 billion, up 2% year over year.", [[{ basis: "gaap", value: "$45 billion", plus_minus: "2%" }, REVIEW], [{ basis: "gaap", value: "$45 billion" }, at("gaap", 45e9)]]],
  // Siblings: the same shapes with a bare comma, no comma, or another marker.
  ["sibling", "result", "revenue", "Non-GAAP gross margin was 43%, revenue was $7.7 billion.", [[{ basis: "non_gaap", value: "$7.7 billion" }, REVIEW], [{ basis: "gaap", value: "$7.7 billion" }, REVIEW]]],
  ["sibling", "result", "revenue", "Non-GAAP gross margin was 43% and revenue was $7.7 billion.", [[{ basis: "non_gaap", value: "$7.7 billion" }, REVIEW], [{ basis: "gaap", value: "$7.7 billion" }, REVIEW]]],
  ["sibling", "result", "revenue", "Gross margin was 43% on a non-GAAP basis, revenue was $7.7 billion.", [[{ basis: "non_gaap", value: "$7.7 billion" }, REVIEW], [{ basis: "gaap", value: "$7.7 billion" }, REVIEW]]],
  ["sibling", "result", "revenue", "We report GAAP and non-GAAP results, and revenue was $7.7 billion.", [[{ basis: "non_gaap", value: "$7.7 billion" }, REVIEW], [{ basis: "gaap", value: "$7.7 billion" }, REVIEW]]],
  ["sibling", "result", "gross_margin", "Gross margin was 40% (non-GAAP gross margin was 43%).", [[{ basis: "non_gaap", value: "43%" }, REVIEW], [{ basis: "gaap", value: "40%" }, REVIEW], [{ basis: "non_gaap", value: "40%" }, REVIEW]]],
  ["sibling", "result", "operating_income", "On a non-GAAP basis, gross margin was 54%, and operating income was $1.7 billion.", [[{ basis: "non_gaap", value: "$1.7 billion" }, REVIEW], [{ basis: "gaap", value: "$1.7 billion" }, REVIEW]]],
  ["sibling", "result", "gross_margin", "On a GAAP basis, gross margin was 50%.", [[{ basis: "gaap", value: "50%" }, at("gaap", 50)], [{ basis: "non_gaap", value: "50%" }, REVIEW]]],
  ["sibling", "result", "revenue", "Revenue was $7.7 billion on a constant currency basis.", [[{ basis: "gaap", value: "$7.7 billion" }, REVIEW], [{ basis: "non_gaap", value: "$7.7 billion" }, REVIEW]]],
  ["sibling", "result", "revenue", "Pro forma revenue was $7.7 billion.", [[{ basis: "gaap", value: "$7.7 billion" }, REVIEW], [{ basis: "non_gaap", value: "$7.7 billion" }, REVIEW]]],
  ["sibling", "result", "eps", "Non-GAAP net income for fiscal 2025 was $3.5 billion, or $2.09 per diluted share.", [[{ basis: "non_gaap", value: "$2.09" }, REVIEW]]],
  ["sibling", "result", "gross_margin", "Gross margin on a non-GAAP basis was 43%, revenue was $7.7 billion.", [[{ basis: "non_gaap", value: "43%" }, at("non_gaap", 43)], [{ basis: "gaap", value: "43%" }, REVIEW]]],
  ["sibling", "result", "revenue", "Gross margin on a non-GAAP basis was 43%, revenue was $7.7 billion.", [[{ basis: "non_gaap", value: "$7.7 billion" }, REVIEW], [{ basis: "gaap", value: "$7.7 billion" }, REVIEW]]],
  ["sibling", "result", "gross_margin", "For the quarter, on a non-GAAP basis, gross margin was 54%.", [[{ basis: "non_gaap", value: "54%" }, REVIEW], [{ basis: "gaap", value: "54%" }, REVIEW]]],
  ["sibling", "guidance", "gross_margin", "Gross margin is expected to be 72%, plus or minus 50 basis points, and operating margin 30%, up 2% year over year.", [[{ basis: "gaap", value: "72%", plus_minus: "50 basis points" }, at("gaap", 71.5, 72.5)]]],
];

test("each shape the reviewers found reads the basis its own clause states, or goes to review, never another basis", () => {
  for (const [from, kind, metric, quote, picks] of SHAPES) {
    for (const [raw, want] of picks) {
      const got = readFigure({ kind, metric, quote }, raw);
      if (want === REVIEW) assert.ok(reviewed(got), `${from}: ${quote} ${JSON.stringify(raw)} read as ${JSON.stringify(got)}`);
      else assert.deepEqual(got, want, `${from}: ${quote} ${JSON.stringify(raw)}`);
    }
  }
});
