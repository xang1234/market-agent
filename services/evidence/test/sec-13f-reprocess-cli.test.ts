import test from "node:test";
import assert from "node:assert/strict";

import { parseFilerCikArgs } from "../src/sec-13f-reprocess-cli.ts";
import { SUPERINVESTOR_FILERS } from "../src/superinvestor-filers.ts";

test("parseFilerCikArgs defaults to every seeded superinvestor filer when no args are given", () => {
  const ciks = parseFilerCikArgs([]);
  assert.equal(ciks.length, SUPERINVESTOR_FILERS.size);
  // Berkshire (CIK 1067983, stored zero-padded) is parsed back to its bare integer.
  assert.ok(ciks.includes(1067983));
});

test("parseFilerCikArgs parses, de-dupes, and trims explicit CIKs", () => {
  assert.deepEqual(parseFilerCikArgs(["1067983", " 1649339 ", "1067983"]), [1067983, 1649339]);
});

test("parseFilerCikArgs rejects a non-integer or non-positive CIK", () => {
  assert.throws(() => parseFilerCikArgs(["1067983", "abc"]), /invalid CIK/);
  assert.throws(() => parseFilerCikArgs(["0"]), /invalid CIK/);
  assert.throws(() => parseFilerCikArgs(["-5"]), /invalid CIK/);
});
