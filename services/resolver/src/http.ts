import { createServer, type Server } from "node:http";
import {
  isAmbiguous,
  isNotFound,
  isResolved,
  type ResolverEnvelope,
} from "./envelope.ts";
import {
  resolveByCik,
  resolveByIsin,
  resolveByLei,
  resolveByTicker,
  type QueryExecutor,
} from "./lookup.ts";
import { normalize } from "./normalize.ts";
import { SUBJECT_KINDS, type SubjectKind, type SubjectRef } from "./subject-ref.ts";

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

  if (n.identifier_hint) {
    switch (n.identifier_hint.kind) {
      case "cik":
        return resolveByCik(db, n.identifier_hint.value);
      case "isin":
        return resolveByIsin(db, n.identifier_hint.value);
      case "lei":
        return resolveByLei(db, n.identifier_hint.value);
    }
  }

  if (n.ticker_candidate) {
    const envelope = await resolveByTicker(db, n.ticker_candidate);
    if (!isNotFound(envelope)) return envelope;
  }

  // Name / alias lookup is intentionally out of scope for 3.4 — the alias
  // plane will land with the search-to-subject flow (fra-6al.4). For now,
  // inputs that only have a name_candidate fall through to not_found.
  return { outcome: "not_found", normalized_input: n.trimmed, reason: "no_candidates" };
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

    try {
      const response = await handleResolveSubjects(db, validation.request);
      respond(res, 200, response);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      respond(res, 500, { error: `internal resolver error: ${message}` });
    }
  });
}

async function readBody(req: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

type WritableResponse = {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(data?: string): void;
};

function respond(res: WritableResponse, status: number, body: object) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}
