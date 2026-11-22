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
