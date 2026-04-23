import test from "node:test";
import assert from "node:assert/strict";
import { normalize } from "../src/normalize.ts";

test("trims whitespace and uppercases the ticker candidate when input has no internal whitespace", () => {
  for (const input of ["aapl", "AAPL", "  aapl  ", "Aapl"]) {
    const n = normalize(input);
    assert.equal(n.ticker_candidate, "AAPL", `expected AAPL for ${JSON.stringify(input)}`);
    assert.equal(n.name_candidate, "aapl");
  }
});

test("GOOG and GOOGL never collapse — the bead's central invariant", () => {
  const goog = normalize("GOOG");
  const googl = normalize("GOOGL");

  assert.notEqual(goog.ticker_candidate, googl.ticker_candidate);
  assert.notEqual(goog.name_candidate, googl.name_candidate);
  assert.equal(goog.ticker_candidate, "GOOG");
  assert.equal(googl.ticker_candidate, "GOOGL");
});

test("share-class suffixes are preserved distinctly (BRK.A vs BRK.B)", () => {
  const brkA = normalize("BRK.A");
  const brkB = normalize("BRK.B");

  assert.equal(brkA.ticker_candidate, "BRK.A");
  assert.equal(brkB.ticker_candidate, "BRK.B");
  assert.notEqual(brkA.ticker_candidate, brkB.ticker_candidate);
});

test("name normalization strips punctuation and collapses whitespace but preserves letters and digits", () => {
  const n = normalize("  Apple Inc.  ");
  assert.equal(n.name_candidate, "apple inc");
  assert.equal(n.ticker_candidate, undefined, "whitespace in trimmed form disables ticker_candidate");
});

test("input with internal whitespace has no ticker_candidate", () => {
  const n = normalize("Alphabet Inc");
  assert.equal(n.ticker_candidate, undefined);
  assert.equal(n.name_candidate, "alphabet inc");
});

test("empty and whitespace-only inputs produce empty name_candidate and no ticker_candidate", () => {
  for (const input of ["", "   ", "\t\n"]) {
    const n = normalize(input);
    assert.equal(n.ticker_candidate, undefined);
    assert.equal(n.name_candidate, "");
    assert.equal(n.identifier_hint, undefined);
  }
});

test("unicode letters survive name normalization (does not strip accented characters)", () => {
  const n = normalize("Société Générale");
  assert.equal(n.name_candidate, "société générale");
});

test("CIK pattern: any 1-10 digit string becomes a cik hint with leading zeros stripped", () => {
  assert.deepEqual(normalize("320193").identifier_hint, { kind: "cik", value: "320193" });
  assert.deepEqual(normalize("0000320193").identifier_hint, { kind: "cik", value: "320193" });
  assert.deepEqual(normalize("1").identifier_hint, { kind: "cik", value: "1" });
  assert.deepEqual(normalize("0").identifier_hint, { kind: "cik", value: "0" });
});

test("CIK padding variants normalize to the same hint so issuer lookup doesn't see duplicates", () => {
  const a = normalize("320193").identifier_hint;
  const b = normalize("0000320193").identifier_hint;
  assert.deepEqual(a, b);
});

test("11+ digit strings are not CIKs", () => {
  assert.equal(normalize("12345678901").identifier_hint, undefined);
});

test("ISIN pattern: 2 letters + 9 alphanumeric + 1 digit becomes an isin hint (case-folded)", () => {
  assert.deepEqual(normalize("US0378331005").identifier_hint, {
    kind: "isin",
    value: "US0378331005",
  });
  assert.deepEqual(normalize("us0378331005").identifier_hint, {
    kind: "isin",
    value: "US0378331005",
  });
});

test("LEI pattern: 20 alphanumeric characters becomes a lei hint (case-folded)", () => {
  // Apple Inc. LEI.
  assert.deepEqual(normalize("HWUPKR0MPOU8FGXBT394").identifier_hint, {
    kind: "lei",
    value: "HWUPKR0MPOU8FGXBT394",
  });
  assert.deepEqual(normalize("hwupkr0mpou8fgxbt394").identifier_hint, {
    kind: "lei",
    value: "HWUPKR0MPOU8FGXBT394",
  });
});

test("each identifier pattern classifies to its own kind", () => {
  // CIK is pure digits; ISIN requires two leading letters; LEI is 20 chars.
  assert.equal(normalize("US0378331005").identifier_hint?.kind, "isin");
  assert.equal(normalize("HWUPKR0MPOU8FGXBT394").identifier_hint?.kind, "lei");
  assert.equal(normalize("320193").identifier_hint?.kind, "cik");
});

test("ticker-shaped input that also matches an identifier pattern surfaces both signals", () => {
  // "AAPL" does not match any identifier pattern, but an input like a 20-char
  // ticker (hypothetical) with no whitespace should still have ticker_candidate.
  const n = normalize("HWUPKR0MPOU8FGXBT394");
  assert.equal(n.ticker_candidate, "HWUPKR0MPOU8FGXBT394");
  assert.equal(n.identifier_hint?.kind, "lei");
});

test("punctuation-bearing input like 'AAPL,' preserves the comma in ticker_candidate", () => {
  // ticker_candidate is deliberately permissive: it preserves every non-whitespace
  // character case-folded. "AAPL," won't match listings.ticker and will fall
  // through to name_candidate matching; this is intentional graceful failure,
  // not a bug. Pinning behavior so a future edit doesn't silently strip
  // punctuation here and start collapsing share-class suffixes.
  const n = normalize("AAPL,");
  assert.equal(n.ticker_candidate, "AAPL,");
  assert.equal(n.name_candidate, "aapl");
});

test("bead verification premise: 'google' normalizes to a form that can feed issuer, GOOG, and GOOGL matching paths", () => {
  const n = normalize("google");
  assert.equal(n.name_candidate, "google", "issuer/alias matching uses name_candidate");
  assert.equal(n.ticker_candidate, "GOOGLE", "ticker lookup tries 'GOOGLE' and finds nothing");
  assert.equal(n.identifier_hint, undefined, "not an identifier-shaped input");
  // The resolver wiring in 3.3 runs matches against all three axes and
  // surfaces whatever hits — that is what produces the three separate
  // candidates (issuer Alphabet via alias, listing GOOG, listing GOOGL).
});
