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
