import assert from "node:assert/strict";
import test from "node:test";
import type { DerivationProofV1 } from "../src/contracts.ts";
import { derivationIssue, type DerivedFact } from "../src/derivation.ts";

const OWN = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const EARLIER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

type Term = DerivationProofV1["terms"][number];

function term(sign: "+" | "-", fiscal_period: Term["fiscal_period"], start: string, end: string, raw_token: string, filed: string, source_id = EARLIER): Term {
  return {
    sign,
    span: fiscal_period === "FY" ? "fiscal_year" : "quarter",
    fiscal_year: 2024,
    fiscal_period,
    start,
    end,
    raw_token,
    token_proof_hash: "c".repeat(64),
    source: { source_id, accession: `0001234567-24-${fiscal_period}`, form: fiscal_period === "FY" ? "10-K" : "10-Q", filed, locator: `loc:${fiscal_period}` },
  };
}

const proof = (terms: Term[]): DerivationProofV1 => ({ version: "period_difference.v1", concept: "Revenues", unit: "USD", terms });

const YEAR = term("+", "FY", "2024-01-01", "2024-12-31", "620", "2025-02-15", OWN);
const Q1 = term("-", "Q1", "2024-01-01", "2024-03-31", "140", "2024-05-01");
const Q2 = term("-", "Q2", "2024-04-01", "2024-06-30", "150", "2024-08-01");
const Q3 = term("-", "Q3", "2024-07-01", "2024-09-30", "160", "2024-11-01");
const FOURTH = proof([YEAR, Q1, Q2, Q3]);
const Q4_FACT: DerivedFact = { value_kind: "flow", source_id: OWN, value_text: "170", period: { start: "2024-10-01", end: "2024-12-31", fiscal_year: 2024 } };

test("a fourth quarter is its year less the first three quarters (#481)", () => {
  assert.equal(derivationIssue(FOURTH, Q4_FACT), null);
  assert.equal(derivationIssue(FOURTH, { ...Q4_FACT, source_id: OWN.toUpperCase() }), null, "source ids compare as uuids");
});

test("a cash-flow quarter is its year to date less the previous one (#481)", () => {
  const sixMonths = { ...term("+", "Q2", "2024-01-01", "2024-06-30", "290", "2024-08-01", OWN), span: "year_to_date" as const };
  const fact: DerivedFact = { value_kind: "flow", source_id: OWN, value_text: "150", period: { start: "2024-04-01", end: "2024-06-30", fiscal_year: 2024 } };
  assert.equal(derivationIssue(proof([sixMonths, Q1]), fact), null);
});

test("subtracted terms tile in any order (#481)", () => {
  assert.equal(derivationIssue(proof([YEAR, Q3, Q1, Q2]), Q4_FACT), null);
});

test("each way a derivation can fail to prove its fact is named (#481)", () => {
  const nineMonths = { ...term("-", "Q3", "2024-01-01", "2024-09-30", "450", "2024-11-01"), span: "year_to_date" as const };
  const ends = term("-", "Q3", "2024-10-01", "2024-09-30", "-30", "2024-11-01");
  const cases: Array<[string, unknown, DerivedFact]> = [
    ["not_a_flow", FOURTH, { ...Q4_FACT, value_kind: "per_share" }],
    ["not_a_flow", FOURTH, { ...Q4_FACT, value_kind: null }],
    ["invalid_derivation", { ...FOURTH, version: "period_difference.v0" }, Q4_FACT],
    ["own_term_sign", proof([{ ...YEAR, sign: "-" }, Q1, Q2, Q3]), Q4_FACT],
    ["own_term_sign", proof([YEAR, Q1, { ...Q2, sign: "+" }, Q3]), Q4_FACT],
    ["own_term_source", FOURTH, { ...Q4_FACT, source_id: EARLIER }],
    ["own_term_end", FOURTH, { ...Q4_FACT, period: { ...Q4_FACT.period, end: "2024-12-30" } }],
    ["periods_not_contiguous", FOURTH, { ...Q4_FACT, period: { ...Q4_FACT.period, start: null } }],
    ["periods_not_contiguous", proof([YEAR, Q1, Q1, Q3]), { ...Q4_FACT, value_text: "180" }],
    ["periods_not_contiguous", proof([YEAR, Q1, { ...Q3, raw_token: "310" }]), Q4_FACT],
    ["periods_not_contiguous", proof([YEAR, nineMonths, ends]), { ...Q4_FACT, value_text: "200" }],
    ["fiscal_year_mismatch", proof([YEAR, Q1, { ...Q2, fiscal_year: 2023 }, Q3]), Q4_FACT],
    ["value_mismatch", FOURTH, { ...Q4_FACT, value_text: "171" }],
    ["value_mismatch", FOURTH, { ...Q4_FACT, value_text: null }],
    ["own_term_not_last_filed", proof([YEAR, Q1, Q2, { ...Q3, source: { ...Q3.source, filed: "2025-02-15" } }]), Q4_FACT],
  ];
  for (const [issue, derivation, fact] of cases) {
    assert.equal(derivationIssue(derivation, fact), issue, JSON.stringify([derivation, fact]));
  }
});
