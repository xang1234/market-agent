import assert from "node:assert/strict";
import test from "node:test";

import { formatCompactCurrency } from "../../analyze/src/block-format.ts";
import { keepSupportedSentences } from "../src/narrative-guard.ts";

const DISPLAYED = ["Revenue", "$62.1B", "Q4 2026", "Quarterly revenue (Q1 2025 to Q4 2026)"];

test("keeps prose whose numbers all appear in the displayed figures", () => {
  const text = "Revenue reached $62.1B in Q4 2026. It rose every quarter.";
  assert.deepEqual(keepSupportedSentences(text, DISPLAYED), { text, removed: [] });
});

test("matches a figure regardless of how the prose spells the unit", () => {
  const text = "Revenue was 62.1 billion dollars in Q4 2026.";
  assert.equal(keepSupportedSentences(text, DISPLAYED).removed.length, 0);
});

test("strips sentences that introduce numbers not shown anywhere", () => {
  const result = keepSupportedSentences(
    "Revenue reached $62.1B in Q4 2026. That is 38% growth year over year. Margins held up.",
    DISPLAYED,
  );
  assert.equal(result.text, "Revenue reached $62.1B in Q4 2026. Margins held up.");
  assert.deepEqual(result.removed, ["That is 38% growth year over year."]);
});

test("numbers quoted from a cited claim are supported", () => {
  const claim = "Management guided to 20 new design wins.";
  const text = "Management expects 20 new design wins.";
  assert.equal(keepSupportedSentences(text, [...DISPLAYED, claim]).removed.length, 0);
});

test("when every sentence is unsupported, nothing of the model's prose is kept", () => {
  const result = keepSupportedSentences("Revenue grew 45%. EPS hit $3.10.", DISPLAYED);
  assert.equal(result.text, "");
  assert.equal(result.removed.length, 2);
});

test("guards each line of a bulleted answer on its own and keeps the line structure", () => {
  const result = keepSupportedSentences(
    "- Revenue reached $62.1B in Q4 2026\n- Grew 38% year over year\n- Margins held up",
    DISPLAYED,
  );
  assert.equal(result.text, "- Revenue reached $62.1B in Q4 2026\n- Margins held up");
  assert.deepEqual(result.removed, ["- Grew 38% year over year"]);
});

test("keeps paragraph breaks between supported paragraphs", () => {
  const text = "Revenue reached $62.1B in Q4 2026.\n\nMargins held up.";
  assert.deepEqual(keepSupportedSentences(text, DISPLAYED), { text, removed: [] });
});

// A comparison's cells: each figure belongs to one company.
const COMPARED = [
  { company: "NVDA", value: "74.6%" },
  { company: "AMD", value: "49.2%" },
];

test("a comparison figure credited to the wrong company is removed; the right company keeps it", () => {
  const wrong = keepSupportedSentences("AMD's gross margin is 74.6%. Both grew.", [], COMPARED);
  assert.deepEqual(wrong.removed, ["AMD's gross margin is 74.6%."]);
  assert.equal(wrong.text, "Both grew.");
  const right = keepSupportedSentences("NVDA's gross margin is 74.6%, ahead of AMD at 49.2%.", [], COMPARED);
  assert.deepEqual(right.removed, []);
});

test("each figure is credited to the company named before it, or else after it", () => {
  const swapped = keepSupportedSentences("AMD's gross margin is 74.6%, ahead of NVDA at 49.2%.", [], COMPARED);
  assert.equal(swapped.removed.length, 1);
  assert.deepEqual(keepSupportedSentences("Gross margin: 74.6% at NVDA.", [], COMPARED).removed, []);
});

test("a comparison figure must have its company named in the same sentence", () => {
  assert.equal(keepSupportedSentences("Gross margin is 74.6%.", [], COMPARED).removed.length, 1);
  // Nothing carries across sentences: "Its" could mean any company named earlier.
  const carried = keepSupportedSentences("NVDA leads on margins. Its gross margin is 74.6%.", [], COMPARED);
  assert.deepEqual(carried.removed, ["Its gross margin is 74.6%."]);
});

