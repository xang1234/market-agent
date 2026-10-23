import type { ListingSubjectRef } from "../../market/src/subject-ref.ts";
import type { HydratedSubjectHandoff } from "../../resolver/src/flow.ts";
import type { SubjectRef } from "../../shared/src/subject-ref.ts";

// A covered company's issuer and its listings (with display tickers), as the
// resolver's handoff already holds them, so nothing re-derives the subject graph.
export type StructuredSubjectRefs = {
  issuer: (SubjectRef & { kind: "issuer" }) | null;
  listings: ReadonlyArray<{ ref: ListingSubjectRef; ticker: string | null }>;
};

// An issuer-kind subject is its own issuer; a listing or instrument carries its
// issuer_ref in context.
export function structuredRefsFromHandoff(handoff: HydratedSubjectHandoff): StructuredSubjectRefs {
  const ctx = handoff.context;
  const issuer = ctx.issuer?.subject_ref
    ?? ctx.listing?.issuer_ref
    ?? ctx.instrument?.issuer_ref
    ?? (handoff.subject_ref.kind === "issuer" ? handoff.subject_ref : null);
  const listingContexts = ctx.listing ? [ctx.listing] : ctx.active_listings ?? [];
  const listings = listingContexts.map((listing) => ({
    ref: listing.subject_ref,
    ticker: listing.ticker,
  }));
  return Object.freeze({ issuer: issuer && isIssuerRef(issuer) ? issuer : null, listings: Object.freeze(listings) });
}

function isIssuerRef(ref: SubjectRef): ref is SubjectRef & { kind: "issuer" } {
  return ref.kind === "issuer";
}
