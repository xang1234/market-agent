import {
  ambiguous,
  isAmbiguous,
  isNotFound,
  isResolved,
  notFound,
  resolved,
  type AmbiguityAxis,
  type NotFoundReason,
  type ResolverCandidate,
  type ResolverEnvelope,
  type ResolvedEnvelope,
} from "./envelope.ts";
import {
  resolveByCik,
  resolveByIsin,
  resolveByLei,
  resolveByNameCandidate,
  resolveByTicker,
  type QueryExecutor,
} from "./lookup.ts";
import { normalize } from "./normalize.ts";
import type { SubjectKind, SubjectRef } from "./subject-ref.ts";

export type ResolutionPath = "auto_advanced" | "explicit_choice";

export type SubjectChoice = {
  subject_ref: SubjectRef;
};

export type SearchToSubjectRequest = {
  text: string;
  choice?: SubjectChoice;
};

export type CandidateSearchResult = {
  normalized_input: string;
  envelope: ResolverEnvelope;
};

export type HydratedSubjectHandoff = {
  subject_ref: SubjectRef;
  identity_level: SubjectKind;
  display_label: string;
  normalized_input: string;
  resolution_path: ResolutionPath;
  confidence: number;
};

export type SearchToSubjectFlowResult =
  | {
      status: "hydrated";
      stage: "hydrated_handoff";
      normalized_input: string;
      candidate_search: ResolverEnvelope;
      canonical_selection: ResolvedEnvelope;
      handoff: HydratedSubjectHandoff;
    }
  | {
      status: "needs_choice";
      stage: "canonical_selection";
      normalized_input: string;
      candidate_search: ResolverEnvelope;
      candidates: ResolverCandidate[];
      ambiguity_axis?: AmbiguityAxis;
    }
  | {
      status: "not_found";
      stage: "candidate_search";
      normalized_input: string;
      candidate_search: ResolverEnvelope;
      reason?: NotFoundReason;
    };

export async function runSearchToSubjectFlow(
  db: QueryExecutor,
  request: SearchToSubjectRequest,
): Promise<SearchToSubjectFlowResult> {
  const search = await searchSubjectCandidates(db, request.text);
  const { envelope, normalized_input } = search;

  if (isNotFound(envelope)) {
    return {
      status: "not_found",
      stage: "candidate_search",
      normalized_input: envelope.normalized_input,
      candidate_search: envelope,
      ...(envelope.reason ? { reason: envelope.reason } : {}),
    };
  }

  if (isResolved(envelope)) {
    return {
      status: "hydrated",
      stage: "hydrated_handoff",
      normalized_input,
      candidate_search: envelope,
      canonical_selection: envelope,
      handoff: handoffFromResolved(envelope, normalized_input, "auto_advanced"),
    };
  }

  if (request.choice) {
    const chosen = envelope.candidates.find((candidate) =>
      subjectRefsEqual(candidate.subject_ref, request.choice!.subject_ref),
    );
    if (!chosen) {
      throw new Error("choice subject_ref must match one of the ambiguous candidates");
    }
    const canonicalSelection = resolvedFromCandidate(chosen);

    return {
      status: "hydrated",
      stage: "hydrated_handoff",
      normalized_input,
      candidate_search: envelope,
      canonical_selection: canonicalSelection,
      handoff: handoffFromResolved(canonicalSelection, normalized_input, "explicit_choice"),
    };
  }

  return {
    status: "needs_choice",
    stage: "canonical_selection",
    normalized_input,
    candidate_search: envelope,
    candidates: envelope.candidates,
    ...(envelope.ambiguity_axis ? { ambiguity_axis: envelope.ambiguity_axis } : {}),
  };
}