test("company labels match exactly, so an ordinary word is not a ticker", () => {
  const figures = [{ company: "ON", value: "74.6%" }, { company: "AMD", value: "49.2%" }];
  assert.equal(keepSupportedSentences("AMD has 74.6% on margin.", [], figures).removed.length, 1);
  assert.deepEqual(keepSupportedSentences("ON has a 74.6% margin.", [], figures).removed, []);
});

test("a figure with more than one company named before it is ambiguous and removed", () => {
  assert.equal(keepSupportedSentences("AMD's margin, unlike NVDA, is 74.6%.", [], COMPARED).removed.length, 1);
  // A company introduced as a comparison ("Unlike AMD, ...") is not the owner.
  assert.deepEqual(keepSupportedSentences("Unlike AMD, NVDA's margin is 74.6%.", [], COMPARED).removed, []);
});

test("an unattributed number between a company and its figure does not break the attribution", () => {
  assert.deepEqual(keepSupportedSentences("NVDA in fiscal 2026 had a 74.6% margin.", ["FY 2026"], COMPARED).removed, []);
});

test("a removed sentence cannot name the company for the next one", () => {
  const result = keepSupportedSentences("AMD's margin is 74.6%. Its margin is 49.2%.", [], COMPARED);
  assert.deepEqual(result.removed, ["AMD's margin is 74.6%.", "Its margin is 49.2%."]);
});

test("one company named once governs the figures that follow it in the sentence", () => {
  const figures = [...COMPARED, { company: "NVDA", value: "$130.5B" }];
  assert.deepEqual(
    keepSupportedSentences("NVDA's revenue was $130.5B and gross margin was 74.6%.", [], figures).removed,
    [],
  );
  assert.deepEqual(
    keepSupportedSentences("NVDA's revenue was $130.5B and gross margin 74.6%, versus AMD's 49.2%.", [], figures).removed,
    [],
  );
  // The carried company still has to own the figure.
  assert.equal(keepSupportedSentences("NVDA's revenue was $130.5B and gross margin was 49.2%.", [], figures).removed.length, 1);
});

test("a comparison figure is checked for its company even when a cited claim repeats the number", () => {
  const claim = "Industry gross margins reached 74.6% at the leader.";
  assert.equal(keepSupportedSentences("AMD's gross margin is 74.6%.", [claim], COMPARED).removed.length, 1);
  assert.deepEqual(keepSupportedSentences("NVDA's gross margin is 74.6%.", [claim], COMPARED).removed, []);
});

test("a company named right after a figure owns it, unless written possessively for the next figure", () => {
  assert.deepEqual(keepSupportedSentences("NVDA delivered 74.6%, versus 49.2% for AMD.", [], COMPARED).removed, []);
  // "AMD's" points forward to 49.2%, so 74.6% keeps NVDA from earlier in the sentence.
  const figures = [...COMPARED, { company: "NVDA", value: "$130.5B" }];
  assert.deepEqual(
    keepSupportedSentences("NVDA's revenue was $130.5B and gross margin 74.6%, versus AMD's 49.2%.", [], figures).removed,
    [],
  );
});

test("a figure takes only the first company named after it, and that name is used up", () => {
  assert.deepEqual(keepSupportedSentences("74.6% for NVDA, compared with AMD at 49.2%.", [], COMPARED).removed, []);
  assert.deepEqual(keepSupportedSentences("Gross margin: 74.6% at NVDA, 49.2% at AMD.", [], COMPARED).removed, []);
  // The first name after a figure must still own it.
  assert.equal(keepSupportedSentences("74.6% for AMD, compared with NVDA at 49.2%.", [], COMPARED).removed.length, 1);
});

test("a company named after a figure owns it only when a preposition ties them", () => {
  // "Its" is NVDA; AMD is only the comparison, so 49.2% is credited to NVDA and dropped.
  const result = keepSupportedSentences("NVDA led. Its margin was 49.2%, exceeding AMD.", [], COMPARED);
  assert.deepEqual(result.removed, ["Its margin was 49.2%, exceeding AMD."]);
  assert.deepEqual(keepSupportedSentences("Margins were 49.2% for AMD.", [], COMPARED).removed, []);
});

