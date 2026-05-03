import test from "node:test";
import assert from "node:assert/strict";

import {
  decideCandidateFactPromotion,
  PROMOTION_REVIEW_CONFIDENCE_THRESHOLD,
  type CandidateFactPromotionInput,
} from "../src/promotion-rules.ts";

function decide(input: Partial<CandidateFactPromotionInput>) {
  return decideCandidateFactPromotion({
    source_kind: "filing",
    extraction_confidence: 0.95,
    corroborating_source_count: 0,
    issuer_self_attested: false,
    user_scoped: false,
    ...input,
  });
}

test("promotion rules make primary disclosures authoritative at high confidence", () => {
  assert.deepEqual(decide({ source_kind: "filing", extraction_confidence: 0.92 }), {
    action: "promote",
    verification_status: "authoritative",
    reason: "primary_disclosure_high_confidence",
  });

  assert.deepEqual(
    decide({ source_kind: "press_release", issuer_self_attested: true, extraction_confidence: 0.88 }),
    {
      action: "promote",
      verification_status: "authoritative",
      reason: "issuer_attested_press_release",
    },
  );
});

test("promotion rules require corroboration before non-primary sources become canonical facts", () => {
  assert.deepEqual(
    decide({ source_kind: "transcript", extraction_confidence: 0.87, corroborating_source_count: 1 }),
    {
      action: "promote",
      verification_status: "corroborated",
      reason: "transcript_fact_corroborated",
    },
  );

  assert.deepEqual(
    decide({ source_kind: "article", extraction_confidence: 0.93, corroborating_source_count: 2 }),
    {
      action: "promote",
      verification_status: "corroborated",
      reason: "secondary_fact_corroborated",
    },
  );

  assert.deepEqual(decide({ source_kind: "article", extraction_confidence: 0.93, corroborating_source_count: 0 }), {
    action: "keep_candidate",
    verification_status: "candidate",
    reason: "secondary_source_not_canonical_without_corroboration",
  });
});

test("promotion rules never auto-promote social facts and only allow user uploads as user-scoped candidates", () => {
  assert.deepEqual(decide({ source_kind: "social_post", extraction_confidence: 0.99, corroborating_source_count: 5 }), {
    action: "reject",
    reason: "social_source_never_promotes_fact",
  });

  assert.deepEqual(decide({ source_kind: "upload", extraction_confidence: 0.91, user_scoped: true }), {
    action: "keep_candidate",
    verification_status: "candidate",
    reason: "user_upload_candidate_user_scoped_only",
  });

  assert.deepEqual(decide({ source_kind: "upload", extraction_confidence: 0.91, user_scoped: false }), {
    action: "reject",
    reason: "user_upload_requires_user_scope",
  });
});

test("promotion rules route low-confidence extractions to reviewer queue", () => {
  assert.deepEqual(decide({ source_kind: "filing", extraction_confidence: PROMOTION_REVIEW_CONFIDENCE_THRESHOLD - 0.01 }), {
    action: "queue_review",
    verification_status: "candidate",
    reason: "below_review_confidence_threshold",
  });
});
