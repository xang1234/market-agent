import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  DefaultWatchlistDeleteError,
  addMember,
  createWatchlist,
  deleteWatchlist,
  findDefaultManualWatchlistId,
  listMembers,
  listWatchlists,
  MemberNotFoundError,
  renameWatchlist,
  removeMember,
  WatchlistNotFoundError,
  WatchlistValidationError,
  WATCHLIST_MODES,
  type QueryExecutor,
  type WatchlistInput,
  type WatchlistMode,
  type WatchlistMember,
  type WatchlistRow,
} from "./queries.ts";
import { isSubjectRef, SUBJECT_KINDS, type SubjectKind, type SubjectRef } from "./subject-ref.ts";
import {
  authenticatedUserRequiredMessage,
  readAuthenticatedUserId,
  type RequestAuthConfig,
} from "../../shared/src/request-auth.ts";

const MAX_REQUEST_BODY_BYTES = 16 * 1024;

class RequestBodyTooLargeError extends Error {
  constructor() {
    super("request body too large");
  }
}

export type ListMembersResponse = { members: WatchlistMember[] };
export type AddMemberResponse = { status: "created" | "already_present"; member: WatchlistMember };
export type ListWatchlistsResponse = { watchlists: ReadonlyArray<WatchlistRow> };

export function createWatchlistsServer(
  db: QueryExecutor,
  options: { auth?: RequestAuthConfig } = {},
): Server {
  return createServer(async (req, res) => {
    try {
      const userId = readAuthenticatedUserId(req, options.auth);
      if (!userId) {
        respond(res, 401, { error: authenticatedUserRequiredMessage(options.auth) });
        return;
      }

      const route = matchRoute(req.method ?? "GET", req.url ?? "/");
      if (!route) {
        respond(res, 404, { error: "not found" });
        return;
      }

      if (route.action === "list_watchlists") {
        const watchlists = await listWatchlists(db, userId);
        respond(res, 200, { watchlists } satisfies ListWatchlistsResponse);
        return;
      }

      if (route.action === "create_watchlist") {
        const parsed = await readJsonObject(req, res);
        if (parsed === null) return;
        const input = extractWatchlistInput(parsed);
        if (!input) {
          respond(res, 400, { error: "'name' and valid 'mode' are required" });
          return;
        }
        const watchlist = await createWatchlist(db, userId, input);
        respond(res, 201, watchlist);
        return;
      }

      if (route.action === "rename_watchlist") {
        const parsed = await readJsonObject(req, res);
        if (parsed === null) return;
        const name = typeof parsed.name === "string" ? parsed.name : null;
        if (name === null) {
          respond(res, 400, { error: "'name' is required" });
          return;
        }
        const watchlist = await renameWatchlist(db, userId, route.watchlist_id, name);
        respond(res, 200, watchlist);
        return;
      }

      if (route.action === "delete_watchlist") {
        await deleteWatchlist(db, userId, route.watchlist_id);
        res.statusCode = 204;
        res.end();
        return;
      }

      const watchlistId = await findDefaultManualWatchlistId(db, userId);

      if (route.action === "list") {
        const members = await listMembers(db, watchlistId);
        respond(res, 200, { members } satisfies ListMembersResponse);
        return;
      }

      if (route.action === "add") {
        const parsed = await readJsonObject(req, res);
        if (parsed === null) return;
        const subjectRef = extractSubjectRef(parsed);
        if (!subjectRef) {
          respond(res, 400, { error: "'subject_ref' with kind and id is required" });
          return;
        }
        const result = await addMember(db, watchlistId, subjectRef);
        const status = result.status === "created" ? 201 : 200;
        respond(res, status, { status: result.status, member: result.member } satisfies AddMemberResponse);
        return;
      }

      if (route.action === "remove") {
        await removeMember(db, watchlistId, route.subject_ref);
        res.statusCode = 204;
        res.end();
        return;
      }
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        if (!res.headersSent) respond(res, 413, { error: error.message });
        return;
      }
      if (error instanceof WatchlistNotFoundError) {
        if (!res.headersSent) respond(res, 404, { error: error.message });
        return;
      }
      if (error instanceof DefaultWatchlistDeleteError) {
        if (!res.headersSent) respond(res, 409, { error: error.message });
        return;
      }
      if (error instanceof WatchlistValidationError) {
        if (!res.headersSent) respond(res, 400, { error: error.message });
        return;
      }
      if (error instanceof MemberNotFoundError) {
        if (!res.headersSent) respond(res, 404, { error: error.message });
        return;
      }

      console.error("watchlists request failed", error);
      if (!res.headersSent) respond(res, 500, { error: "internal watchlists error" });
    }
  });
}

type Route =
  | { action: "list_watchlists" }
  | { action: "create_watchlist" }
  | { action: "rename_watchlist"; watchlist_id: string }
  | { action: "delete_watchlist"; watchlist_id: string }
  | { action: "list" }
  | { action: "add" }
  | { action: "remove"; subject_ref: SubjectRef };

function matchRoute(method: string, rawUrl: string): Route | null {
  const url = new URL(rawUrl, "http://localhost");
  const { pathname } = url;

  if (pathname === "/v1/watchlists") {
    if (method === "GET") return { action: "list_watchlists" };
    if (method === "POST") return { action: "create_watchlist" };
    return null;
  }

  const watchlistMatch = pathname.match(/^\/v1\/watchlists\/([^/]+)$/);
  if (watchlistMatch) {
    let watchlistId: string;
    try {
      watchlistId = decodeURIComponent(watchlistMatch[1]);
    } catch {
      return null;
    }
    if (watchlistId.length === 0 || watchlistId === "default") return null;
    if (method === "PATCH") return { action: "rename_watchlist", watchlist_id: watchlistId };
    if (method === "DELETE") return { action: "delete_watchlist", watchlist_id: watchlistId };
    return null;
  }

  if (pathname === "/v1/watchlists/default/members") {
    if (method === "GET") return { action: "list" };
    if (method === "POST") return { action: "add" };
    return null;
  }

  const match = pathname.match(/^\/v1\/watchlists\/default\/members\/([^/]+)\/([^/]+)$/);
  if (match && method === "DELETE") {
    let kind: string;
    let id: string;
    try {
      kind = decodeURIComponent(match[1]);
      id = decodeURIComponent(match[2]);
    } catch {
      return null;
    }
    if (!(SUBJECT_KINDS as readonly string[]).includes(kind)) return null;
    if (id.length === 0) return null;
    return { action: "remove", subject_ref: { kind: kind as SubjectKind, id } };
  }

  return null;
}

function extractSubjectRef(body: unknown): SubjectRef | null {
  if (typeof body !== "object" || body === null) return null;
  const obj = body as Record<string, unknown>;
  return isSubjectRef(obj.subject_ref) ? obj.subject_ref : null;
}

function extractWatchlistInput(body: Record<string, unknown>): WatchlistInput | null {
  const { name, mode, membership_spec } = body;
  if (typeof name !== "string") return null;
  if (typeof mode !== "string" || !(WATCHLIST_MODES as readonly string[]).includes(mode)) {
    return null;
  }
  return {
    name,
    mode: mode as WatchlistMode,
    membership_spec:
      membership_spec === undefined ? null : (membership_spec as WatchlistInput["membership_spec"]),
  };
}

async function readJsonObject(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<Record<string, unknown> | null> {
  const body = await readBody(req);
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    respond(res, 400, { error: "request body must be valid JSON" });
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    respond(res, 400, { error: "request body must be a JSON object" });
    return null;
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

function respond(res: ServerResponse, status: number, body: object) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}
