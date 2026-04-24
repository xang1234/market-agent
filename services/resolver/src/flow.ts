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

export class InvalidChoiceError extends Error {
  constructor(message = "choice subject_ref must match one of the ambiguous candidates") {
    super(message);
    this.name = "InvalidChoiceError";
  }
}

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
  display_labels: SubjectDisplayLabels;
  normalized_input: string;
  resolution_path: ResolutionPath;
  confidence: number;
  context: HydratedSubjectContext;
};

export type SubjectDisplayLabels = {
  primary: string;
  legal_name?: string;
  ticker?: string;
  mic?: string;
  share_class?: string;
};

export type IssuerContext = {
  subject_ref: SubjectRef & { kind: "issuer" };
  legal_name: string;
  cik?: string;
  lei?: string;
  domicile?: string;
  sector?: string;
  industry?: string;
};

export type InstrumentContext = {
  subject_ref: SubjectRef & { kind: "instrument" };
  issuer_ref: SubjectRef & { kind: "issuer" };
  asset_type: string;
  share_class?: string;
  isin?: string;
};

export type ListingContext = {
  subject_ref: SubjectRef & { kind: "listing" };
  instrument_ref: SubjectRef & { kind: "instrument" };
  issuer_ref: SubjectRef & { kind: "issuer" };
  mic: string;
  ticker: string;
  trading_currency: string;
  timezone: string;
  active_from?: string | Date;
  active_to?: string | Date;
};

export type HydratedSubjectContext = {
  issuer?: IssuerContext;
  instrument?: InstrumentContext;
  listing?: ListingContext;
  active_listings?: ListingContext[];
};

type ListingContextRow = {
  listing_id: string;
  instrument_id: string;
  issuer_id: string;
  mic: string;
  ticker: string;
  trading_currency: string;
  timezone: string;
  active_from: string | Date | null;
  active_to: string | Date | null;
};

type ListingHydrationRow = ListingContextRow & {
  asset_type: string;
  share_class: string | null;
  isin: string | null;
  legal_name: string;
  cik: string | null;
  lei: string | null;
  domicile: string | null;
  sector: string | null;
  industry: string | null;
};

type IssuerHydrationRow = {
  issuer_id: string;
  legal_name: string;
  cik: string | null;
  lei: string | null;
  domicile: string | null;
  sector: string | null;
  industry: string | null;
};

