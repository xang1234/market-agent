import { isUuid, resolveSubjects, type ResolvedSubject } from "../symbol/search.ts";

export type IssuerRef = { kind: "issuer"; id: string };

// The resolver surface this module needs — resolveSubjects narrowed to its
// text-in/subjects-out core so tests inject a fake without network shape.
export type ResolveTextImpl = (args: { text: string }) => Promise<{ subjects: ResolvedSubject[] }>;

export class UnresolvedTickersError extends Error {
  readonly unresolved: ReadonlyArray<string>;

  constructor(unresolved: ReadonlyArray<string>) {
    super(`could not resolve: ${unresolved.join(", ")}`);
    this.name = "UnresolvedTickersError";
    this.unresolved = unresolved;
  }
}

// Tickers resolve to listings; the issuer the grid needs rides in the
// resolution's hydrated context. Direct issuer matches are used as-is.
function issuerRefFrom(subject: ResolvedSubject): IssuerRef | null {
  if (subject.subject_ref.kind === "issuer") {
    return { kind: "issuer", id: subject.subject_ref.id };
  }
  const issuer = subject.context?.issuer?.subject_ref;
  return issuer ? { kind: "issuer", id: issuer.id } : null;
}

async function resolveIssuerRef(text: string, resolve: ResolveTextImpl): Promise<IssuerRef | null> {
  try {
    const response = await resolve({ text });
    const first = response.subjects[0];
    return first ? issuerRefFrom(first) : null;
  } catch {
    return null;
  }
}

// The GridBuilder lets users type tickers where issuer uuids belong (manual
// subject_refs, the peers issuer field). Resolve those entries through the
// resolver service before the spec is sent; uuid entries pass through
// untouched, so issuer ids keep working as a direct path. Throws
// UnresolvedTickersError naming every entry that did not resolve.
export async function resolveUniverseSpecInput(
  spec: unknown,
  resolve: ResolveTextImpl = resolveSubjects,
): Promise<unknown> {
  const s = spec as
    | { source?: unknown; subject_refs?: unknown; issuer_id?: unknown }
    | null;

  if (s?.source === "manual" && Array.isArray(s.subject_refs)) {
    const unresolved: string[] = [];
    const refs = await Promise.all(
      (s.subject_refs as Array<{ kind: string; id: string }>).map(async (ref) => {
        if (isUuid(ref.id)) return ref;
        const issuer = await resolveIssuerRef(ref.id, resolve);
        if (!issuer) {
          unresolved.push(ref.id);
          return ref;
        }
        return issuer;
      }),
    );
    if (unresolved.length > 0) throw new UnresolvedTickersError(unresolved);
    return { ...s, subject_refs: refs };
  }

  if (s?.source === "peers" && typeof s.issuer_id === "string" && !isUuid(s.issuer_id)) {
    const issuer = await resolveIssuerRef(s.issuer_id, resolve);
    if (!issuer) throw new UnresolvedTickersError([s.issuer_id]);
    return { ...s, issuer_id: issuer.id };
  }

  return spec;
}