export async function searchSubjectCandidates(
  db: QueryExecutor,
  text: string,
): Promise<CandidateSearchResult> {
  const n = normalize(text);
  let identifierEnvelope: ResolverEnvelope | null = null;

  if (n.identifier_hint) {
    const hint = n.identifier_hint;
    switch (hint.kind) {
      case "cik":
        identifierEnvelope = await resolveByCik(db, hint.value);
        break;
      case "isin":
        identifierEnvelope = await resolveByIsin(db, hint.value);
        break;
      case "lei":
        identifierEnvelope = await resolveByLei(db, hint.value);
        break;
      default: {
        const _exhaustive: never = hint;
        throw new Error(`Unhandled identifier_hint kind: ${(_exhaustive as { kind: string }).kind}`);
      }
    }

    if (!isNotFound(identifierEnvelope) || (!n.ticker_candidate && !n.name_candidate)) {
      return {
        normalized_input: normalizedInputForFlow(n),
        envelope: identifierEnvelope,
      };
    }
  }

  const candidateEnvelopes: ResolverEnvelope[] = [];

  if (n.ticker_candidate) {
    const envelope = await resolveByTicker(db, n.ticker_candidate);
    if (!isNotFound(envelope)) candidateEnvelopes.push(envelope);
  }

  if (n.name_candidate) {
    const envelope = await resolveByNameCandidate(db, n.name_candidate);
    if (!isNotFound(envelope)) candidateEnvelopes.push(envelope);
  }

  if (candidateEnvelopes.length > 0) {
    return {
      normalized_input: normalizedInputForFlow(n),
      envelope: mergeCandidateEnvelopes(candidateEnvelopes),
    };
  }

  if (identifierEnvelope) {
    return {
      normalized_input: identifierEnvelope.normalized_input,
      envelope: identifierEnvelope,
    };
  }

  return {
    normalized_input: n.trimmed,
    envelope: notFound({ normalized_input: n.trimmed, reason: "no_candidates" }),
  };
}

function handoffFromResolved(
  envelope: ResolvedEnvelope,
  normalizedInput: string,
  resolutionPath: ResolutionPath,
): HydratedSubjectHandoff {
  return {
    subject_ref: envelope.subject_ref,
    identity_level: envelope.canonical_kind,
    display_label: envelope.display_name,
    normalized_input: normalizedInput,
    resolution_path: resolutionPath,
    confidence: envelope.confidence,
  };
}

function resolvedFromCandidate(candidate: ResolverCandidate): ResolvedEnvelope {
  return resolved({
    subject_ref: candidate.subject_ref,
    display_name: candidate.display_name,
    confidence: candidate.confidence,
    canonical_kind: candidate.subject_ref.kind,
  });
}

function mergeCandidateEnvelopes(envelopes: ResolverEnvelope[]): ResolverEnvelope {
  const candidates: ResolverCandidate[] = [];

  for (const envelope of envelopes) {
    if (isResolved(envelope)) {
      candidates.push({
        subject_ref: envelope.subject_ref,
        display_name: envelope.display_name,
        confidence: envelope.confidence,
      });
    } else if (isAmbiguous(envelope)) {
      candidates.push(...envelope.candidates);
    }
  }

  const deduped = dedupeCandidates(candidates).sort((a, b) => b.confidence - a.confidence);

  if (deduped.length === 1) {
    const [candidate] = deduped;
    return resolved({
      subject_ref: candidate.subject_ref,
      display_name: candidate.display_name,
      confidence: candidate.confidence,
      canonical_kind: candidate.subject_ref.kind,
    });
  }

  return ambiguous({
    candidates: deduped,
    ambiguity_axis: inferAmbiguityAxis(deduped),
  });
}

function dedupeCandidates(candidates: ResolverCandidate[]): ResolverCandidate[] {
  const bySubject = new Map<string, ResolverCandidate>();
  for (const candidate of candidates) {
    const key = `${candidate.subject_ref.kind}:${candidate.subject_ref.id}`;
    const existing = bySubject.get(key);
    if (!existing || candidate.confidence > existing.confidence) {
      bySubject.set(key, candidate);
    }
  }
  return [...bySubject.values()];
}

function inferAmbiguityAxis(candidates: ResolverCandidate[]): AmbiguityAxis {
  const kinds = new Set(candidates.map((candidate) => candidate.subject_ref.kind));
  if (kinds.has("issuer") && kinds.has("listing")) return "issuer_vs_listing";
  if (kinds.size === 1 && kinds.has("issuer")) return "multiple_issuers";
  if (kinds.size === 1 && kinds.has("listing")) return "multiple_listings";
  if (kinds.size === 1 && kinds.has("instrument")) return "multiple_instruments";
  return "other";
}

function normalizedInputForFlow(n: ReturnType<typeof normalize>): string {
  return n.identifier_hint?.value ?? n.ticker_candidate ?? n.name_candidate ?? n.trimmed;
}

function subjectRefsEqual(a: SubjectRef, b: SubjectRef): boolean {
  return a.kind === b.kind && a.id === b.id;
}
