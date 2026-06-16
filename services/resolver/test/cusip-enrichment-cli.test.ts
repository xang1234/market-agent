import test from "node:test";
import assert from "node:assert/strict";
import { parseCusipArgs } from "../src/cusip-enrichment-cli.ts";

test("parseCusipArgs uppercases, trims, and de-dupes CUSIPs", () => {
  assert.deepEqual(parseCusipArgs([" 037833100 ", "02005n100", "037833100"]), ["037833100", "02005N100"]);
});

test("parseCusipArgs throws on a malformed CUSIP", () => {
  assert.throws(() => parseCusipArgs(["037833100", "12345"]), /invalid CUSIP/i);
  assert.throws(() => parseCusipArgs(["0378331000"]), /invalid CUSIP/i); // 10 chars
});

test("parseCusipArgs returns an empty list for no args", () => {
  assert.deepEqual(parseCusipArgs([]), []);
});
