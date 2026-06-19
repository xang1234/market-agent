import test from "node:test";
import assert from "node:assert/strict";

import { classify8kItems, classify8kHeader, itemCodeForDescription, parseFiledAsOfDate } from "../src/sec-8k-item-taxonomy.ts";

test("parseFiledAsOfDate reads the SEC-HEADER filing date as ISO, or null when absent/invalid", () => {
  const header = `<SEC-DOCUMENT>0000320193-26-000080.txt : 20260315
<SEC-HEADER>
ACCESSION NUMBER:\t\t0000320193-26-000080
CONFORMED SUBMISSION TYPE:\t8-K
FILED AS OF DATE:\t\t20260315
DATE AS OF CHANGE:\t\t20260315
</SEC-HEADER>`;
  assert.equal(parseFiledAsOfDate(header), "2026-03-15");
  assert.equal(parseFiledAsOfDate("no header here"), null);
  // Shape-valid but non-calendar date is rejected (not surfaced as a bad event date).
  assert.equal(parseFiledAsOfDate("FILED AS OF DATE:\t\t20261345"), null);
});

test("classify8kItems maps recognized codes to their event type (claimable)", () => {
  assert.deepEqual(classify8kItems(["5.02"]), [
    { itemCode: "5.02", itemDescription: null, eventType: "officer_change", claimable: true },
  ]);
  assert.deepEqual(classify8kItems(["1.03"]), [
    { itemCode: "1.03", itemDescription: null, eventType: "bankruptcy", claimable: true },
  ]);
  assert.deepEqual(classify8kItems(["4.02"]), [
    { itemCode: "4.02", itemDescription: null, eventType: "restatement", claimable: true },
  ]);
});

test("classify8kItems excludes 9.01 from claims but still emits an event", () => {
  assert.deepEqual(classify8kItems(["9.01"]), [
    { itemCode: "9.01", itemDescription: null, eventType: "material_event", claimable: false },
  ]);
});

test("classify8kItems falls back to a claimable material_event for a recognized-but-untyped code", () => {
  assert.deepEqual(classify8kItems(["7.01"]), [
    { itemCode: "7.01", itemDescription: null, eventType: "material_event", claimable: true },
  ]);
});

test("classify8kItems de-dupes repeated codes, preserving first-seen order", () => {
  const out = classify8kItems(["5.02", "9.01", "5.02"]);
  assert.deepEqual(out.map((c) => c.itemCode), ["5.02", "9.01"]);
});

test("itemCodeForDescription maps canonical SEC titles to codes (whitespace/case tolerant)", () => {
  assert.equal(itemCodeForDescription("Results of Operations and Financial Condition"), "2.02");
  assert.equal(itemCodeForDescription("  financial   statements and exhibits "), "9.01");
  assert.equal(itemCodeForDescription("Regulation FD Disclosure"), "7.01");
  assert.equal(
    itemCodeForDescription("Departure of Directors or Certain Officers; Election of Directors; Appointment of Certain Officers"),
    "5.02",
  );
  assert.equal(itemCodeForDescription("Some Title We Do Not Recognize"), null);
});

// The real Apple 8-K header (acc 0000320193-26-000011) — items 2.02 + 9.01.
const REAL_HEADER = `<SEC-DOCUMENT>0000320193-26-000011.txt : 20260430
<SEC-HEADER>0000320193-26-000011.hdr.sgml : 20260430
ACCESSION NUMBER:		0000320193-26-000011
CONFORMED SUBMISSION TYPE:	8-K
ITEM INFORMATION:		Results of Operations and Financial Condition
ITEM INFORMATION:		Financial Statements and Exhibits
FILED AS OF DATE:		20260430
</SEC-HEADER>
<DOCUMENT><TYPE>8-K</DOCUMENT>
</SEC-DOCUMENT>`;

test("classify8kHeader resolves ITEM INFORMATION descriptions to coded classifications", () => {
  assert.deepEqual(classify8kHeader(REAL_HEADER), [
    { itemCode: "2.02", itemDescription: null, eventType: "guidance_update", claimable: true },
    { itemCode: "9.01", itemDescription: null, eventType: "material_event", claimable: false },
  ]);
});

test("classify8kHeader records an unrecognized title as a null-code material event (no sentinel string)", () => {
  const header = `<SEC-HEADER>
ITEM INFORMATION:		Some Brand New Item Type
</SEC-HEADER>`;
  assert.deepEqual(classify8kHeader(header), [
    { itemCode: null, itemDescription: "Some Brand New Item Type", eventType: "material_event", claimable: true },
  ]);
});

test("classify8kHeader returns [] when the header has no ITEM INFORMATION", () => {
  assert.deepEqual(classify8kHeader("<SEC-HEADER>\nCONFORMED SUBMISSION TYPE:\t8-K\n</SEC-HEADER>"), []);
});
