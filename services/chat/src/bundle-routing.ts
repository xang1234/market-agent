import { SUBJECT_KINDS, type SubjectKind } from "../../resolver/src/subject-ref.ts";

export class BundleRoutingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BundleRoutingError";
  }
}

// Maps the chat thread's primary_subject_kind to the analyst prompt-template
// bundle_id. Pure data — there are no special-case branches per kind, which
// is the contract for fra-95e: ticker chats and theme chats traverse the
// same routing function.
//
// Drift-tested against analystPromptTemplateBundleIds() in
// services/tools/src/prompt-templates.ts so a renamed/removed bundle fails
// loudly instead of silently routing every thread to "single_subject_analysis".
//
// portfolio routes to single_subject_analysis because the prompt-template
// catalog does not yet define a portfolio-specific bundle and a portfolio
// chat is closest in shape to a single-subject thread (one canonical entity
// to analyse). When P4.x adds a portfolio bundle, update this entry.
const BUNDLE_BY_SUBJECT_KIND: Readonly<Record<SubjectKind, string>> = Object.freeze({
  issuer: "single_subject_analysis",
  instrument: "single_subject_analysis",
  listing: "single_subject_analysis",
  theme: "theme_research",
  macro_topic: "theme_research",
  portfolio: "single_subject_analysis",
  screen: "screener",
});

// Default bundle when a thread has no primary_subject_kind (e.g. a brand-new
// thread before the first message). Matches the most general default in the
// prompt-template catalog.
export const DEFAULT_BUNDLE_ID = "single_subject_analysis";

// Accepts undefined as well as null so callers can pass `thread.primary_subject_ref?.kind`
// directly without an explicit `?? null` — both mean "no primary subject yet" and route to
// DEFAULT_BUNDLE_ID. Stringly-typed inputs that are not a known SubjectKind still throw.
export function chooseBundleIdForSubjectKind(kind: SubjectKind | null | undefined): string {
  if (kind == null) return DEFAULT_BUNDLE_ID;
  if (!(SUBJECT_KINDS as ReadonlyArray<string>).includes(kind)) {
    throw new BundleRoutingError(
      `subject_kind: must be one of ${SUBJECT_KINDS.join(", ")} (got ${JSON.stringify(kind)})`,
    );
  }
  return BUNDLE_BY_SUBJECT_KIND[kind];
}
