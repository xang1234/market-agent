import type { IncomingMessage, ServerResponse } from "node:http";

import {
  archiveThread,
  ChatThreadNotFoundError,
  ChatThreadValidationError,
  createThread,
  listThreads,
  updateThreadTitle,
  type ChatThread,
  type ChatThreadsDb,
  type CreateThreadInput,
} from "./threads-repo.ts";
import {
  authenticatedUserRequiredMessage,
  readAuthenticatedUserId,
  type RequestAuthConfig,
} from "../../shared/src/request-auth.ts";

const MAX_REQUEST_BODY_BYTES = 16 * 1024;
const ROUTE_PREFIX = "/v1/chat/threads";

class RequestBodyTooLargeError extends Error {
  constructor() {
    super("request body too large");
  }
}

export type ListThreadsResponse = { threads: ChatThread[] };

// Returns true when the request matched a /v1/chat/threads CRUD route and a
// response has been sent. Returns false to let the caller fall through to
// other handlers (e.g., the SSE stream route).
export async function tryHandleThreadsRequest(
  db: ChatThreadsDb,
  req: IncomingMessage,
  res: ServerResponse,
  auth?: RequestAuthConfig,
): Promise<boolean> {
  const rawUrl = req.url ?? "/";
  // Fast-path: skip URL parsing for requests that can't possibly match.
  // The SSE stream route under /v1/chat/threads/{id}/stream goes through here
  // on every request when threadsDb is wired, so the early-return matters.
  if (!rawUrl.startsWith(ROUTE_PREFIX)) return false;

  const route = matchRoute(req.method ?? "GET", rawUrl);
  if (route == null) return false;

  try {
    const userId = readAuthenticatedUserId(req, auth);
    if (!userId) {
      respond(res, 401, { error: authenticatedUserRequiredMessage(auth) });
      return true;
    }

    if (route.action === "list") {
      const threads = await listThreads(db, userId, { includeArchived: route.includeArchived });
      respond(res, 200, { threads } satisfies ListThreadsResponse);
      return true;
    }

    if (route.action === "create") {
      const body = await readJsonBody(req);
      if (body === BAD_JSON) {
        respond(res, 400, { error: "request body must be valid JSON" });
        return true;
      }
      try {
        const input = parseCreateInput(body);
        const thread = await createThread(db, userId, input);
        respond(res, 201, thread);
      } catch (error) {
        if (mapThreadError(res, error)) return true;
        throw error;
      }
      return true;
    }

    if (route.action === "patch_title") {
      const body = await readJsonBody(req);
      if (body === BAD_JSON || typeof body !== "object" || body === null) {
        respond(res, 400, { error: "request body must be a JSON object" });
        return true;
      }
      const obj = body as Record<string, unknown>;
      if (!("title" in obj)) {
        respond(res, 400, { error: "'title' is required" });
        return true;
      }
      const titleField = obj.title;
      if (titleField !== null && typeof titleField !== "string") {
        respond(res, 400, { error: "'title' must be a string or null" });
        return true;
      }
      try {
        const thread = await updateThreadTitle(db, userId, route.threadId, { title: titleField });
        respond(res, 200, thread);
      } catch (error) {
        if (mapThreadError(res, error)) return true;
        throw error;
      }
      return true;
    }

    if (route.action === "archive") {
      try {
        await archiveThread(db, userId, route.threadId);
        res.statusCode = 204;
        res.end();
      } catch (error) {
        if (mapThreadError(res, error)) return true;
        throw error;
      }
      return true;
    }

    return false;
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      // Drain any remaining request bytes and force-close the keep-alive
      // connection. readBody() threw mid-iteration, leaving unread bytes in
      // the socket buffer that would corrupt the next pipelined request.
      req.resume();
      if (!res.headersSent) {
        res.setHeader("connection", "close");
        respond(res, 413, { error: error.message });
      }
      return true;
    }
    console.error("chat threads request failed", error);
    if (!res.headersSent) respond(res, 500, { error: "internal chat threads error" });
    return true;
  }
}

function mapThreadError(res: ServerResponse, error: unknown): boolean {
  if (error instanceof ChatThreadValidationError) {
    respond(res, 400, { error: error.message });
    return true;
  }
  if (error instanceof ChatThreadNotFoundError) {
    respond(res, 404, { error: error.message });
    return true;
  }
  return false;
}

type Route =
  | { action: "list"; includeArchived: boolean }
  | { action: "create" }
  | { action: "patch_title"; threadId: string }
  | { action: "archive"; threadId: string };

function matchRoute(method: string, rawUrl: string): Route | null {
  const url = new URL(rawUrl, "http://localhost");
  const { pathname } = url;

  if (pathname === ROUTE_PREFIX) {
    if (method === "GET") {
      return { action: "list", includeArchived: parseIncludeArchived(url) };
    }
    if (method === "POST") return { action: "create" };
    return null;
  }

  const match = pathname.match(/^\/v1\/chat\/threads\/([^/]+)$/);
  if (match) {
    let threadId: string;
    try {
      threadId = decodeURIComponent(match[1]);
    } catch {
      return null;
    }
    if (threadId.length === 0) return null;
    if (method === "PATCH") return { action: "patch_title", threadId };
    if (method === "DELETE") return { action: "archive", threadId };
    return null;
  }

  return null;
}

function parseIncludeArchived(url: URL): boolean {
  const raw = url.searchParams.get("include_archived");
  return raw === "true" || raw === "1";
}

const BAD_JSON = Symbol("BAD_JSON");

async function readJsonBody(req: IncomingMessage): Promise<unknown | typeof BAD_JSON> {
  const text = await readBody(req);
  if (text === "") return null;
  try {
    return JSON.parse(text);
  } catch {
    return BAD_JSON;
  }
}

// Defers kind/id validation to the repo so the wire-format and value-format
// error messages share one source.
function parseCreateInput(body: unknown): CreateThreadInput {
  if (body === null || body === undefined) return {};
  if (typeof body !== "object") {
    throw new ChatThreadValidationError("request body must be an object");
  }
  const obj = body as Record<string, unknown>;
  const input: CreateThreadInput = {};
  if (obj.title !== undefined) {
    if (obj.title !== null && typeof obj.title !== "string") {
      throw new ChatThreadValidationError("title must be a string or null");
    }
    input.title = obj.title;
  }
  if (obj.primary_subject_ref !== undefined) {
    if (typeof obj.primary_subject_ref !== "object" || obj.primary_subject_ref === null) {
      throw new ChatThreadValidationError("primary_subject_ref must be an object with kind and id");
    }
    input.primary_subject_ref = obj.primary_subject_ref as CreateThreadInput["primary_subject_ref"];
  }
  return input;
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    const buffer =
      Buffer.isBuffer(chunk)
        ? chunk
        : chunk instanceof Uint8Array
          ? Buffer.from(chunk)
          : Buffer.from(String(chunk));
    totalBytes += buffer.length;
    if (totalBytes > MAX_REQUEST_BODY_BYTES) throw new RequestBodyTooLargeError();
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function respond(res: ServerResponse, status: number, body: object) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}
