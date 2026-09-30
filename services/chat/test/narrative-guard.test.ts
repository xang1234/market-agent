import assert from "node:assert/strict";
import test from "node:test";

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

test("a comparison figure with no company named is removed, unless the line already named one", () => {
  assert.equal(keepSupportedSentences("Gross margin is 74.6%.", [], COMPARED).removed.length, 1);
  const carried = keepSupportedSentences("NVDA leads on margins. Its gross margin is 74.6%.", [], COMPARED);
  assert.deepEqual(carried.removed, []);
});

test("company labels match exactly, so an ordinary word is not a ticker", () => {
  const withTickerA = [{ company: "A", value: "74.6%" }, { company: "AMD", value: "49.2%" }];
  assert.equal(keepSupportedSentences("AMD has a 74.6% margin.", [], withTickerA).removed.length, 1);
  assert.deepEqual(keepSupportedSentences("A has a 74.6% margin.", [], withTickerA).removed, []);
});

test("a figure with more than one company named before it is ambiguous and removed", () => {
  assert.equal(keepSupportedSentences("AMD's margin, unlike NVDA, is 74.6%.", [], COMPARED).removed.length, 1);
  assert.equal(keepSupportedSentences("Unlike AMD, NVDA's margin is 74.6%.", [], COMPARED).removed.length, 1);
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

test("a 'respectively' sentence pairs companies with figures in order", () => {
  assert.deepEqual(
    keepSupportedSentences("NVDA and AMD had gross margins of 74.6% and 49.2%, respectively.", [], COMPARED).removed,
    [],
  );
  assert.equal(
    keepSupportedSentences("AMD and NVDA had gross margins of 74.6% and 49.2%, respectively.", [], COMPARED).removed.length,
    1,
  );
});

test("a sentence naming several companies passes none on to the next", () => {
  const result = keepSupportedSentences("NVDA trails AMD. Its gross margin is 49.2%.", [], COMPARED);
  assert.deepEqual(result.removed, ["Its gross margin is 49.2%."]);
  // One company named: it carries.
  assert.deepEqual(keepSupportedSentences("AMD trails. Its gross margin is 49.2%.", [], COMPARED).removed, []);
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
