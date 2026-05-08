import { createServer, type Server, type ServerResponse } from "node:http";
import {
  type ResolverCandidate,
} from "./envelope.ts";
import {
  InvalidChoiceError,
  SubjectHydrationNotFoundError,
  hydrateSubjectRef,
  runSearchToSubjectFlow,
  type HydratedSubjectContext,
  type HydratedSubjectHandoff,
  type ResolutionPath,
  type SearchToSubjectOptions,
  type SubjectChoice,
  type SubjectDisplayLabels,
} from "./flow.ts";
import type { QueryExecutor } from "./lookup.ts";
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
  choice?: SubjectChoice;
};

export type HydrateSubjectRequest = {
  subject_ref: SubjectRef;
};

// Matches spec/finance_research_openapi.yaml `/v1/subjects/resolve` 200 body.
// `alternatives` intentionally projects down to SubjectRef only; richer
// ResolverCandidate metadata stays internal to the resolver.
export type ResolvedSubject = {
  subject_ref: SubjectRef;
  display_name: string;
  confidence: number;
  alternatives?: SubjectRef[];
  identity_level?: SubjectKind;
  display_label?: string;
  display_labels?: SubjectDisplayLabels;
  normalized_input?: string;
  resolution_path?: ResolutionPath;
  context?: HydratedSubjectContext;
};

export type ResolveResponse = {
  subjects: ResolvedSubject[];
  unresolved: string[];
};

export type HydrateSubjectResponse = {
  subject: ResolvedSubject;
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

  let choice: SubjectChoice | undefined;
  if (obj.choice !== undefined) {
    if (typeof obj.choice !== "object" || obj.choice === null) {
      return { valid: false, error: "'choice' must be an object" };
    }
    const choiceObj = obj.choice as Record<string, unknown>;
    const subjectRef = choiceObj.subject_ref;
    if (typeof subjectRef !== "object" || subjectRef === null) {
      return { valid: false, error: "'choice.subject_ref' is required" };
    }
    const ref = subjectRef as Record<string, unknown>;
    if (typeof ref.kind !== "string" || !(SUBJECT_KINDS as readonly string[]).includes(ref.kind)) {
      return { valid: false, error: "'choice.subject_ref.kind' must be a valid SubjectKind" };
    }
    if (typeof ref.id !== "string") {
      return { valid: false, error: "'choice.subject_ref.id' must be a string" };
    }
    choice = { subject_ref: { kind: ref.kind as SubjectKind, id: ref.id } };
  }

  return {
    valid: true,
    request: {
      text: obj.text,
      ...(allow_kinds ? { allow_kinds } : {}),
      ...(choice ? { choice } : {}),
    },
  };
}

export type HydrateRequestValidation =
  | { valid: true; request: HydrateSubjectRequest }
  | { valid: false; error: string };

export function validateHydrateSubjectRequest(body: unknown): HydrateRequestValidation {
  if (typeof body !== "object" || body === null) {
    return { valid: false, error: "request body must be a JSON object" };
  }
  const obj = body as Record<string, unknown>;
  const ref = validateSubjectRef(obj.subject_ref, "subject_ref");
  if (!ref.valid) return { valid: false, error: ref.error };
  return { valid: true, request: { subject_ref: ref.subject_ref } };
}

type SubjectRefValidation =
  | { valid: true; subject_ref: SubjectRef }
  | { valid: false; error: string };

function validateSubjectRef(value: unknown, label: string): SubjectRefValidation {
  if (typeof value !== "object" || value === null) {
    return { valid: false, error: `'${label}' is required` };
  }
  const ref = value as Record<string, unknown>;
  if (typeof ref.kind !== "string" || !(SUBJECT_KINDS as readonly string[]).includes(ref.kind)) {
    return { valid: false, error: `'${label}.kind' must be a valid SubjectKind` };
  }
  if (typeof ref.id !== "string") {
    return { valid: false, error: `'${label}.id' must be a string` };
  }
  return { valid: true, subject_ref: { kind: ref.kind as SubjectKind, id: ref.id } };
}

export async function handleResolveSubjects(
  db: QueryExecutor,
  request: ResolveRequest,
  options: SearchToSubjectOptions = {},
): Promise<ResolveResponse> {
  const flow = await runSearchToSubjectFlow(db, {
    text: request.text,
    ...(request.choice ? { choice: request.choice } : {}),
  }, options);

  if (flow.status === "not_found") {
    return { subjects: [], unresolved: [flow.normalized_input] };
  }

  const allSubjects =
    flow.status === "hydrated"
      ? [subjectFromHandoff(flow.handoff, flow.canonical_selection.alternatives)]
      : flow.candidates.map(candidateToSubject);

  const subjects =
    request.allow_kinds && request.allow_kinds.length > 0
      ? allSubjects.filter((s) => request.allow_kinds!.includes(s.subject_ref.kind))
      : allSubjects;

  const unresolved = subjects.length === 0
    ? [request.text]
    : [];

  return { subjects, unresolved };
}

export async function handleHydrateSubject(
  db: QueryExecutor,
  request: HydrateSubjectRequest,
): Promise<HydrateSubjectResponse> {
  return {
    subject: subjectFromHandoff(await hydrateSubjectRef(db, request.subject_ref), undefined),
  };
}

function subjectFromHandoff(
  handoff: HydratedSubjectHandoff,
  alternatives: ResolverCandidate[] | undefined,
): ResolvedSubject {
  const subject: ResolvedSubject = {
    subject_ref: handoff.subject_ref,
    display_name: handoff.display_label,
    confidence: handoff.confidence,
    identity_level: handoff.identity_level,
    display_label: handoff.display_label,
    display_labels: handoff.display_labels,
    normalized_input: handoff.normalized_input,
    resolution_path: handoff.resolution_path,
    context: handoff.context,
  };
  if (alternatives && alternatives.length > 0) {
    subject.alternatives = alternatives.map((candidate) => candidate.subject_ref);
  }
  return subject;
}

function candidateToSubject(candidate: ResolverCandidate): ResolvedSubject {
  const subject: ResolvedSubject = {
    subject_ref: candidate.subject_ref,
    display_name: candidate.display_name,
    confidence: candidate.confidence,
  };
  if (candidate.display_labels) {
    subject.display_label = candidate.display_name;
    subject.display_labels = candidate.display_labels;
  }
  return subject;
}

export function createResolverServer(
  db: QueryExecutor,
  options: SearchToSubjectOptions = {},
): Server {
  return createServer(async (req, res) => {
    try {
      const route = req.method === "POST" ? req.url : null;
      if (route !== "/v1/subjects/resolve" && route !== "/v1/subjects/hydrate") {
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

      if (route === "/v1/subjects/resolve") {
        const validation = validateResolveRequest(parsed);
        if (!validation.valid) {
          respond(res, 400, { error: validation.error });
          return;
        }

        const response = await handleResolveSubjects(db, validation.request, options);
        respond(res, 200, response);
        return;
      }

      const validation = validateHydrateSubjectRequest(parsed);
      if (!validation.valid) {
        respond(res, 400, { error: validation.error });
        return;
      }

      const response = await handleHydrateSubject(db, validation.request);
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

      if (error instanceof InvalidChoiceError) {
        if (!res.headersSent) {
          respond(res, 400, { error: error.message });
        }
        return;
      }

      if (error instanceof SubjectHydrationNotFoundError) {
        if (!res.headersSent) {
          respond(res, 404, { error: error.message });
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