test("a sentence naming several companies passes none on to the next", () => {
  const result = keepSupportedSentences("NVDA trails AMD. Its gross margin is 49.2%.", [], COMPARED);
  assert.deepEqual(result.removed, ["Its gross margin is 49.2%."]);
  assert.equal(keepSupportedSentences("AMD trails. Its gross margin is 49.2%.", [], COMPARED).removed.length, 1);
});

test("a comparison phrase after a figure does not make that company its owner", () => {
  const result = keepSupportedSentences("AMD lagged. Its margin was 74.6%, ahead of NVDA.", [], COMPARED);
  assert.deepEqual(result.removed, ["Its margin was 74.6%, ahead of NVDA."]);
  assert.equal(keepSupportedSentences("AMD lagged. Its margin was 74.6% ahead of NVDA.", [], COMPARED).removed.length, 1);
  assert.deepEqual(keepSupportedSentences("Gross margin was 74.6 percent for NVDA.", [], COMPARED).removed, []);
});

test("a figure's sign is part of it: a displayed decline cannot approve a gain", () => {
  const growth = [{ company: "NVDA", value: "-10.0%" }, { company: "AMD", value: "12.0%" }];
  assert.equal(keepSupportedSentences("NVDA's revenue growth was 10.0%.", [], growth).removed.length, 1);
  assert.deepEqual(keepSupportedSentences("NVDA's revenue growth was -10.0%.", [], growth).removed, []);
  assert.deepEqual(keepSupportedSentences("NVDA's revenue growth was −10.0%.", [], growth).removed, []);
  assert.equal(keepSupportedSentences("Operating margin was 3.1%.", ["-3.1%"]).removed.length, 1);
  // A hyphen between numbers is a range, not a sign.
  assert.deepEqual(keepSupportedSentences("Revenue rose over 2025-2026.", ["FY 2025 to FY 2026"]).removed, []);
});

test("a minus before a currency symbol is the figure's sign", () => {
  assert.equal(keepSupportedSentences("Operating income was $3.1B.", ["-$3.1B"]).removed.length, 1);
  assert.deepEqual(keepSupportedSentences("Operating income was -$3.1B.", ["-$3.1B"]).removed, []);
  assert.deepEqual(keepSupportedSentences("Revenue was $3.1B.", ["$3.1B"]).removed, []);
});

test("a 'respectively' sentence is not paired up: it is dropped rather than guessed", () => {
  for (const sentence of [
    "NVDA and AMD had gross margins of 74.6% and 49.2%, respectively.",
    "Compared with NVDA, AMD's gross and net margins were 74.6% and 49.2%, respectively.",
    "NVDA and AMD were discussed, but the former's gross and net margins were 74.6% and 49.2%, respectively.",
  ]) {
    assert.equal(keepSupportedSentences(sentence, [], COMPARED).removed.length, 1, sentence);
  }
});

test("digits inside a company label are not figures", () => {
  const figures = [{ company: "issuer:12ab34cd", value: "49.2%" }, { company: "NVDA", value: "74.6%" }];
  assert.deepEqual(keepSupportedSentences("issuer:12ab34cd's margin is 49.2%.", [], figures).removed, []);
});

test("a company introduced as a comparison before the figure does not own it", () => {
  const result = keepSupportedSentences("NVDA led. Compared with AMD, its gross margin was 49.2%.", [], COMPARED);
  assert.deepEqual(result.removed, ["Compared with AMD, its gross margin was 49.2%."]);
  assert.deepEqual(keepSupportedSentences("Compared with AMD, NVDA's gross margin was 74.6%.", [], COMPARED).removed, []);
});

test("negative zero keeps its sign", () => {
  const flat = [{ company: "NVDA", value: "-0.0%" }, { company: "AMD", value: "12.0%" }];
  assert.equal(keepSupportedSentences("NVDA's revenue growth was 0.0%.", [], flat).removed.length, 1);
  assert.deepEqual(keepSupportedSentences("NVDA's revenue growth was -0.0%.", [], flat).removed, []);
});

