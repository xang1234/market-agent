import assert from "node:assert/strict";
import test from "node:test";

import { decideCandidate } from "../src/assessment.ts";
import { validateAnalystOutput, validateSkepticOutput } from "../src/assessment-validation.ts";
import { analystFixture, briefFixture, packetFixture, skepticFixture } from "./fixtures.ts";
import type { Brief } from "../src/types.ts";
import type { PacketFact } from "../src/ports.ts";

test("primary evidence is required and missing financials stay unknown", () => {
  const packet = packetFixture();

  const result = decideCandidate(
    briefFixture(),
    { ...packet, excerpts: [] },
    analystFixture(),
    skepticFixture(),
    "2026-09-10T12:00:00Z",
  );

  assert.equal(result.state, "needs_evidence");
  assert.equal(result.dimensions.valuation_context.level, "unknown");
  assert.ok(result.reason_codes.includes("primary_exposure_missing"));
});

test("the validator rejects a citation outside the supplied packet", () => {
  const raw = analystFixture();
  raw.exposure.citations = [{ kind: "claim", id: "90000000-0000-4000-8000-000000000099" }];

  assert.throws(() => validateAnalystOutput(raw, briefFixture(), packetFixture()), /citation/i);
});

test("narrative disagreement leaves a required criterion unknown", () => {
  const analyst = analystFixture();
  const skeptic = skepticFixture();
  skeptic.criteria[0] = { ...skeptic.criteria[0]!, outcome: "fail" };

  const result = decideCandidate(briefFixture(), packetFixture(), analyst, skeptic, "2026-09-10T12:00:00Z");

  assert.equal(result.criteria[0]!.outcome, "unknown");
  assert.equal(result.state, "needs_evidence");
  assert.ok(result.reason_codes.includes("required_criterion_unknown"));
});

test("two evidence-backed required failures exclude a candidate", () => {
  const analyst = analystFixture();
  const skeptic = skepticFixture();
  analyst.criteria[0] = { ...analyst.criteria[0]!, outcome: "fail" };
  skeptic.criteria[0] = { ...skeptic.criteria[0]!, outcome: "fail" };

  const result = decideCandidate(briefFixture(), packetFixture(), analyst, skeptic, "2026-09-10T12:00:00Z");

  assert.equal(result.criteria[0]!.outcome, "fail");
  assert.equal(result.state, "excluded");
  assert.ok(result.reason_codes.includes("required_criterion_failed"));
});

test("the skeptic output requires every brief criterion exactly once", () => {
  const raw = skepticFixture();
  raw.criteria.push({ ...raw.criteria[0]! });

  assert.throws(() => validateSkepticOutput(raw, briefFixture(), packetFixture()), /criterion/i);
});

test("a second current substantive document family strengthens evidence without changing the admission gate", () => {
  const packet = packetFixture();
  packet.excerpts.push({
    ...packet.excerpts[1]!,
    excerpt_id: "a0000000-0000-4000-8000-000000000003",
    document_id: "a1000000-0000-4000-8000-000000000003",
    source_id: "a2000000-0000-4000-8000-000000000003",
    family_key: "independent-secondary-report",
    primary: false,
    primary_eligible: false,
  });
  packet.claims.push({
    claim_id: "b0000000-0000-4000-8000-000000000003",
    document_id: "a1000000-0000-4000-8000-000000000003",
    source_id: "a2000000-0000-4000-8000-000000000003",
    text_canonical: "Independent reporting confirms current grid equipment demand.",
  });
  const skeptic = skepticFixture();
  skeptic.counterarguments[0] = { text: "Independent reporting confirms current grid equipment demand.", citations: [{ kind: "claim", id: "b0000000-0000-4000-8000-000000000003" }] };

  const result = decideCandidate(briefFixture(), packet, analystFixture(), skeptic, "2026-09-10T12:00:00Z");

  assert.equal(result.dimensions.evidence_strength.level, "strong");
});

