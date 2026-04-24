import { createServer, type Server, type ServerResponse } from "node:http";
import {
  ambiguous,
  isAmbiguous,
  isNotFound,
  isResolved,
  notFound,
  type AmbiguityAxis,
  type ResolverCandidate,
  type ResolverEnvelope,
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
import { SUBJECT_KINDS, type SubjectKind, type SubjectRef } from "./subject-ref.ts";

const MAX_REQUEST_BODY_BYTES = 64 * 1024;

class RequestBodyTooLargeError extends Error {
  constructor() {
    super("request body too large");
  }
}

export type ResolveRequest = {
  text: string;
  allow_kinds?: SubjectKind[];
};

// Matches spec/finance_research_openapi.yaml `/v1/subjects/resolve` 200 body.
// `alternatives` intentionally projects down to SubjectRef only; richer
// ResolverCandidate metadata stays internal to the resolver.
export type ResolvedSubject = {
  subject_ref: SubjectRef;
  display_name: string;
  confidence: number;
  alternatives?: SubjectRef[];
};

export type ResolveResponse = {
  subjects: ResolvedSubject[];
  unresolved: string[];
};

export type RequestValidation =
  | { valid: true; request: ResolveRequest }
  | { valid: false; error: string };

export function validateResolveRequest(body: unknown): RequestValidation {
  if (typeof body !== "object" || body === null) {
    return { valid: false, error: "request body must be a JSON object" };
  }
  const obj = body as Record<string, unknown>;
  if (typeof obj.text !== "string") {
    return { valid: false, error: "'text' is required and must be a string" };
  }

  let allow_kinds: SubjectKind[] | undefined;
  if (obj.allow_kinds !== undefined) {
    if (!Array.isArray(obj.allow_kinds)) {
      return { valid: false, error: "'allow_kinds' must be an array of SubjectKind" };
    }
    for (const kind of obj.allow_kinds) {
      if (typeof kind !== "string" || !(SUBJECT_KINDS as readonly string[]).includes(kind)) {
        return { valid: false, error: `'allow_kinds' contains invalid SubjectKind: ${String(kind)}` };
      }
    }
    allow_kinds = obj.allow_kinds as SubjectKind[];
  }

  return { valid: true, request: { text: obj.text, ...(allow_kinds ? { allow_kinds } : {}) } };
}

export async function handleResolveSubjects(
  db: QueryExecutor,
  request: ResolveRequest,
): Promise<ResolveResponse> {
  const envelope = await dispatchFreeText(db, request.text);
  const allSubjects = envelopeToSubjects(envelope);

  const subjects =
    request.allow_kinds && request.allow_kinds.length > 0
      ? allSubjects.filter((s) => request.allow_kinds!.includes(s.subject_ref.kind))
      : allSubjects;

  const unresolved = subjects.length === 0
    ? [isNotFound(envelope) ? envelope.normalized_input : request.text]
    : [];

  return { subjects, unresolved };
}

async function dispatchFreeText(
  db: QueryExecutor,
  text: string,
): Promise<ResolverEnvelope> {
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

    if (!isNotFound(identifierEnvelope) || !n.ticker_candidate) {
      return identifierEnvelope;
    }
  }

  const candidateEnvelopes: ResolverEnvelope[] = [];

  if (n.ticker_candidate) {
    const envelope = await resolveByTicker(db, n.ticker_candidate);
    if (!isNotFound(envelope)) candidateEnvelopes.push(envelope);
  }

  if (n.name_candidate && !n.identifier_hint) {
    const envelope = await resolveByNameCandidate(db, n.name_candidate);
    if (!isNotFound(envelope)) candidateEnvelopes.push(envelope);
  }

  if (candidateEnvelopes.length > 0) {
    return mergeCandidateEnvelopes(candidateEnvelopes);
  }

  if (identifierEnvelope) return identifierEnvelope;

  return notFound({ normalized_input: n.trimmed, reason: "no_candidates" });
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
    return {
      outcome: "resolved",
      subject_ref: candidate.subject_ref,
      display_name: candidate.display_name,
      confidence: candidate.confidence,
      canonical_kind: candidate.subject_ref.kind,
    };
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

function envelopeToSubjects(envelope: ResolverEnvelope): ResolvedSubject[] {
  if (isResolved(envelope)) {
    const subject: ResolvedSubject = {
      subject_ref: envelope.subject_ref,
      display_name: envelope.display_name,
      confidence: envelope.confidence,
    };
    if (envelope.alternatives && envelope.alternatives.length > 0) {
      subject.alternatives = envelope.alternatives.map((c) => c.subject_ref);
    }
    return [subject];
  }

  if (isAmbiguous(envelope)) {
    return envelope.candidates.map((c) => ({
      subject_ref: c.subject_ref,
      display_name: c.display_name,
      confidence: c.confidence,
    }));
  }

  return [];
}

export function createResolverServer(db: QueryExecutor): Server {
  return createServer(async (req, res) => {
    try {
      if (req.method !== "POST" || req.url !== "/v1/subjects/resolve") {
        respond(res, 404, { error: "not found" });
        return;
      }

      const body = await readBody(req);

      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        respond(res, 400, { error: "request body must be valid JSON" });
        return;
      }

      const validation = validateResolveRequest(parsed);
      if (!validation.valid) {
        respond(res, 400, { error: validation.error });
        return;
      }

      const response = await handleResolveSubjects(db, validation.request);
      respond(res, 200, response);
    } catch (error) {
      // Keep the server alive on unexpected errors — dropped sockets during
      // readBody, downstream query failures, etc. Headers may already be
      // sent for long-tail races; skip responding in that case.
      if (error instanceof RequestBodyTooLargeError) {
        if (!res.headersSent) {
          respond(res, 413, { error: error.message });
        }
        return;
      }

      console.error("resolver request failed", error);
      if (!res.headersSent) {
        respond(res, 500, { error: "internal resolver error" });
      }
    }
  });
}

async function readBody(req: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    const buffer =
      Buffer.isBuffer(chunk) ? chunk : chunk instanceof Uint8Array ? Buffer.from(chunk) : Buffer.from(String(chunk));
    totalBytes += buffer.length;
    if (totalBytes > MAX_REQUEST_BODY_BYTES) {
      throw new RequestBodyTooLargeError();
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function respond(res: ServerResponse, status: number, body: object) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}
