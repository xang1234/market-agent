import assert from "node:assert/strict";
import test from "node:test";
import * as legacy from "../../agents/src/exact-decimal.ts";
import { canonicalDecimalString, parseFinancialDecimal, type ExactDecimal } from "../src/exact-decimal.ts";

// ---------------------------------------------------------------------------
// Compatibility: the agents facade keeps its threshold-write contract.

test("legacy threshold writes stay strict: decimal text or safe-integer numbers only", () => {
  for (const accepted of ["0.1", "0.1000000000000000000001", "9007199254740993", "-12.50", "0", 5, Number.MAX_SAFE_INTEGER]) {
    assert.equal(legacy.isExactThresholdInput(accepted), true, String(accepted));
  }
  for (const rejected of [0.5, 9007199254740993, "1e3", "+1", ".5", "1.", " 1", "NaN", `1.${"1".repeat(101)}`, Number.NaN]) {
    assert.equal(legacy.isExactThresholdInput(rejected), false, String(rejected));
  }
});

test("legacy parse, multiply, and compare keep their semantics", () => {
  assert.deepEqual(legacy.parseExactDecimal("0.1000000000000000000001"), { coefficient: 1000000000000000000001n, scale: 22 });
  assert.deepEqual(legacy.parseExactDecimal("1000"), { coefficient: 1n, scale: -3 });
  assert.deepEqual(legacy.parseExactDecimal("-0"), { coefficient: 0n, scale: 0 });
  assert.deepEqual(legacy.parseExactDecimal(0.5), { coefficient: 5n, scale: 1 });
  assert.equal(legacy.parseExactDecimal(9007199254740993), null);
  assert.equal(legacy.parseExactDecimal("1e3"), null);

  const small = legacy.parseExactDecimal("0.1")!;
  const larger = legacy.parseExactDecimal("0.1000000000000000000001")!;
  assert.equal(legacy.compareExactDecimals(larger, small), 1);
  assert.equal(legacy.compareExactDecimals(small, legacy.parseExactDecimal("0.10")!), 0);

  assert.deepEqual(legacy.multiplyExactDecimals(legacy.parseExactDecimal("1.5")!, legacy.parseExactDecimal("1000")!), { coefficient: 15n, scale: -2 });
  const tiny = legacy.parseExactDecimal(`0.${"0".repeat(98)}1`)!;
  assert.deepEqual(tiny, { coefficient: 1n, scale: 99 });
  assert.equal(legacy.multiplyExactDecimals(tiny, legacy.multiplyExactDecimals(tiny, tiny) ?? tiny), null);
  assert.equal(legacy.exactDecimalNumericToken(legacy.parseExactDecimal("-1.25")!), "number:-125e-2");
});

test("legacy stored fractional thresholds normalize to canonical text", () => {
  assert.equal(legacy.normalizeLegacyExactThreshold(0.0000001), "0.0000001");
  assert.equal(legacy.normalizeLegacyExactThreshold(0.1), "0.1");
  assert.equal(legacy.normalizeLegacyExactThreshold("+.3"), "0.3");
  assert.equal(legacy.normalizeLegacyExactThreshold(Number.MAX_SAFE_INTEGER + 2), null);
});

// ---------------------------------------------------------------------------
// Financial decimals: source tokens preserved exactly.

function parsed(token: string): ExactDecimal {
  const result = parseFinancialDecimal(token);
  assert.equal(result.ok, true, `${token} should parse: ${JSON.stringify(!result.ok && result.reason)}`);
  return (result as { value: ExactDecimal }).value;
}

function canonical(token: string): string {
  return canonicalDecimalString(parsed(token));
}

test("source tokens survive parsing without passing through Number", () => {
  assert.equal(canonical("9007199254740993"), "9007199254740993");
  assert.equal(canonical("-9007199254740993"), "-9007199254740993");
  assert.equal(canonical("0.1000000000000000000001"), "0.1000000000000000000001");
  assert.equal(canonical("1.234567890123456789e+6"), "1234567.890123456789");
  assert.equal(canonical("1.234567890123456789E-3"), "0.001234567890123456789");
  assert.equal(canonical("383285000000"), "383285000000");
  assert.equal(canonical("1.50"), "1.5");
  assert.equal(canonical("100.000"), "100");
});

test("negative zero and zero exponents normalize to 0", () => {
  for (const token of ["-0", "-0.000", "0e10", "0.0e-5", "-0E+3"]) {
    assert.equal(canonical(token), "0", token);
    assert.deepEqual(parsed(token), { coefficient: 0n, scale: 0 });
  }
});

test("malformed tokens fail deterministically", () => {
  for (const token of ["", " 1", "1 ", "1..2", "abc", "Infinity", "NaN", "0x10", "1e", "e5", ".5", "5.", "+", "--1", "01", "1_000", "١٢"]) {
    assert.deepEqual(parseFinancialDecimal(token), { ok: false, reason: "malformed_decimal" }, JSON.stringify(token));
  }
});

test("versioned numeric limits fail before expansion", () => {
  assert.equal(canonical("1e1000").length, 1001);
  assert.equal(canonical("1e-1000"), `0.${"0".repeat(999)}1`);
  for (const token of ["1e1001", "1e-1001", "1e99999999999999999999", "1e-99999999999999999999", "9".repeat(257)]) {
    assert.deepEqual(parseFinancialDecimal(token), { ok: false, reason: "numeric_limit_exceeded" }, token.slice(0, 30));
  }
  assert.equal(canonical("9".repeat(256)), "9".repeat(256));
});
