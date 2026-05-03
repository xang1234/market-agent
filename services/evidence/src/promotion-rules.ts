import { SOURCE_KINDS, type SourceKind } from "./source-repo.ts";
import { assertOneOf } from "./validators.ts";

export const PROMOTION_REVIEW_CONFIDENCE_THRESHOLD = 0.7;

export const PROMOTION_VERIFICATION_STATUSES = Object.freeze([
  "authoritative",
  "candidate",
  "corroborated",
  "disputed",
] as const);

export type PromotionVerificationStatus = (typeof PROMOTION_VERIFICATION_STATUSES)[number];

export type CandidateFactPromotionInput = Readonly<{
  source_kind: SourceKind;
  extraction_confidence: number;
  corroborating_source_count: number;
  issuer_self_attested: boolean;
  user_scoped: boolean;
  review_confidence_threshold?: number;
}>;

export type CandidateFactPromotionDecision = Readonly<
  | {
      action: "promote";
      verification_status: Extract<PromotionVerificationStatus, "authoritative" | "corroborated">;
      reason:
        | "primary_disclosure_high_confidence"
        | "issuer_attested_press_release"
        | "transcript_fact_corroborated"
        | "secondary_fact_corroborated";
    }
  | {
      action: "keep_candidate";
      verification_status: "candidate";
      reason:
        | "primary_disclosure_candidate_confidence"
        | "press_release_requires_issuer_attestation"
        | "transcript_requires_corroboration"
        | "secondary_source_not_canonical_without_corroboration"
        | "user_upload_candidate_user_scoped_only";
    }
  | {
      action: "queue_review";
      verification_status: "candidate";
      reason: "below_review_confidence_threshold";
    }
  | {
      action: "reject";
      reason: "social_source_never_promotes_fact" | "user_upload_requires_user_scope" | "internal_source_not_promotable";
    }
>;

export function decideCandidateFactPromotion(
  input: CandidateFactPromotionInput,
): CandidateFactPromotionDecision {
  assertOneOf(input.source_kind, SOURCE_KINDS, "source_kind");
  assertConfidence(input.extraction_confidence, "extraction_confidence");
  assertNonNegativeInteger(input.corroborating_source_count, "corroborating_source_count");
  assertBoolean(input.issuer_self_attested, "issuer_self_attested");
  assertBoolean(input.user_scoped, "user_scoped");
  const reviewThreshold = input.review_confidence_threshold ?? PROMOTION_REVIEW_CONFIDENCE_THRESHOLD;
  assertConfidence(reviewThreshold, "review_confidence_threshold");

  if (input.extraction_confidence < reviewThreshold) {
    return Object.freeze({
      action: "queue_review" as const,
      verification_status: "candidate" as const,
      reason: "below_review_confidence_threshold" as const,
    });
  }

  switch (input.source_kind) {
    case "filing":
      return input.extraction_confidence >= 0.9
        ? Object.freeze({
            action: "promote" as const,
            verification_status: "authoritative" as const,
            reason: "primary_disclosure_high_confidence" as const,
          })
        : Object.freeze({
            action: "keep_candidate" as const,
            verification_status: "candidate" as const,
            reason: "primary_disclosure_candidate_confidence" as const,
          });
    case "press_release":
      return input.issuer_self_attested && input.extraction_confidence >= 0.85
        ? Object.freeze({
            action: "promote" as const,
            verification_status: "authoritative" as const,
            reason: "issuer_attested_press_release" as const,
          })
        : Object.freeze({
            action: "keep_candidate" as const,
            verification_status: "candidate" as const,
            reason: "press_release_requires_issuer_attestation" as const,
          });
    case "transcript":
      return input.corroborating_source_count >= 1 && input.extraction_confidence >= 0.85
        ? Object.freeze({
            action: "promote" as const,
            verification_status: "corroborated" as const,
            reason: "transcript_fact_corroborated" as const,
          })
        : Object.freeze({
            action: "keep_candidate" as const,
            verification_status: "candidate" as const,
            reason: "transcript_requires_corroboration" as const,
          });
    case "article":
    case "research_note":
      return input.corroborating_source_count >= 2 && input.extraction_confidence >= 0.9
        ? Object.freeze({
            action: "promote" as const,
            verification_status: "corroborated" as const,
            reason: "secondary_fact_corroborated" as const,
          })
        : Object.freeze({
            action: "keep_candidate" as const,
            verification_status: "candidate" as const,
            reason: "secondary_source_not_canonical_without_corroboration" as const,
          });
    case "social_post":
      return Object.freeze({
        action: "reject" as const,
        reason: "social_source_never_promotes_fact" as const,
      });
    case "upload":
      return input.user_scoped
        ? Object.freeze({
            action: "keep_candidate" as const,
            verification_status: "candidate" as const,
            reason: "user_upload_candidate_user_scoped_only" as const,
          })
        : Object.freeze({
            action: "reject" as const,
            reason: "user_upload_requires_user_scope" as const,
          });
    case "internal":
      return Object.freeze({
        action: "reject" as const,
        reason: "internal_source_not_promotable" as const,
      });
  }
}

function assertConfidence(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${label}: must be a finite number in [0, 1]`);
  }
}

function assertNonNegativeInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new Error(`${label}: must be a non-negative integer`);
  }
}

function assertBoolean(value: unknown, label: string): asserts value is boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${label}: must be a boolean`);
  }
}