type InstrumentHydrationRow = IssuerHydrationRow & {
  instrument_id: string;
  asset_type: string;
  share_class: string | null;
  isin: string | null;
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
    const handoff = await handoffFromResolved(db, envelope, normalized_input, "auto_advanced");
    await writeResolutionPathLog(db, handoff);
    return {
      status: "hydrated",
      stage: "hydrated_handoff",
      normalized_input,
      candidate_search: envelope,
      canonical_selection: envelope,
      handoff,
    };
  }

  if (request.choice) {
    const chosen = envelope.candidates.find((candidate) =>
      subjectRefsEqual(candidate.subject_ref, request.choice!.subject_ref),
    );
    if (!chosen) {
      throw new InvalidChoiceError();
    }
    const canonicalSelection = resolvedFromCandidate(chosen);
    const handoff = await handoffFromResolved(db, canonicalSelection, normalized_input, "explicit_choice");
    await writeResolutionPathLog(db, handoff);

    return {
      status: "hydrated",
      stage: "hydrated_handoff",
      normalized_input,
      candidate_search: envelope,
      canonical_selection: canonicalSelection,
      handoff,
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

async function handoffFromResolved(
  db: QueryExecutor,
  envelope: ResolvedEnvelope,
  normalizedInput: string,
  resolutionPath: ResolutionPath,
): Promise<HydratedSubjectHandoff> {
  const context = await loadSubjectContext(db, envelope.subject_ref);
  const displayLabels = displayLabelsFor(envelope.display_name, context);
  return {
    subject_ref: envelope.subject_ref,
    identity_level: envelope.canonical_kind,
    display_label: envelope.display_name,
    display_labels: displayLabels,
    normalized_input: normalizedInput,
    resolution_path: resolutionPath,
    confidence: envelope.confidence,
    context,
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

async function loadSubjectContext(
  db: QueryExecutor,
  subjectRef: SubjectRef,
): Promise<HydratedSubjectContext> {
  switch (subjectRef.kind) {
    case "listing":
      return loadListingSubjectContext(db, subjectRef.id);
    case "instrument":
      return loadInstrumentSubjectContext(db, subjectRef.id);
    case "issuer":
      return loadIssuerSubjectContext(db, subjectRef.id);
    default:
      return {};
  }
}

async function loadListingSubjectContext(
  db: QueryExecutor,
  listingId: string,
): Promise<HydratedSubjectContext> {
  const result = await db.query<ListingHydrationRow>(
    `select l.listing_id,
            l.instrument_id,
            i.issuer_id,
            l.mic,
            l.ticker,
            l.trading_currency,
            l.timezone,
            l.active_from,
            l.active_to,
            i.asset_type,
            i.share_class,
            i.isin,
            iss.legal_name,
            iss.cik,
            iss.lei,
            iss.domicile,
            iss.sector,
            iss.industry
       from listings l
       join instruments i on i.instrument_id = l.instrument_id
       join issuers iss on iss.issuer_id = i.issuer_id
      where l.listing_id = $1`,
    [listingId],
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error(`Cannot hydrate listing subject_ref: ${listingId}`);
  }

  return contextFromListingRow(row);
}

async function loadInstrumentSubjectContext(
  db: QueryExecutor,
  instrumentId: string,
): Promise<HydratedSubjectContext> {
  const result = await db.query<InstrumentHydrationRow>(
    `select i.instrument_id,
            i.issuer_id,
            i.asset_type,
            i.share_class,
            i.isin,
            iss.legal_name,
            iss.cik,
            iss.lei,
            iss.domicile,
            iss.sector,
            iss.industry
       from instruments i
       join issuers iss on iss.issuer_id = i.issuer_id
      where i.instrument_id = $1`,
    [instrumentId],
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error(`Cannot hydrate instrument subject_ref: ${instrumentId}`);
  }

  return {
    issuer: issuerContextFromRow(row),
    instrument: instrumentContextFromRow(row),
    active_listings: await loadActiveListingsForInstrument(db, row.instrument_id),
  };
}

async function loadIssuerSubjectContext(
  db: QueryExecutor,
  issuerId: string,
): Promise<HydratedSubjectContext> {
  const result = await db.query<IssuerHydrationRow>(
    `select iss.issuer_id,
            iss.legal_name,
            iss.cik,
            iss.lei,
            iss.domicile,
            iss.sector,
            iss.industry
       from issuers iss
      where iss.issuer_id = $1`,
    [issuerId],
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error(`Cannot hydrate issuer subject_ref: ${issuerId}`);
  }

  return {
    issuer: issuerContextFromRow(row),
    active_listings: await loadActiveListingsForIssuer(db, row.issuer_id),
  };
}

async function loadActiveListingsForIssuer(
  db: QueryExecutor,
  issuerId: string,
): Promise<ListingContext[]> {
  const result = await db.query<ListingContextRow>(
    `select l.listing_id,
            l.instrument_id,
            i.issuer_id,
            l.mic,
            l.ticker,
            l.trading_currency,
            l.timezone,
            l.active_from,
            l.active_to
       from listings l
       join instruments i on i.instrument_id = l.instrument_id
      where i.issuer_id = $1
        and (l.active_from is null or l.active_from <= now())
        and (l.active_to is null or l.active_to > now())
      order by l.mic, l.ticker`,
    [issuerId],
  );

  return result.rows.map((row) => listingContextFromRow(row));
}

async function loadActiveListingsForInstrument(
  db: QueryExecutor,
  instrumentId: string,
): Promise<ListingContext[]> {
  const result = await db.query<ListingContextRow>(
    `select l.listing_id,
            l.instrument_id,
            i.issuer_id,
            l.mic,
            l.ticker,
            l.trading_currency,
            l.timezone,
            l.active_from,
            l.active_to
       from listings l
       join instruments i on i.instrument_id = l.instrument_id
      where l.instrument_id = $1
        and (l.active_from is null or l.active_from <= now())
        and (l.active_to is null or l.active_to > now())
      order by l.mic, l.ticker`,
    [instrumentId],
  );

  return result.rows.map((row) => listingContextFromRow(row));
}

function contextFromListingRow(row: ListingHydrationRow): HydratedSubjectContext {
  const issuer = issuerContextFromRow(row);
  const instrument = instrumentContextFromRow(row);
  const listing = listingContextFromRow(row);
  return { issuer, instrument, listing };
}

function issuerContextFromRow(row: IssuerHydrationRow): IssuerContext {
  return stripUndefined({
    subject_ref: { kind: "issuer" as const, id: row.issuer_id },
    legal_name: row.legal_name,
    cik: row.cik ?? undefined,
    lei: row.lei ?? undefined,
    domicile: row.domicile ?? undefined,
    sector: row.sector ?? undefined,
    industry: row.industry ?? undefined,
  });
}

function instrumentContextFromRow(row: InstrumentHydrationRow): InstrumentContext {
  return stripUndefined({
    subject_ref: { kind: "instrument" as const, id: row.instrument_id },
    issuer_ref: { kind: "issuer" as const, id: row.issuer_id },
    asset_type: row.asset_type,
    share_class: row.share_class ?? undefined,
    isin: row.isin ?? undefined,
  });
}

function listingContextFromRow(row: ListingContextRow): ListingContext {
  return stripUndefined({
    subject_ref: { kind: "listing" as const, id: row.listing_id },
    instrument_ref: { kind: "instrument" as const, id: row.instrument_id },
    issuer_ref: { kind: "issuer" as const, id: row.issuer_id },
    mic: row.mic,
    ticker: row.ticker,
    trading_currency: row.trading_currency,
    timezone: row.timezone,
    active_from: row.active_from ?? undefined,
    active_to: row.active_to ?? undefined,
  });
}

function displayLabelsFor(
  primary: string,
  context: HydratedSubjectContext,
): SubjectDisplayLabels {
  return stripUndefined({
    primary,
    legal_name: context.issuer?.legal_name,
    ticker: context.listing?.ticker,
    mic: context.listing?.mic,
    share_class: context.instrument?.share_class,
  });
}

async function writeResolutionPathLog(
  db: QueryExecutor,
  handoff: HydratedSubjectHandoff,
): Promise<void> {
  await db.query(
    `insert into tool_call_logs (tool_name, args, status)
     values ($1, $2::jsonb, $3)`,
    [
      "resolver.search_to_subject_flow",
      JSON.stringify({
        resolution_path: handoff.resolution_path,
        normalized_input: handoff.normalized_input,
        subject_ref: handoff.subject_ref,
        identity_level: handoff.identity_level,
      }),
      "ok",
    ],
  );
}

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  for (const key of Object.keys(value)) {
    if (value[key] === undefined) {
      delete value[key];
    }
  }
  return value;
}
