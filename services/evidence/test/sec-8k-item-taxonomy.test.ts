import test from "node:test";
import assert from "node:assert/strict";

import {
  classify8kItems,
  itemCodeForDescription,
  extract8kItemCodesFromHeader,
} from "../src/sec-8k-item-taxonomy.ts";

test("classify8kItems maps recognized codes to their event type (claimable)", () => {
  assert.deepEqual(classify8kItems(["5.02"]), [
    { itemCode: "5.02", eventType: "officer_change", claimable: true },
  ]);
  assert.deepEqual(classify8kItems(["1.03"]), [
    { itemCode: "1.03", eventType: "bankruptcy", claimable: true },
  ]);
  assert.deepEqual(classify8kItems(["4.02"]), [
    { itemCode: "4.02", eventType: "restatement", claimable: true },
  ]);
});

test("classify8kItems excludes 9.01 from claims but still emits an event", () => {
  assert.deepEqual(classify8kItems(["9.01"]), [
    { itemCode: "9.01", eventType: "material_event", claimable: false },
  ]);
});

test("classify8kItems falls back to material_event (claimable) for an unknown code", () => {
  assert.deepEqual(classify8kItems(["7.01"]), [
    { itemCode: "7.01", eventType: "material_event", claimable: true },
  ]);
});

test("classify8kItems de-dupes repeated codes, preserving first-seen order", () => {
  const out = classify8kItems(["5.02", "9.01", "5.02"]);
  assert.deepEqual(out.map((c) => c.itemCode), ["5.02", "9.01"]);
});

test("itemCodeForDescription maps canonical SEC titles to codes (whitespace/case tolerant)", () => {
  assert.equal(itemCodeForDescription("Results of Operations and Financial Condition"), "2.02");
  assert.equal(itemCodeForDescription("  financial   statements and exhibits "), "9.01");
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

test("extract8kItemCodesFromHeader reads ITEM INFORMATION descriptions into codes", () => {
  assert.deepEqual(extract8kItemCodesFromHeader(REAL_HEADER), ["2.02", "9.01"]);
});

test("extract8kItemCodesFromHeader keeps an unknown-description sentinel (no silent drop)", () => {
  const header = `<SEC-HEADER>
ITEM INFORMATION:		Regulation FD Disclosure
</SEC-HEADER>`;
  const codes = extract8kItemCodesFromHeader(header);
  assert.equal(codes.length, 1, "one item retained");
  // Unknown description → a sentinel code that classify8kItems treats as material_event.
  assert.equal(classify8kItems(codes)[0]!.eventType, "material_event");
  assert.equal(classify8kItems(codes)[0]!.claimable, true);
});

test("extract8kItemCodesFromHeader returns [] when the header has no ITEM INFORMATION", () => {
  assert.deepEqual(extract8kItemCodesFromHeader("<SEC-HEADER>\nCONFORMED SUBMISSION TYPE:\t8-K\n</SEC-HEADER>"), []);
});
