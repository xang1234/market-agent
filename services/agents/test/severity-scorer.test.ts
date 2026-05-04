import assert from "node:assert/strict";
import test from "node:test";

import {
  SeverityScoringValidationError,
  scoreFindingSeverity,
} from "../src/severity-scorer.ts";

test("scoreFindingSeverity maps weak low-relevance evidence to low severity with explainable components", () => {
  const result = scoreFindingSeverity({
    evidence: { trust_tier: "tertiary", corroborating_source_count: 0, confidence: 0.45 },
    impact: { direction: "unknown", channel: "sentiment", horizon: "long_term", confidence: 0.25 },
    thesis_relevance: 0.2,
  });

  assert.equal(result.severity, "low");
  assert.equal(result.score, 0.3);
  assert.deepEqual(result.components, {
    evidence: 0.29,
    impact: 0.38,
    thesis_relevance: 0.2,
  });
  assert.match(result.explanation, /low/i);
  assert.equal(Object.isFrozen(result), true);
});

test("scoreFindingSeverity maps secondary corroborated medium-term impact to medium severity", () => {
  const result = scoreFindingSeverity({
    evidence: { trust_tier: "secondary", corroborating_source_count: 1, confidence: 0.72 },
    impact: { direction: "mixed", channel: "competition", horizon: "medium_term", confidence: 0.65 },
    thesis_relevance: 0.58,
  });

  assert.equal(result.severity, "medium");
  assert.equal(result.score, 0.66);
});

test("scoreFindingSeverity maps primary near-term demand impact to high severity", () => {
  const result = scoreFindingSeverity({
    evidence: { trust_tier: "primary", corroborating_source_count: 1, confidence: 0.86 },
    impact: { direction: "positive", channel: "demand", horizon: "near_term", confidence: 0.82 },
    thesis_relevance: 0.76,
  });

  assert.equal(result.severity, "high");
  assert.equal(result.score, 0.85);
});

test("scoreFindingSeverity maps highly corroborated thesis-critical impact to critical severity", () => {
  const result = scoreFindingSeverity({
    evidence: { trust_tier: "primary", corroborating_source_count: 3, confidence: 0.94 },
    impact: { direction: "negative", channel: "balance_sheet", horizon: "near_term", confidence: 0.96 },
    thesis_relevance: 0.95,
  });

  assert.equal(result.severity, "critical");
  assert.equal(result.score, 0.95);
  assert.deepEqual(result.components, {
    evidence: 0.95,
    impact: 0.95,
    thesis_relevance: 0.95,
  });
});

test("scoreFindingSeverity rejects out-of-range confidence and unknown enum values", () => {
  assert.throws(
    () =>
      scoreFindingSeverity({
        evidence: { trust_tier: "primary", corroborating_source_count: 1, confidence: 1.2 },
        impact: { direction: "positive", channel: "demand", horizon: "near_term", confidence: 0.8 },
        thesis_relevance: 0.8,
      }),
    SeverityScoringValidationError,
  );
  assert.throws(
    () =>
      scoreFindingSeverity({
        evidence: { trust_tier: "primary", corroborating_source_count: -1, confidence: 0.8 },
        impact: { direction: "positive", channel: "demand", horizon: "near_term", confidence: 0.8 },
        thesis_relevance: 0.8,
      }),
    SeverityScoringValidationError,
  );
  assert.throws(
    () =>
      scoreFindingSeverity({
        evidence: { trust_tier: "blog" as "primary", corroborating_source_count: 1, confidence: 0.8 },
        impact: { direction: "positive", channel: "demand", horizon: "near_term", confidence: 0.8 },
        thesis_relevance: 0.8,
      }),
    SeverityScoringValidationError,
  );
});
