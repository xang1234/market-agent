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
  assert.deepEqual(result.removed, ["Grew 38% year over year"]);
});

test("a numbered item keeps its marker, and loses it only with the whole item (#144)", () => {
  const result = keepSupportedSentences(
    "Highlights:\n\n1. Grew 38% year over year.\n2. Revenue reached $62.1B in Q4 2026.\n3. Margins held up.",
    DISPLAYED,
  );
  assert.equal(result.text, "Highlights:\n\n2. Revenue reached $62.1B in Q4 2026.\n3. Margins held up.");
  assert.deepEqual(result.removed, ["Grew 38% year over year."]);
});

test("a heading whose whole section was dropped goes with it; one with content stays (#144)", () => {
  const result = keepSupportedSentences(
    "## Revenue\nRevenue reached $62.1B in Q4 2026.\n\n**Growth**\n- Grew 38% year over year.\n\n### Margins\nGrew 38%.",
    DISPLAYED,
  );
  assert.equal(result.text, "## Revenue\nRevenue reached $62.1B in Q4 2026.");
  // A parent stays while a subsection under it keeps content.
  const nested = keepSupportedSentences(
    "## Analysis\n### Growth\nGrew 38%.\n### Revenue\nRevenue reached $62.1B in Q4 2026.\n## Risks\n### Growth\nGrew 38%.",
    DISPLAYED,
  );
  assert.equal(nested.text, "## Analysis\n### Revenue\nRevenue reached $62.1B in Q4 2026.");
  // A bold sentence the guard kept is no empty heading, last line or not.
  for (const text of ["**Revenue reached $62.1B in Q4 2026.**", "**Revenue reached $62.1B in Q4 2026.**\n## Margins\nMargins held up."]) {
    assert.deepEqual(keepSupportedSentences(text, DISPLAYED), { text, removed: [] });
  }
  // Nor goes with a dropped sentence after it.
  assert.equal(
    keepSupportedSentences("**Revenue reached $62.1B in Q4 2026.**\nGrew 38%.", DISPLAYED).text,
    "**Revenue reached $62.1B in Q4 2026.**",
  );
  // Nor a heading that carries a figure the guard kept.
  for (const heading of ["**Revenue: $62.1B**", "## Revenue: $62.1B"]) {
    assert.equal(keepSupportedSentences(`${heading}\nGrew 38%.`, DISPLAYED).text, heading);
  }
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

test("no currency is written with a dotted prefix, so a period always ends a sentence (#150)", () => {
  for (const currency of Intl.supportedValuesOf("currency")) {
    const loss = formatCompactCurrency(-3.1e9, currency);
    assert.doesNotMatch(loss, /\.[\s\u00a0\u202f]/u, `${currency}: ${loss}`);
  }
  // XCG's symbol is "Cg."; it is written as its ISO code, and its amount still compares.
  const loss = formatCompactCurrency(-3.1e9, "XCG");
  assert.match(loss, /^-XCG[\s\u00a0]3\.1B$/u);
  assert.equal(keepSupportedSentences(`Operating income was ${formatCompactCurrency(-8.7e9, "XCG")}.`, [loss]).removed.length, 1);
  assert.deepEqual(keepSupportedSentences(`Operating income was ${loss}.`, [loss]).removed, []);
});

test("prose 'Cg.' ends a sentence even before an amount (#150)", () => {
  // Before #150 a signed "-Cg." plus a no-break space kept this together, so the
  // second clause's figure took NVDA's attribution.
  const figures = [{ company: "NVDA", value: "-Cg.\u00a074.6B" }, { company: "AMD", value: "$49.2B" }];
  const result = keepSupportedSentences("NVDA reports in -Cg.\u00a074.6B was AMD's revenue.", [], figures);
  assert.deepEqual(result.removed, ["74.6B was AMD's revenue."]);
  assert.deepEqual(keepSupportedSentences("NVDA reports in Cg. 74.6% was AMD's margin.", [], COMPARED).removed, ["74.6% was AMD's margin."]);
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

test("a Markdown bullet marker is not a minus sign", () => {
  assert.equal(keepSupportedSentences("- 3.1% revenue growth", ["-3.1%"]).removed.length, 1);
  assert.deepEqual(keepSupportedSentences("- -3.1% revenue growth", ["-3.1%"]).removed, []);
  assert.deepEqual(keepSupportedSentences("- 3.1% revenue growth", ["3.1%"]).removed, []);
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
  // Nor is a positive figure's prefix an attached owner (#144).
  const positive = [{ company: "CHF", value: "CHF 3.1B" }, { company: "AMD", value: "$4.2B" }];
  assert.deepEqual(keepSupportedSentences("CHF's operating income was CHF 3.1B.", [], positive).removed, []);
  assert.equal(keepSupportedSentences("AMD's operating income was CHF 3.1B.", [], positive).removed.length, 1);
  // Written with a plain space by the model, it is still the prefix.
  assert.equal(keepSupportedSentences("AMD's operating income was CHF 3.1B.", [], positive).removed.length, 1);
  assert.equal(keepSupportedSentences("AMD's operating income was CHF  3.1B.", [], positive).removed.length, 1);
  assert.equal(keepSupportedSentences("AMD's operating income was CHF\t3.1B.", [], positive).removed.length, 1);
  // Or with no unit at all ("CHF 999.0").
  const bare = [{ company: "CHF", value: "CHF 999.0" }, { company: "AMD", value: "$4.2B" }];
  assert.equal(keepSupportedSentences("AMD's operating income was CHF 999.0.", [], bare).removed.length, 1);
  // A possessive or "at" ties the label to a figure the prefix doesn't cover.
  const margin = [{ company: "CHF", value: "CHF 3.1B" }, { company: "CHF", value: "49.2%" }, { company: "AMD", value: "74.6%" }];
  const kept = "AMD grew faster, while CHF at 49.2% had the lower margin.";
  assert.deepEqual(keepSupportedSentences(kept, [], margin), { text: kept, removed: [] });
  assert.equal(keepSupportedSentences("AMD grew faster, while CHF at 74.6% had the higher margin.", [], margin).removed.length, 1);
  // Nor a label that is a later word of a compound prefix ("CFA" in "F CFA 3.1B").
  const compound = [{ company: "CFA", value: "F CFA 3.1B" }, { company: "AMD", value: "$4.2B" }];
  assert.deepEqual(keepSupportedSentences("CFA's operating income was F CFA 3.1B.", [], compound).removed, []);
  assert.equal(keepSupportedSentences("AMD's operating income was F CFA 3.1B.", [], compound).removed.length, 1);
  // A prefix only covers the figure it is written on: before another figure the
  // label is the company's own ("CHF 49.2%"), and owns it or not.
  const mixed = [{ company: "CHF", value: "CHF 3.1B" }, { company: "CHF", value: "49.2%" }, { company: "AMD", value: "74.6%" }];
  assert.deepEqual(keepSupportedSentences("Margins: CHF 49.2%, AMD 74.6%.", [], mixed).removed, []);
  assert.equal(keepSupportedSentences("AMD beat CHF 74.6%.", [], mixed).removed.length, 1);
  // Nor a figure of the same value in another unit ("CHF 3.1%" beside "CHF 3.1B").
  const units = [{ company: "CHF", value: "CHF 3.1B" }, { company: "CHF", value: "3.1%" }, { company: "AMD", value: "4.2%" }];
  assert.deepEqual(keepSupportedSentences("Margins: CHF 3.1%, AMD 4.2%.", [], units).removed, []);
  assert.equal(keepSupportedSentences("AMD's operating income was CHF 3.1B.", [], units).removed.length, 1);
});

test("a ticker written right before its figure still owns it (#144)", () => {
  const figures = [{ company: "NVDA", value: "74.6%" }, { company: "AMD", value: "49.2%" }];
  const kept = "Gross margin: NVDA 74.6%, AMD 49.2%.";
  assert.deepEqual(keepSupportedSentences(kept, [], figures), { text: kept, removed: [] });
  assert.equal(keepSupportedSentences("Gross margin: NVDA 49.2%, AMD 74.6%.", [], figures).text, "");
});

test("a company label starting with a digit is still a mention", () => {
  const figures = [{ company: "3M Company", value: "49.2%" }, { company: "NVDA", value: "74.6%" }];
  assert.deepEqual(keepSupportedSentences("3M Company's margin is 49.2%.", [], figures).removed, []);
  assert.equal(keepSupportedSentences("3M Company's margin is 74.6%.", [], figures).removed.length, 1);
});

// From the #144 eval run (docs/eval-runs/research-quality/2026-10-03T144318.md).
const SCALE = [
  { company: "AAPL", value: "$416.2B" },
  { company: "NVDA", value: "$209.9B" },
  { company: "AAPL", value: "6.05%" },
  { company: "NVDA", value: "6.6%" },
];

test("a company owns a currency figure attached to it, past the currency symbol (#144)", () => {
  const kept = "AAPL's strength is absolute scale: $416.2B in revenue versus NVDA's $209.9B.";
  assert.deepEqual(keepSupportedSentences(kept, [], SCALE), { text: kept, removed: [] });
  // The wrong-company twin still goes.
  const swapped = "AAPL's strength is absolute scale: $209.9B in revenue versus NVDA's $416.2B.";
  assert.equal(keepSupportedSentences(swapped, [], SCALE).text, "");
});

test("a company attached to a figure owns it though another is named earlier (#144)", () => {
  const kept = "Despite NVDA's higher margins, the price-return chart shows AAPL at 6.05% and NVDA at 6.6%.";
  assert.deepEqual(keepSupportedSentences(kept, [], SCALE), { text: kept, removed: [] });
  const swapped = "Despite NVDA's higher margins, the price-return chart shows AAPL at 6.6% and NVDA at 6.05%.";
  assert.equal(keepSupportedSentences(swapped, [], SCALE).text, "");
  // Attached to the other company, the figure is not credited to the subject.
  assert.equal(keepSupportedSentences("NVDA beat AAPL at 6.6%.", [], SCALE).text, "");
});

// Turn 3 of the golden conversation in the #194 eval run
// (docs/eval-runs/research-quality/2026-10-04T012140.md): the comparison's
// figures and fiscal years, and the YTD chart's returns, whose window years
// every company shares.
const GOLDEN = [
  ["NVDA", "$209.9B", "Revenue"], ["NVDA", "70.8%", "Gross Margin"], ["NVDA", "53.6%", "Net Margin"], ["NVDA", "FY2026"],
  ["AMD", "$34.7B", "Revenue"], ["AMD", "49.9%", "Gross Margin"], ["AMD", "12.0%", "Net Margin"], ["AMD", "FY2025"],
  ["NVDA", "6.6%", "Price return"], ["NVDA", "YTD 2026: December 2025 close to August 2026 close"],
  ["AMD", "3.58%", "Price return"], ["AMD", "YTD 2026: December 2025 close to August 2026 close"],
  ["NVDA", "60.9%", "Revenue Growth (YoY)"], ["AMD", "34.5%", "Revenue Growth (YoY)"],
  ["NVDA", "52.3x", "P/E"], ["AMD", "41.2x", "P/E"],
].map(([company, value, metric]) => ({ company, value, metric }));

test("a company owns the figure its possessive names through a noun phrase and \"of\" (#240)", () => {
  for (const kept of [
    "NVDA's FY2026 net margin was 53.6% versus AMD's FY2025 net margin of 12.0%.",
    "Gross margin: NVDA's FY2026 gross margin was 70.8% versus AMD's FY2025 gross margin of 49.9%.",
    "Revenue: NVDA's FY2026 (ended January 2026) revenue was $209.9B versus AMD's FY2025 (ended December 2025) revenue of $34.7B.",
    "NVDA beat AMD's net margin of 12.0%.",
    // The metric's label as displayed, punctuation and all.
    "NVDA's revenue growth (YoY) was 60.9% versus AMD's revenue growth (YoY) of 34.5%.",
    "NVDA's P/E was 52.3 versus AMD's P/E of 41.2.",
    "AMD's revenue growth YoY of 34.5% trails.",
  ]) {
    assert.deepEqual(keepSupportedSentences(kept, [], GOLDEN), { text: kept, removed: [] });
  }
  // The wrong-company twins still go.
  for (const dropped of [
    "NVDA's FY2026 net margin was 12.0% versus AMD's FY2025 net margin of 53.6%.",
    "Revenue: NVDA's FY2026 revenue was $34.7B versus AMD's FY2025 revenue of $209.9B.",
    "NVDA beat AMD's net margin of 53.6%.",
    // Not a noun phrase: an article starts a new subject, or another company is named.
    "Unlike AMD's results the company's margin of 12.0% is high.",
    "AMD's margin lags NVDA whose net margin of 12.0% leads.",
    // A pronoun is not part of the company's noun phrase.
    "Versus AMD's growth its net margin of 12.0% looks low.",
    // Nor is a dash, which starts another clause, or a capitalized article or pronoun.
    "NVDA outperformed AMD's results — competitor net margin of 12.0% was stronger.",
    "NVDA outperformed AMD's results – competitor net margin of 12.0% was stronger.",
    "NVDA outperformed AMD's results - competitor net margin of 12.0% was stronger.",
    "NVDA outperformed AMD's results—competitor net margin of 12.0% was stronger.",
    "Unlike AMD's results The company's margin of 12.0% is high.",
    "Versus AMD's growth Its net margin of 12.0% looks low.",
    // A new subject with no article ("this competitor"), or another of the company's metrics.
    "Unlike AMD's results this competitor's net margin of 12.0% is stronger.",
    "NVDA's net margin was 53.6% versus AMD's FY2025 gross margin of 12.0%.",
    // Part of a metric's name could be another metric: Revenue, or Gross Margin.
    "NVDA grew faster versus AMD's revenue of 34.5%.",
    "NVDA's net margin was 53.6% versus AMD's margin of 12.0%.",
  ]) {
    assert.equal(keepSupportedSentences(dropped, [], GOLDEN).text, "", dropped);
  }
  // A ticker that is also a metric word is another company, not part of the phrase.
  const net = [...GOLDEN, { company: "NET", value: "11.0%", metric: "Net Margin" }];
  assert.equal(keepSupportedSentences("AMD's NET margin of 12.0% lags.", [], net).text, "");
});

test("a fiscal year stays its company's when a chart's window shares the calendar year (#244)", () => {
  // Without the chart, the wrong year already goes (#180); with it, it must too.
  for (const figures of [GOLDEN.filter((figure) => figure.metric !== "Price return" && !figure.value.startsWith("YTD")), GOLDEN]) {
    assert.equal(keepSupportedSentences("AMD's FY2026 net margin was 12.0%.", [], figures).text, "");
    assert.equal(keepSupportedSentences("In fiscal 2026, AMD's net margin was 12.0%.", [], figures).text, "");
    for (const label of ["2026 fiscal year", "2026 fiscal-year", "fiscal-year 2026"]) {
      assert.equal(keepSupportedSentences(`AMD's ${label} net margin was 12.0%.`, [], figures).text, "", label);
    }
    const right = "AMD's FY2025 net margin was 12.0%.";
    assert.deepEqual(keepSupportedSentences(right, [], figures), { text: right, removed: [] });
  }
  // The window's years are the chart's, not any company's.
  const window = "NVDA's price return was 6.6% from December 2025 to August 2026.";
  assert.deepEqual(keepSupportedSentences(window, [], GOLDEN), { text: window, removed: [] });
  // A fiscal year still ends the stretch of a figure another company is named for.
  for (const kept of ["NVDA reported FY2026; AMD revenue was $34.7B.", "NVDA reported FY2026 while AMD's FY2025 net margin was 12.0%."]) {
    assert.deepEqual(keepSupportedSentences(kept, [], GOLDEN), { text: kept, removed: [] });
  }
  // A year no company owns is supported in either form.
  assert.deepEqual(keepSupportedSentences("Revenue rose in FY2025.", ["Q2 2025"]).removed, []);
  const shared = [{ company: "NVDA", value: "FY2025" }, { company: "AMD", value: "FY2025" }];
  assert.deepEqual(keepSupportedSentences("Both grew in 2025.", [], shared).removed, []);
});

test("a magnitude comparison in words goes unless the data states it (#228)", () => {
  for (const dropped of [
    // Every figure is shown and credited: only the magnitude is unsupported.
    "NVDA's net margin of 53.6% is more than double AMD's 12.0%.",
    "NVDA's net margin of 53.6% is more than four times AMD's 12.0%.",
    "NVDA is roughly six times AMD's scale.",
    "Data Center is nine-fold the next segment.",
    "Revenue nearly doubled over the period.",
    "Gaming is twice Automotive's size.",
    "About one in eight dollars came from Gaming.",
    // Any count, unhyphenated or in digits, and fractions (#228 review).
    "NVDA is thirteen times AMD's scale.",
    "NVDA is sixfold AMD's scale.",
    "AMD is half as large as NVDA.",
    "AMD is about a third of NVDA's size.",
    "Gaming is two-thirds of the remainder.",
    // Any quantifier: the multiplier's object gives it away (#228 review).
    "AMD's revenue is less than half NVDA's.",
    "NVDA is several times AMD's scale.",
    "NVDA is two and a half times AMD's scale.",
    "NVDA's revenue is many times larger.",
    "Gaming is half of NVDA's remaining revenue.",
    "NVDA is an order of magnitude larger than AMD.",
    "AMD is a tenth of NVDA's size.",
    "Revenue fell by half.",
    "Half of NVDA's revenue came from Gaming.",
    "NVDA's revenue is several times its prior level.",
    "NVDA's revenue exceeds AMD's by a factor of six.",
    "NVDA earned several times what AMD reported.",
    // A displayed figure's value does not license a ratio (#228 review).
    "NVDA is 52.3 times AMD's scale.",
    "Revenue is six times last year's level.",
    "Revenue is six times that reported by AMD.",
    "NVDA's revenue is nearly double AMD's.",
    "NVDA's margin is nearly double.",
    "NVDA's revenue is double AMD's.",
    "NVDA's margin was forty percentage points higher than AMD's.",
    "NVDA's margin was twenty-one points above AMD's.",
    "Six times AMD's revenue would approximate NVDA's.",
    "Several times AMD's scale is still short of NVDA.",
    "Double AMD's revenue would still trail NVDA.",
    "NVDA's gross margin of 70.8% was larger than its entire net margin of 53.6%.",
    "NVDA is 52.3x AMD's scale.",
    "NVDA is 52.3-fold AMD's scale.",
    "NVDA is 52.3× AMD's scale.",
    "Half of total revenue came from Gaming.",
    "NVDA's revenue was fifty percent higher than AMD's.",
    "NVDA's revenue exceeded AMD's by fifty percent.",
    "NVDA's margin is a third higher than AMD's.",
    "NVDA's revenue was six billion dollars more than AMD's.",
    "NVDA's revenue exceeded AMD's by six billion.",
  ]) {
    assert.deepEqual(keepSupportedSentences(dropped, [], GOLDEN).removed, [dropped], dropped);
  }
  for (const kept of [
    // Direction without magnitude, and words that are not comparisons.
    "NVDA's net margin of 53.6% is higher than AMD's 12.0%.",
    "NVDA posted double-digit growth in the second half.",
    // A displayed multiple in digits is a figure, checked by value (#228 review).
    "NVDA's P/E was 52.3x.",
    "NVDA's P/E was 52.3×.",
    "NVDA trades at 52.3 times earnings.",
    "NVDA trades at 52.3 times trailing earnings.",
  ]) {
    assert.deepEqual(keepSupportedSentences(kept, [], GOLDEN).removed, [], kept);
  }
  // A multiple in digits that is not displayed still goes, by the number check.
  assert.equal(keepSupportedSentences("NVDA is 13x AMD's scale.", [], GOLDEN).text, "");
  // Not even a claim licenses one: "AMD's revenue doubled" must not ground
  // "NVDA's revenue doubled" (#228 review). A displayed figure is quoted instead.
  // A worded quantity that is not a difference is not a magnitude.
  assert.deepEqual(keepSupportedSentences("Management expects three million units next quarter.", ["Management expects three million units next quarter."]).removed, []);
  const claimed = "NVDA's revenue doubled.";
  assert.deepEqual(keepSupportedSentences(claimed, ["AMD's revenue doubled year over year"], GOLDEN).removed, [claimed]);
  // And "first half" or "a quarter" of the calendar are not fractions of figures.
  for (const kept of ["Revenue rose in the first half of fiscal 2026.", "Margins fell for a quarter before recovering.", "At times the margin dipped.", "Management cited demand many times.", "Revenue rose in the first half of NVDA's fiscal 2026.", "The second half of AMD's fiscal 2025 was weaker.", "Demand was a key factor of the growth.", "During volatile times the company defended margins.", "At other times the margin dipped.", "Management raised guidance three times.", "Management raised guidance three times this year.", "Management raised guidance three times last year.", "Management raised guidance three times over the last year.", "Revenue improved in the latter half of NVDA's fiscal year.", "The CEO made two points about demand.", "Management doubled down on data-center investment.", "Management is doubling down on AI.", "Management raised guidance twice this year.", "Management raised guidance twice.", "Management reviews guidance twice annually.", "The board meets twice a month.", "Results are reported three times a year.", "Management highlighted the risk of double taxation.", "The chart formed a double bottom.", "The REIT uses triple-net leases."]) {
    assert.deepEqual(keepSupportedSentences(kept, ["fiscal 2026", "fiscal 2025"]).removed, [], kept);
  }
});
