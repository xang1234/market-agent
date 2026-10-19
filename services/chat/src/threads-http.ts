import type { IncomingMessage, ServerResponse } from "node:http";

import type { ChatActiveRun, ChatCoordinator, ChatRunStatus } from "./coordinator.ts";

import {
  ChatMessageIdempotencyConflictError,
  listChatMessagesForThread,
  persistUserChatMessage,
  type ChatReadMessage,
} from "./messages.ts";
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
import { isUuid } from "./chat-ids.ts";
import { readBody, RequestBodyTooLargeError, respondJson } from "../../shared/src/http.ts";

const MAX_REQUEST_BODY_BYTES = 16 * 1024;
const ROUTE_PREFIX = "/v1/chat/threads";

export type ListThreadsResponse = { threads: ChatThread[] };

// active_run is always present: null when no turn of the caller's is in flight.
export type ThreadMessagesResponse = {
  messages: ReadonlyArray<ChatReadMessage>;
  active_run: { run_id: string; turn_id: string } | null;
  runs: ReadonlyArray<RunStatusJson>;
};

type RunStatusJson = { run_id: string; turn_id: string; status: ChatRunStatus["status"]; message_id?: string };

function activeRunJson(run: ChatActiveRun | null): ThreadMessagesResponse["active_run"] {
  return run && { run_id: run.runId, turn_id: run.turnId };
}

function runStatusJson(run: ChatRunStatus): RunStatusJson {
  const json: RunStatusJson = { run_id: run.runId, turn_id: run.turnId, status: run.status };
  if (run.status === "completed" && run.messageId !== undefined) json.message_id = run.messageId;
  return json;
}

// Returns true when the request matched a /v1/chat/threads CRUD route and a
// response has been sent. Returns false to let the caller fall through to
// other handlers (e.g., the SSE stream route).
export async function tryHandleThreadsRequest(
  db: ChatThreadsDb,
  req: IncomingMessage,
  res: ServerResponse,
  runs: Pick<ChatCoordinator, "readThread">,
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
      respondJson(res, 401, { error: authenticatedUserRequiredMessage(auth) });
      return true;
    }

    if (route.action === "list") {
      const threads = await listThreads(db, userId, { includeArchived: route.includeArchived });
      respondJson(res, 200, { threads } satisfies ListThreadsResponse);
      return true;
    }

    if (route.action === "create") {
      const body = await readJsonBody(req);
      if (body === BAD_JSON) {
        respondJson(res, 400, { error: "request body must be valid JSON" });
        return true;
      }
      try {
        const input = parseCreateInput(body);
        const thread = await createThread(db, userId, input);
        respondJson(res, 201, thread);
      } catch (error) {
        if (mapThreadError(res, error)) return true;
        throw error;
      }
      return true;
    }

    if (route.action === "messages") {
      if (route.method === "POST") {
        const body = await readJsonBody(req);
        if (body === BAD_JSON || typeof body !== "object" || body === null) {
          respondJson(res, 400, { error: "request body must be a JSON object" });
          return true;
        }
        const input = parseUserMessageInput(body);
        if (input.kind === "error") {
          respondJson(res, 400, { error: input.message });
          return true;
        }
        let message;
        try {
          message = await persistUserChatMessage(db, {
            thread_id: route.threadId,
            user_id: userId,
            content: input.value.content,
            message_id: input.value.message_id,
            snapshot_id: input.value.snapshot_id,
          });
        } catch (error) {
          if (error instanceof ChatMessageIdempotencyConflictError) {
            respondJson(res, 409, { error: error.message });
            return true;
          }
          throw error;
        }
        if (message === null) {
          respondJson(res, 404, { error: "chat thread not found" });
          return true;
        }
        respondJson(res, 201, { message });
        return true;
      }
      const result = await runs.readThread({ userId, threadId: route.threadId }, async () =>
        (await listChatMessagesForThread(db, { thread_id: route.threadId, user_id: userId }))?.messages ?? null);
      if (result === null) {
        respondJson(res, 404, { error: "chat thread not found" });
        return true;
      }
      respondJson(res, 200, {
        messages: result.messages,
        active_run: activeRunJson(result.activeRun),
        runs: result.runs.map(runStatusJson),
      } satisfies ThreadMessagesResponse);
      return true;
    }

    if (route.action === "patch_title") {
      const body = await readJsonBody(req);
      if (body === BAD_JSON || typeof body !== "object" || body === null) {
        respondJson(res, 400, { error: "request body must be a JSON object" });
        return true;
      }
      const obj = body as Record<string, unknown>;
      if (!("title" in obj)) {
        respondJson(res, 400, { error: "'title' is required" });
        return true;
      }
      const titleField = obj.title;
      if (titleField !== null && typeof titleField !== "string") {
        respondJson(res, 400, { error: "'title' must be a string or null" });
        return true;
      }
      try {
        const thread = await updateThreadTitle(db, userId, route.threadId, { title: titleField });
        respondJson(res, 200, thread);
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
        respondJson(res, 413, { error: error.message });
      }
      return true;
    }
    console.error("chat threads request failed", error);
    if (!res.headersSent) respondJson(res, 500, { error: "internal chat threads error" });
    return true;
  }
}

function mapThreadError(res: ServerResponse, error: unknown): boolean {
  if (error instanceof ChatThreadValidationError) {
    respondJson(res, 400, { error: error.message });
    return true;
  }
  if (error instanceof ChatThreadNotFoundError) {
    respondJson(res, 404, { error: error.message });
    return true;
  }
  return false;
}

type Route =
  | { action: "list"; includeArchived: boolean }
  | { action: "create" }
  | { action: "messages"; method: "GET" | "POST"; threadId: string }
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

  const messagesMatch = pathname.match(/^\/v1\/chat\/threads\/([^/]+)\/messages$/);
  if (messagesMatch) {
    let threadId: string;
    try {
      threadId = decodeURIComponent(messagesMatch[1]);
    } catch {
      return null;
    }
    if (threadId.length === 0) return null;
    if (method === "GET" || method === "POST") return { action: "messages", method, threadId };
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
  const text = await readBody(req, { maxBytes: MAX_REQUEST_BODY_BYTES });
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

type UserMessageInputParseResult =
  | { kind: "ok"; value: { content: string; message_id?: string; snapshot_id?: string } }
  | { kind: "error"; message: string };

function parseUserMessageInput(body: object): UserMessageInputParseResult {
  const candidate = body as Record<string, unknown>;
  const content = typeof candidate.content === "string" ? candidate.content.trim() : "";
  if (content.length === 0) return { kind: "error", message: "'content' is required" };
  const messageId = parseOptionalUuid(candidate.message_id);
  if (messageId.kind === "error") return { kind: "error", message: "'message_id' must be a UUID" };
  const snapshotId = parseOptionalUuid(candidate.snapshot_id);
  if (snapshotId.kind === "error") return { kind: "error", message: "'snapshot_id' must be a UUID" };
  return {
    kind: "ok",
    value: {
      content,
      message_id: messageId.value,
      snapshot_id: snapshotId.value,
    },
  };
}

function parseOptionalUuid(value: unknown): { kind: "ok"; value?: string } | { kind: "error" } {
  if (value === undefined || value === null) return { kind: "ok" };
  if (typeof value !== "string") return { kind: "error" };
  const trimmed = value.trim();
  if (trimmed === "") return { kind: "ok" };
  if (!isUuid(trimmed)) return { kind: "error" };
  return { kind: "ok", value: trimmed };
}
