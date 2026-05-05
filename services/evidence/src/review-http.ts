import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import {
  approveFactReviewWithPool,
  editFactReviewCandidateWithPool,
  FactReviewThroughputExceededError,
  listFactReviewQueue,
  listStaleFactReviewQueueItems,
  rejectFactReviewWithPool,
  type EditFactReviewCandidateInput,
  type FactClientPool,
  type FactInput,
} from "./fact-repo.ts";
import type { QueryExecutor } from "./types.ts";
import { assertNonEmptyString, assertUuidV4 } from "./validators.ts";
import {
  authenticatedUserRequiredMessage,
  readAuthenticatedUserId,
  type RequestAuthConfig,
} from "../../shared/src/request-auth.ts";

const MAX_REQUEST_BODY_BYTES = 128 * 1024;
const DEFAULT_THROUGHPUT_LIMIT = Object.freeze({ max_actions: 60, window_seconds: 60 * 60 });

export type EvidenceReviewServerDb = QueryExecutor & FactClientPool;

type Route =
  | { action: "healthz" }
  | { action: "list"; stale_after_seconds: number | null; limit: number }
  | { action: "approve"; review_id: string }
  | { action: "reject"; review_id: string }
  | { action: "edit"; review_id: string };

class RequestBodyTooLargeError extends Error {
  constructor() {
    super("request body too large");
  }
}

export function createEvidenceReviewServer(
  db: EvidenceReviewServerDb,
  options: { auth?: RequestAuthConfig; clock?: () => Date } = {},
): Server {
  const clock = options.clock ?? (() => new Date());

  return createServer(async (req, res) => {
    try {
      const route = matchRoute(req.method ?? "GET", req.url ?? "/");
      if (route === null) {
        respond(res, 404, { error: "not found" });
        return;
      }

      if (route.action === "healthz") {
        respond(res, 200, { status: "ok", service: "evidence-review" });
        return;
      }

      const reviewerId = readAuthenticatedUserId(req, options.auth);
      if (reviewerId === null) {
        respond(res, 401, { error: authenticatedUserRequiredMessage(options.auth) });
        return;
      }

      if (route.action === "list") {
        const items =
          route.stale_after_seconds == null
            ? await listFactReviewQueue(db, { status: "queued", limit: route.limit })
            : await listStaleFactReviewQueueItems(db, {
                now: clock().toISOString(),
                stale_after_seconds: route.stale_after_seconds,
                limit: route.limit,
              });
        respond(res, 200, { items });
        return;
      }

      const body = await readJsonBody(req);
      const notes = optionalNotes(body);

      if (route.action === "approve") {
        const result = await approveFactReviewWithPool(db, {
          review_id: route.review_id,
          reviewer_id: reviewerId,
          notes,
          candidate: optionalCandidate(body),
          throughput_limit: DEFAULT_THROUGHPUT_LIMIT,
        });
        respond(res, 200, result);
        return;
      }

      if (route.action === "reject") {
        const review = await rejectFactReviewWithPool(db, {
          review_id: route.review_id,
          reviewer_id: reviewerId,
          notes,
          throughput_limit: DEFAULT_THROUGHPUT_LIMIT,
        });
        respond(res, 200, { review });
        return;
      }

      const candidate = requiredCandidate(body);
      const review = await editFactReviewCandidateWithPool(db, {
        review_id: route.review_id,
        reviewer_id: reviewerId,
        notes,
        candidate,
        throughput_limit: DEFAULT_THROUGHPUT_LIMIT,
      } satisfies EditFactReviewCandidateInput);
      respond(res, 200, { review });
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        if (!res.headersSent) respond(res, 413, { error: error.message });
        return;
      }
      if (error instanceof SyntaxError) {
        if (!res.headersSent) respond(res, 400, { error: "request body must be valid JSON" });
        return;
      }
      if (error instanceof FactReviewThroughputExceededError) {
        if (!res.headersSent) respond(res, 429, { error: error.message });
        return;
      }
      if (error instanceof Error && isClientError(error)) {
        if (!res.headersSent) respond(res, 400, { error: error.message });
        return;
      }

      console.error("evidence review request failed", error);
      if (!res.headersSent) respond(res, 500, { error: "internal evidence review error" });
    }
  });
}

function matchRoute(method: string, rawUrl: string): Route | null {
  const url = new URL(rawUrl, "http://localhost");
  const { pathname, searchParams } = url;

  if (method === "GET" && (pathname === "/healthz" || pathname === "/v1/evidence/healthz")) {
    return { action: "healthz" };
  }

  if (method === "GET" && pathname === "/v1/evidence/fact-review-queue") {
    return {
      action: "list",
      stale_after_seconds: optionalPositiveInteger(searchParams.get("stale_after_seconds"), "stale_after_seconds"),
      limit: optionalPositiveInteger(searchParams.get("limit"), "limit") ?? 50,
    };
  }

  const actionMatch = pathname.match(/^\/v1\/evidence\/fact-review-queue\/([^/]+)\/(approve|reject|candidate)$/);
  if (!actionMatch) return null;

  let reviewId: string;
  try {
    reviewId = decodeURIComponent(actionMatch[1]);
  } catch {
    return null;
  }
  assertUuidV4(reviewId, "review_id");

  if (method === "POST" && actionMatch[2] === "approve") return { action: "approve", review_id: reviewId };
  if (method === "POST" && actionMatch[2] === "reject") return { action: "reject", review_id: reviewId };
  if (method === "PATCH" && actionMatch[2] === "candidate") return { action: "edit", review_id: reviewId };
  return null;
}

function optionalPositiveInteger(value: string | null, label: string): number | null {
  if (value == null || value.trim().length === 0) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label}: must be a positive integer`);
  }
  return parsed;
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const raw = await readBody(req);
  const parsed = raw.trim().length === 0 ? {} : JSON.parse(raw);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("request body must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    const buffer =
      Buffer.isBuffer(chunk) ? chunk : chunk instanceof Uint8Array ? Buffer.from(chunk) : Buffer.from(String(chunk));
    totalBytes += buffer.length;
    if (totalBytes > MAX_REQUEST_BODY_BYTES) throw new RequestBodyTooLargeError();
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function optionalNotes(body: Record<string, unknown>): string | null {
  if (body.notes == null) return null;
  assertNonEmptyString(body.notes, "notes");
  return body.notes;
}

function optionalCandidate(body: Record<string, unknown>): FactInput | undefined {
  if (body.candidate == null) return undefined;
  return candidateFromBody(body.candidate);
}

function requiredCandidate(body: Record<string, unknown>): FactInput {
  if (body.candidate == null) throw new Error("candidate is required");
  return candidateFromBody(body.candidate);
}

function candidateFromBody(value: unknown): FactInput {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("candidate must be a JSON object");
  }
  return value as FactInput;
}

function isClientError(error: Error): boolean {
  return (
    /must be|is required|not found|no longer queued|review_id|candidate|notes|limit|stale_after_seconds/.test(error.message) ||
    error.message.includes("JSON object")
  );
}

function respond(res: ServerResponse, status: number, body: object) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}
