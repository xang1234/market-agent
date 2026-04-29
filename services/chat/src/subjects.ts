import {
  runSearchToSubjectFlow,
  type HydratedSubjectHandoff,
  type SearchToSubjectFlowResult,
  type SubjectChoice,
} from "../../resolver/src/flow.ts";
import type {
  AmbiguityAxis,
  NotFoundReason,
  ResolverCandidate,
} from "../../resolver/src/envelope.ts";
import type { QueryExecutor } from "../../resolver/src/lookup.ts";
import type { SubjectKind, SubjectRef } from "../../resolver/src/subject-ref.ts";

export type ChatSubjectPreResolveRequest = {
  text: string;
  choice?: SubjectChoice;
};

export type ChatSubjectResolver = (
  request: ChatSubjectPreResolveRequest,
) => Promise<SearchToSubjectFlowResult>;

export type ChatResolvedSubjectPreResolution = {
  status: "resolved";
  input_text: string;
  normalized_input: string;
  subject_ref: SubjectRef;
  identity_level: SubjectKind;
  display_label: string;
  resolution_path: HydratedSubjectHandoff["resolution_path"];
  confidence: number;
  handoff: HydratedSubjectHandoff;
};

export type ChatAmbiguousSubjectPreResolution = {
  status: "needs_clarification";
  input_text: string;
  normalized_input: string;
  candidates: ResolverCandidate[];
  ambiguity_axis?: AmbiguityAxis;
  message: string;
};

export type ChatNotFoundSubjectPreResolution = {
  status: "not_found";
  input_text: string;
  normalized_input: string;
  reason?: NotFoundReason;
  message: string;
};

export type ChatSubjectPreResolution =
  | ChatResolvedSubjectPreResolution
  | ChatAmbiguousSubjectPreResolution
  | ChatNotFoundSubjectPreResolution;

export type ChatSubjectPreResolver = (
  request: ChatSubjectPreResolveRequest,
) => Promise<ChatSubjectPreResolution>;

export type PreResolveChatSubjectInput = ChatSubjectPreResolveRequest & {
  resolveSubject: ChatSubjectResolver;
};

export async function preResolveChatSubject(
  input: PreResolveChatSubjectInput,
): Promise<ChatSubjectPreResolution> {
  const flow = await input.resolveSubject({
    text: input.text,
    ...(input.choice ? { choice: input.choice } : {}),
  });
  return chatSubjectPreResolutionFromFlow(input.text, flow);
}

export async function preResolveChatSubjectWithResolver(
  db: QueryExecutor,
  request: ChatSubjectPreResolveRequest,
): Promise<ChatSubjectPreResolution> {
  return preResolveChatSubject({
    ...request,
    resolveSubject: (resolverRequest) => runSearchToSubjectFlow(db, resolverRequest),
  });
}

export function chatSubjectPreResolutionFromFlow(
  inputText: string,
  flow: SearchToSubjectFlowResult,
): ChatSubjectPreResolution {
  if (flow.status === "hydrated") {
    return {
      status: "resolved",
      input_text: inputText,
      normalized_input: flow.normalized_input,
      subject_ref: flow.handoff.subject_ref,
      identity_level: flow.handoff.identity_level,
      display_label: flow.handoff.display_label,
      resolution_path: flow.handoff.resolution_path,
      confidence: flow.handoff.confidence,
      handoff: flow.handoff,
    };
  }

  if (flow.status === "needs_choice") {
    return {
      status: "needs_clarification",
      input_text: inputText,
      normalized_input: flow.normalized_input,
      candidates: flow.candidates,
      ...(flow.ambiguity_axis ? { ambiguity_axis: flow.ambiguity_axis } : {}),
      message: ambiguityMessage(
        inputText,
        flow.normalized_input,
        flow.candidates,
        flow.ambiguity_axis,
      ),
    };
  }

  return {
    status: "not_found",
    input_text: inputText,
    normalized_input: flow.normalized_input,
    ...(flow.reason ? { reason: flow.reason } : {}),
    message: `I could not resolve "${displayLookupText(inputText, flow.normalized_input)}" to a known subject.`,
  };
}

function ambiguityMessage(
  inputText: string,
  normalizedInput: string,
  candidates: ResolverCandidate[],
  ambiguityAxis?: AmbiguityAxis,
): string {
  const lookupText = displayLookupText(inputText, normalizedInput);
  const candidateText = joinCandidateNames(candidates);
  const prompt = ambiguityAxis === "multiple_listings" || looksLikeShareClassAmbiguity(candidates)
    ? "Which share class"
    : "Which subject";

  return `${prompt} did you mean for ${lookupText}: ${candidateText}?`;
}

function displayLookupText(inputText: string, normalizedInput: string): string {
  const trimmed = inputText.trim();
  return trimmed.length > 0 ? trimmed : normalizedInput;
}

function joinCandidateNames(candidates: ResolverCandidate[]): string {
  const names = candidates.map((candidate) => candidate.display_name);
  if (names.length === 0) {
    return "one of the available matches";
  }
  if (names.length === 1) {
    return names[0];
  }
  if (names.length === 2) {
    return `${names[0]} or ${names[1]}`;
  }
  return `${names.slice(0, -1).join(", ")}, or ${names.at(-1)}`;
}

function looksLikeShareClassAmbiguity(candidates: ResolverCandidate[]): boolean {
  return candidates.some((candidate) => /\b(class|share class)\b/i.test(candidate.display_name));
}