test("a syndicated copy in the primary family does not inflate evidence strength", () => {
  const packet = packetFixture();
  packet.excerpts[1] = { ...packet.excerpts[1]!, family_key: "candidate-primary" };

  const result = decideCandidate(briefFixture(), packet, analystFixture(), skepticFixture(), "2026-09-10T12:00:00Z");

  assert.equal(result.dimensions.evidence_strength.level, "mixed");
});

test("stale or undated primary evidence cannot satisfy the primary gate", () => {
  for (const changes of [
    { published_at: null, retrieved_at: "2024-01-01T00:00:00.000Z" },
    { published_at: null, retrieved_at: "not-a-date" },
  ]) {
    const packet = packetFixture();
    packet.excerpts[0] = { ...packet.excerpts[0]!, ...changes };
    const result = decideCandidate(briefFixture(), packet, analystFixture(), skepticFixture(), "2026-09-10T12:00:00Z");
    assert.equal(result.state, "needs_evidence");
    assert.ok(result.reason_codes.includes("primary_exposure_missing"));
  }
});

test("a completed counter-search and primary exposure from both independent roles are required", () => {
  const missingCounterSearch = packetFixture();
  missingCounterSearch.counter_search_completed = false;
  const counterSearchResult = decideCandidate(briefFixture(), missingCounterSearch, analystFixture(), skepticFixture(), "2026-09-10T12:00:00Z");
  assert.equal(counterSearchResult.state, "needs_evidence");
  assert.ok(counterSearchResult.reason_codes.includes("counter_search_incomplete"));

  const skeptic = skepticFixture();
  skeptic.exposure = { level: "unknown", explanation: "Primary exposure is not independently confirmed.", citations: [] };
  const skepticResult = decideCandidate(briefFixture(), packetFixture(), analystFixture(), skeptic, "2026-09-10T12:00:00Z");
  assert.equal(skepticResult.state, "needs_evidence");
  assert.ok(skepticResult.reason_codes.includes("primary_exposure_missing"));
});

test("strict role validation rejects fake quotes, unsupported prose numbers, and missing criteria", () => {
  const packet = packetFixture();
  const fakeQuote = analystFixture();
  fakeQuote.exposure = {
    ...fakeQuote.exposure,
    citations: [{ kind: "excerpt", id: packet.excerpts[0]!.excerpt_id, quote: "This fabricated quote is long enough to look plausible." }],
  };
  assert.throws(() => validateAnalystOutput(fakeQuote, briefFixture(), packet), /quote/i);

  const unsupportedNumber = analystFixture();
  unsupportedNumber.exposure = { ...unsupportedNumber.exposure, explanation: "Primary evidence shows 25 percent exposure." };
  assert.throws(() => validateAnalystOutput(unsupportedNumber, briefFixture(), packet), /numerical assertion/i);

  const missing = analystFixture();
  missing.criteria = [];
  assert.throws(() => validateAnalystOutput(missing, briefFixture(), packet), /criterion/i);
});

test("metric criteria use only canonical finite facts with the exact unit, scale, period, currency, and freshness", () => {
  const brief = metricBrief();
  const packet = packetFixture();
  const valid = metricFact();
  packet.facts = [valid];
  const supported = decideCandidate(brief, packet, analystFixture(), skepticFixture(), "2026-09-10T12:00:00Z");
  assert.equal(supported.criteria[0]!.outcome, "pass");
  assert.deepEqual(supported.criteria[0]!.citations, [{ kind: "fact", id: valid.fact_id }]);

  for (const invalid of [
    { ...valid, currency: "EUR" },
    { ...valid, unit: "ratio" },
    { ...valid, scale: Number.POSITIVE_INFINITY },
    { ...valid, value_num: Number.NaN },
    { ...valid, period_kind: "fiscal_q" },
    { ...valid, period_end: null },
    { ...valid, period_end: "2025-01-01T00:00:00.000Z" },
  ]) {
    const invalidPacket = packetFixture();
    invalidPacket.facts = [invalid];
    const result = decideCandidate(brief, invalidPacket, analystFixture(), skepticFixture(), "2026-09-10T12:00:00Z");
    assert.equal(result.criteria[0]!.outcome, "unknown");
    assert.equal(result.state, "needs_evidence");
  }
});