test("a sentence naming a company only as a comparison keeps the carried subject", () => {
  const result = keepSupportedSentences(
    "NVDA leads. Unlike AMD, it has stronger margins. Its gross margin is 49.2%.",
    [],
    COMPARED,
  );
  assert.deepEqual(result.removed, ["Its gross margin is 49.2%."]);
});

test("'from' after a figure names a comparison, not its owner", () => {
  const result = keepSupportedSentences("NVDA led. Its margin rose to 49.2% from AMD's level.", [], COMPARED);
  assert.deepEqual(result.removed, ["Its margin rose to 49.2% from AMD's level."]);
});

test("a pronoun sentence never replaces the carried subject", () => {
  const result = keepSupportedSentences("NVDA led. It outperformed AMD. Its gross margin was 49.2%.", [], COMPARED);
  assert.deepEqual(result.removed, ["Its gross margin was 49.2%."]);
});

test("a pronoun before a figure is its subject; a company named after cannot override it", () => {
  const result = keepSupportedSentences("NVDA led. Its margin was 49.2% in AMD's filing.", [], COMPARED);
  assert.deepEqual(result.removed, ["Its margin was 49.2% in AMD's filing."]);
  // Within one sentence, the pronoun refers to the earlier figure's company.
  const figures = [...COMPARED, { company: "NVDA", value: "$130.5B" }];
  assert.deepEqual(
    keepSupportedSentences("NVDA's revenue was $130.5B, and its margin was 74.6% in the year.", [], figures).removed,
    [],
  );
  assert.equal(
    keepSupportedSentences("NVDA's revenue was $130.5B, and its margin was 49.2% in AMD's filing.", [], figures).removed.length,
    1,
  );
});

test("a nominal reference such as 'the company' cannot pass a company to the next sentence", () => {
  const result = keepSupportedSentences("NVDA led. The company outperformed AMD. Its gross margin was 49.2%.", [], COMPARED);
  assert.deepEqual(result.removed, ["Its gross margin was 49.2%."]);
});

test("a one-letter ticker is never read as a company mention", () => {
  const withTickerA = [{ company: "A", value: "74.6%" }, { company: "AMD", value: "49.2%" }];
  assert.equal(keepSupportedSentences("A margin of 74.6% makes AMD the leader.", [], withTickerA).removed.length, 1);
  assert.deepEqual(keepSupportedSentences("AMD's margin is 49.2%.", [], withTickerA).removed, []);
});

test("a company introduced as a comparison owns a figure only when directly attached to it (#146)", () => {
  assert.equal(
    keepSupportedSentences("NVDA led. Unlike AMD, the company achieved a 49.2% margin.", [], COMPARED).removed.length,
    1,
  );
  assert.equal(keepSupportedSentences("Unlike AMD, the company achieved a 49.2% margin.", [], COMPARED).removed.length, 1);
  // Directly attached, the comparison names the figure's owner.
  assert.deepEqual(keepSupportedSentences("NVDA grew faster, versus AMD's 49.2% margin.", [], COMPARED).removed, []);
  assert.deepEqual(keepSupportedSentences("NVDA grew faster, compared with AMD at 49.2%.", [], COMPARED).removed, []);
});

test("the minus sign carries across a currency-code prefix (#147)", () => {
  for (const displayed of ["-CN¥3.1B", "-CA$3.1B", "-HK$3.1B", "-CHF 3.1B", "-₹3.1B"]) {
    assert.equal(keepSupportedSentences("Operating income was $3.1B.", [displayed]).removed.length, 1, displayed);
    assert.deepEqual(keepSupportedSentences(`Operating income was ${displayed}.`, [displayed]).removed, [], displayed);
  }
  // A hyphen inside a word or between numbers is still not a sign.
  assert.deepEqual(keepSupportedSentences("Revenue rose over 2025-2026.", ["FY 2025 to FY 2026"]).removed, []);
});

