import test from "node:test";
import assert from "node:assert/strict";
import { SUPERINVESTOR_FILERS, isSuperinvestorFiler, superinvestorName } from "../src/superinvestor-filers.ts";

test("registry is non-empty and keyed by zero-padded 10-digit CIKs", () => {
  assert.ok(SUPERINVESTOR_FILERS.size > 0);
  for (const cik of SUPERINVESTOR_FILERS.keys()) {
    assert.match(cik, /^\d{10}$/, `${cik} should be a zero-padded 10-digit CIK`);
  }
});

test("isSuperinvestorFiler matches a seeded filer by bare or padded CIK", () => {
  assert.equal(isSuperinvestorFiler(1067983), true, "Berkshire, bare integer");
  assert.equal(isSuperinvestorFiler(0o0), false); // 0 → not seeded
  assert.equal(isSuperinvestorFiler(999999999), false, "unknown filer");
});

test("superinvestorName returns the display name or null", () => {
  assert.equal(superinvestorName(1067983), "Berkshire Hathaway Inc");
  assert.equal(superinvestorName(999999999), null);
});