test("numerical prose may refer to the cited fact's canonical period and observation dates", () => {
  const packet = packetFixture();
  const fact = metricFact();
  packet.facts = [fact];
  const raw = analystFixture();
  raw.exposure = {
    level: "strong",
    explanation: "The FY 2026 observation dated 2026-09-01 supports exposure.",
    citations: [{ kind: "fact", id: fact.fact_id }],
  };

  assert.doesNotThrow(() => validateAnalystOutput(raw, briefFixture(), packet));
});

test("numerical prose requires complete evidence tokens rather than numeric substrings", () => {
  const packet = packetFixture();
  const fact = metricFact();
  packet.facts = [fact];
  const dateSubstring = analystFixture();
  dateSubstring.exposure = {
    level: "strong",
    explanation: "The cited observation supports 2 units of exposure.",
    citations: [{ kind: "fact", id: fact.fact_id }],
  };
  assert.throws(() => validateAnalystOutput(dateSubstring, briefFixture(), packet), /numerical assertion/i);

  const claimId = "d0000000-0000-4000-8000-000000000001";
  packet.claims.push({
    claim_id: claimId,
    document_id: packet.excerpts[0]!.document_id,
    source_id: packet.excerpts[0]!.source_id,
    text_canonical: "The report measured 125 units of grid equipment sales.",
  });
  const textSubstring = analystFixture();
  textSubstring.exposure = {
    level: "strong",
    explanation: "The report measured 25 units of grid equipment sales.",
    citations: [{ kind: "claim", id: claimId }],
  };
  assert.throws(() => validateAnalystOutput(textSubstring, briefFixture(), packet), /numerical assertion/i);
});

test("numerical prose preserves signed, decimal, grouped, and date literal boundaries", () => {
  const packet = packetFixture();
  const claimId = "d0000000-0000-4000-8000-000000000002";
  packet.claims.push({
    claim_id: claimId,
    document_id: packet.excerpts[0]!.document_id,
    source_id: packet.excerpts[0]!.source_id,
    text_canonical: "The report recorded +1.25, 1,000.50, and 2026-09-01.",
  });
  const output = (explanation: string) => {
    const raw = analystFixture();
    raw.exposure = {
      level: "strong",
      explanation,
      citations: [{ kind: "claim", id: claimId }],
    };
    return raw;
  };

  assert.doesNotThrow(() => validateAnalystOutput(output("The report recorded +1.25, 1,000.50, and 2026-09-01."), briefFixture(), packet));
  assert.doesNotThrow(() => validateAnalystOutput(output("The report recorded 1.25, 1000.50, and 2026-09-01."), briefFixture(), packet));
  assert.throws(() => validateAnalystOutput(output("The report recorded 1, 1,000.50, and 2026-09-01."), briefFixture(), packet), /numerical assertion/i);
  assert.throws(() => validateAnalystOutput(output("The report recorded -1.25, 1,000.50, and 2026-09-01."), briefFixture(), packet), /numerical assertion/i);
  assert.throws(() => validateAnalystOutput(output("The report recorded +1.25, 1,000.50, and 2026-9-1."), briefFixture(), packet), /numerical assertion/i);
});

function metricBrief(): Brief {
  const brief = briefFixture();
  brief.criteria[0] = {
    ...brief.criteria[0]!,
    metric: { metric_key: "revenue", unit: "USD", period_kind: "fiscal_y", operator: "gte", threshold: 1_000, max_age_days: 90 },
  };
  return brief;
}

function metricFact(): PacketFact {
  return {
    fact_id: "c0000000-0000-4000-8000-000000000001",
    metric_key: "revenue",
    value_num: 1,
    scale: 1_000,
    unit: "USD",
    period_kind: "fiscal_y",
    period_end: "2026-08-31T00:00:00.000Z",
    as_of: "2026-09-01T00:00:00.000Z",
    source_id: "a2000000-0000-4000-8000-000000000001",
    currency: "USD",
    fiscal_year: 2026,
    fiscal_period: "FY",
    period_start: "2025-09-01T00:00:00.000Z",
  };
}
