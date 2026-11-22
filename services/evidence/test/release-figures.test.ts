import test from "node:test";
import assert from "node:assert/strict";

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