test("the sign survives every currency prefix the formatter can write", () => {
  for (const currency of Intl.supportedValuesOf("currency")) {
    const loss = formatCompactCurrency(-3.1e9, currency);
    const gain = formatCompactCurrency(3.1e9, currency);
    assert.equal(keepSupportedSentences(`Operating income was ${gain}.`, [loss]).removed.length, 1, `${currency}: ${loss}`);
    assert.deepEqual(keepSupportedSentences(`Operating income was ${loss}.`, [loss]).removed, [], `${currency}: ${loss}`);
  }
});

test("a dotted currency prefix still compares the amount", () => {
  const loss = formatCompactCurrency(-3.1e9, "XCG");
  const other = formatCompactCurrency(-8.7e9, "XCG");
  assert.equal(keepSupportedSentences(`Operating income was ${other}.`, [loss]).removed.length, 1);
  assert.equal(keepSupportedSentences("Operating income was -Foo. 8.7B.", [loss]).removed.length, 1);
});

test("a sentence starting with a digit is still its own sentence", () => {
  const figures = [...COMPARED, { company: "NVDA", value: "$130.5B" }];
  const result = keepSupportedSentences("NVDA's revenue was $130.5B. 74.6% was AMD's margin.", [], figures);
  assert.deepEqual(result.removed, ["74.6% was AMD's margin."]);
});

test("sentences separated by a no-break space are still split", () => {
  for (const space of [" ", " "]) {
    const result = keepSupportedSentences(`NVDA led.${space}74.6% was AMD's margin.`, [], COMPARED);
    assert.equal(result.removed.length, 1, JSON.stringify(space));
  }
});

test("only the formatter's own 'Cg.' plus no-break space is kept together", () => {
  const result = keepSupportedSentences("NVDA reports in Cg. 74.6% was AMD's margin.", [], COMPARED);
  assert.equal(result.removed.length, 1);
  assert.deepEqual(result.removed, ["74.6% was AMD's margin."]);
});

test("a Markdown bullet marker is not a minus sign", () => {
  assert.equal(keepSupportedSentences("- 3.1% revenue growth", ["-3.1%"]).removed.length, 1);
  assert.deepEqual(keepSupportedSentences("- -3.1% revenue growth", ["-3.1%"]).removed, []);
  assert.deepEqual(keepSupportedSentences("- 3.1% revenue growth", ["3.1%"]).removed, []);
});

test("'Cg.' plus a no-break space is kept together only inside a signed figure", () => {
  const result = keepSupportedSentences("NVDA reports in Cg. 74.6% was AMD's margin.", [], COMPARED);
  assert.deepEqual(result.removed, ["74.6% was AMD's margin."]);
});

test("an unattached comparison company blocks the carried owner", () => {
  const figures = [
    { company: "NVDA", value: "$130.5B" },
    { company: "NVDA", value: "$74.6B" },
    { company: "AMD", value: "$49.2B" },
  ];
  const result = keepSupportedSentences(
    "NVDA's revenue was $130.5B, compared with AMD's revenue of $74.6B.",
    [],
    figures,
  );
  assert.equal(result.removed.length, 1);
});

test("a ticker that is also a currency prefix does not break that currency's figures", () => {
  const figures = [{ company: "CHF", value: "-CHF 3.1B" }, { company: "AMD", value: "$3.1B" }];
  assert.deepEqual(keepSupportedSentences("CHF's operating income was -CHF 3.1B.", [], figures).removed, []);
  assert.equal(keepSupportedSentences("AMD's operating income was -CHF 3.1B.", [], figures).removed.length, 1);
});

test("'-Cg.' ends a sentence unless a complete currency figure follows", () => {
  const figures = [{ company: "NVDA", value: "-74.6%" }, { company: "AMD", value: "74.6%" }];
  const result = keepSupportedSentences("NVDA reports in -Cg. 74.6% was AMD's margin.", [], figures);
  // Split: NVDA no longer lends its name to a figure in the next sentence.
  assert.deepEqual(result.removed, ["74.6% was AMD's margin."]);
});
