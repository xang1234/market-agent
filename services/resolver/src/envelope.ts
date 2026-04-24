import type { SubjectKind, SubjectRef } from "./subject-ref.ts";

export type ResolverOutcome = "resolved" | "ambiguous" | "not_found";

export type AmbiguityAxis =
  | "issuer_vs_listing"
  | "multiple_listings"
  | "multiple_issuers"
  | "multiple_instruments"
  | "other";

export type NotFoundReason =
  | "unknown_ticker"
  | "unknown_cik"
  | "unknown_lei"
  | "unknown_isin"
  | "no_candidates"
  | "other";

// Confidence floors paired with the invariants assertConfidence enforces.
// Unique-indexed identifiers (CIK/LEI/ISIN): DB uniqueness is the guarantee.
// Ticker: locator per spec §4.1, not identity — even a single hit could be a
// historically reused symbol, so cap below unique identifiers.
export const CONFIDENCE_UNIQUE_IDENTIFIER = 0.99;
export const CONFIDENCE_TICKER_SINGLE = 0.95;
export const CONFIDENCE_TICKER_AMBIGUOUS = 0.5;
export const CONFIDENCE_NAME_LEGAL = 0.9;
export const CONFIDENCE_NAME_FORMER = 0.85;

export type ResolverCandidate = {
  subject_ref: SubjectRef;
  display_name: string;
  confidence: number;
  match_reason?: string;
};

export type ResolvedEnvelope = {
  outcome: "resolved";
  subject_ref: SubjectRef;
  display_name: string;
  confidence: number;
  canonical_kind: SubjectKind;
  alternatives?: ResolverCandidate[];
};

export type AmbiguousEnvelope = {
  outcome: "ambiguous";
  candidates: ResolverCandidate[];
  ambiguity_axis?: AmbiguityAxis;
};

export type NotFoundEnvelope = {
  outcome: "not_found";
  normalized_input: string;
  reason?: NotFoundReason;
};

export type ResolverEnvelope = ResolvedEnvelope | AmbiguousEnvelope | NotFoundEnvelope;

export function isResolved(envelope: ResolverEnvelope): envelope is ResolvedEnvelope {
  return envelope.outcome === "resolved";
}

export function isAmbiguous(envelope: ResolverEnvelope): envelope is AmbiguousEnvelope {
  return envelope.outcome === "ambiguous";
}

export function isNotFound(envelope: ResolverEnvelope): envelope is NotFoundEnvelope {
  return envelope.outcome === "not_found";
}

function assertConfidence(value: number, label: string) {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${label} must be a finite number in [0, 1]; received ${value}`);
  }
}

function assertCandidatesRankedDesc(candidates: ResolverCandidate[]) {
  for (let i = 1; i < candidates.length; i += 1) {
    const prev = candidates[i - 1].confidence;
    const curr = candidates[i].confidence;
    if (curr > prev) {
      throw new Error(
        `candidates must be ranked by confidence descending; index ${i} (${curr}) exceeds index ${i - 1} (${prev})`,
      );
    }
  }
}

export function resolved(args: {
  subject_ref: SubjectRef;
  display_name: string;
  confidence: number;
  canonical_kind?: SubjectKind;
  alternatives?: ResolverCandidate[];
}): ResolvedEnvelope {
  assertConfidence(args.confidence, "resolved.confidence");
  if (args.canonical_kind !== undefined && args.canonical_kind !== args.subject_ref.kind) {
    throw new Error("canonical_kind must match subject_ref.kind");
  }

  if (args.alternatives) {
    for (const [i, candidate] of args.alternatives.entries()) {
      assertConfidence(candidate.confidence, `alternatives[${i}].confidence`);
    }
    assertCandidatesRankedDesc(args.alternatives);
    for (const candidate of args.alternatives) {
      if (candidate.confidence > args.confidence) {
        throw new Error(
          "alternatives must not exceed the chosen candidate's confidence; resolver would be picking the wrong winner",
        );
      }
    }
  }

  return {
    outcome: "resolved",
    subject_ref: args.subject_ref,
    display_name: args.display_name,
    confidence: args.confidence,
    canonical_kind: args.canonical_kind ?? args.subject_ref.kind,
    ...(args.alternatives ? { alternatives: args.alternatives } : {}),
  };
}

export function ambiguous(args: {
  candidates: ResolverCandidate[];
  ambiguity_axis?: AmbiguityAxis;
}): AmbiguousEnvelope {
  if (args.candidates.length < 2) {
    throw new Error(
      `ambiguous envelope requires >= 2 candidates; received ${args.candidates.length}. Use resolved or not_found instead.`,
    );
  }

  for (const [i, candidate] of args.candidates.entries()) {
    assertConfidence(candidate.confidence, `candidates[${i}].confidence`);
  }
  assertCandidatesRankedDesc(args.candidates);

  return {
    outcome: "ambiguous",
    candidates: args.candidates,
    ...(args.ambiguity_axis ? { ambiguity_axis: args.ambiguity_axis } : {}),
  };
}

export function notFound(args: {
  normalized_input: string;
  reason?: NotFoundReason;
}): NotFoundEnvelope {
  return {
    outcome: "not_found",
    normalized_input: args.normalized_input,
    ...(args.reason ? { reason: args.reason } : {}),
  };
}
