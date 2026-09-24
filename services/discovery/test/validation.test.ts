import assert from "node:assert/strict";
import test from "node:test";

import { parseBrief, parseStoredBrief, validateModelRequest } from "../src/validation.ts";
import { briefFixture, packetFixture, skepticFixture } from "./fixtures.ts";

test("briefs reject unsupported scope and model requests enforce approved ceilings", () => {
  assert.throws(() => parseBrief({ ...briefFixture(), market: "global" }));
  assert.throws(() => parseBrief({ ...briefFixture(), mechanisms: [] }));
  assert.throws(() => validateModelRequest([{ role: "user", content: "x".repeat(64_000) }], 10_000));
  assert.doesNotThrow(() => validateModelRequest([{ role: "user", content: "x".repeat(63_900) }], 10_000));
  assert.throws(() => validateModelRequest([{ role: "user", content: "ok" }], 10_001));
});

test("brief parsing rejects undeclared IDs and unknown JSON keys", () => {
  assert.throws(() => parseBrief({
    ...briefFixture(),
    queries: [{ mechanism_id: "40000000-0000-4000-8000-000000000099", query: "Unknown mechanism" }],
  }));
  assert.throws(() => parseBrief({ ...briefFixture(), extra: true }));
});

test("stored briefs normalize legacy fractional thresholds before evaluation", () => {
  const brief = briefFixture();
  brief.criteria[0]!.metric = {
    metric_key: "revenue_growth_yoy",
    unit: "ratio",
    period_kind: "fiscal_q",
    operator: "lte",
    threshold: 0.0000001,
    max_age_days: 90,
  };

  assert.throws(() => parseBrief(brief), /threshold/i);
  assert.equal(parseStoredBrief(brief).criteria[0]?.metric?.threshold, "0.0000001");
});

test("skeptic fixture cites its separate risk claim", () => {
  const packet = packetFixture();
  const riskExcerpt = packet.excerpts.find((excerpt) => excerpt.excerpt_id !== "a0000000-0000-4000-8000-000000000001");
  const riskClaim = packet.claims.find((claim) => claim.document_id === riskExcerpt?.document_id);
  assert.ok(riskExcerpt);
  assert.ok(riskClaim);
  assert.deepEqual(skepticFixture().counterarguments[0]?.citations, [{ kind: "claim", id: riskClaim.claim_id }]);
});
