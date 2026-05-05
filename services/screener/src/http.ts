import { randomUUID } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { ScreenerCandidateRepository } from "./candidate.ts";
import { executeScreenerQuery } from "./executor.ts";
import {
  assertScreenerQueryContract,
  type ScreenerQuery,
} from "./query.ts";
import {
  ScreenNotFoundError,
  type ScreenRepository,
} from "./screen-repository.ts";
import {
  persistScreen,
  replayScreen,
  type ScreenSubject,
} from "./screen-subject.ts";
import { isUuidV4 } from "./validators.ts";
import {
  authenticatedUserRequiredMessage,
  readAuthenticatedUserId,
  type RequestAuthConfig,
} from "../../shared/src/request-auth.ts";

export type ScreenerServerDeps = {
  candidates: ScreenerCandidateRepository;
  screens: ScreenRepository;
  clock?: () => Date;
  auth?: RequestAuthConfig;
};

const MAX_REQUEST_BODY_BYTES = 64 * 1024;

// /v1/screener/screens/:id  and  /v1/screener/screens/:id/replay
const SCREEN_PATH_RE = /^\/v1\/screener\/screens\/([^/]+)(?:\/(replay))?$/;

export function createScreenerServer(deps: ScreenerServerDeps): Server {
  const clock = deps.clock ?? (() => new Date());

  return createServer(async (req, res) => {
    try {
      const route = matchRoute(req.method ?? "GET", req.url ?? "/");
      if (!route) {
        respond(res, 404, { error: "not found" });
        return;
      }

      switch (route.action) {
        case "healthz":
          respond(res, 200, { status: "ok", service: "screener" });
          return;
        case "search":
          await handleSearch(req, res, deps, clock);
          return;
        case "save_screen":
          await handleSaveScreen(req, res, deps, clock);
          return;
        case "list_screens":
          await handleListScreens(req, res, deps);
          return;
        case "get_screen":
          await handleGetScreen(req, res, deps, route.screen_id);
          return;
        case "delete_screen":
          await handleDeleteScreen(req, res, deps, route.screen_id);
          return;
        case "replay_screen":
          await handleReplayScreen(req, res, deps, clock, route.screen_id);
          return;
        default: {
          const _exhaustive: never = route;
          void _exhaustive;
          respond(res, 500, { error: "unhandled route" });
          return;
        }
      }
    } catch (error) {
      if (error instanceof ScreenNotFoundError) {
        if (!res.headersSent) respond(res, 404, { error: error.message });
        return;
      }
      console.error("screener request failed", error);
      if (!res.headersSent) respond(res, 500, { error: "internal screener error" });
    }
  });
}

type Route =
  | { action: "healthz" }
  | { action: "search" }
  | { action: "save_screen" }
  | { action: "list_screens" }
  | { action: "get_screen"; screen_id: string }
  | { action: "delete_screen"; screen_id: string }
  | { action: "replay_screen"; screen_id: string };

function matchRoute(method: string, rawUrl: string): Route | null {
  const url = new URL(rawUrl, "http://localhost");
  const { pathname } = url;

  if (method === "GET" && pathname === "/healthz") return { action: "healthz" };
  if (method === "POST" && pathname === "/v1/screener/search") return { action: "search" };
  if (method === "POST" && pathname === "/v1/screener/screens") return { action: "save_screen" };
  if (method === "GET" && pathname === "/v1/screener/screens") return { action: "list_screens" };

  const screenMatch = SCREEN_PATH_RE.exec(pathname);
  if (screenMatch) {
    const screen_id = screenMatch[1];
    const tail = screenMatch[2];
    if (!isUuidV4(screen_id)) return null;
    if (tail === "replay") {
      if (method !== "POST") return null;
      return { action: "replay_screen", screen_id };
    }
    if (method === "GET") return { action: "get_screen", screen_id };
    if (method === "DELETE") return { action: "delete_screen", screen_id };
  }

  return null;
}

async function handleSearch(
  req: IncomingMessage,
  res: ServerResponse,
  deps: ScreenerServerDeps,
  clock: () => Date,
): Promise<void> {
  const body = await readJsonBody(req, MAX_REQUEST_BODY_BYTES);
  if (body.kind === "error") {
    respond(res, body.status, { error: body.error });
    return;
  }
  let query: ScreenerQuery;
  try {
    assertScreenerQueryContract(body.value);
    query = body.value;
  } catch (err) {
    respond(res, 400, { error: errorMessage(err, "invalid screener query") });
    return;
  }
  const response = executeScreenerQuery(
    { candidates: deps.candidates, clock },
    query,
  );
  respond(res, 200, response);
}

async function handleSaveScreen(
  req: IncomingMessage,
  res: ServerResponse,
  deps: ScreenerServerDeps,
  clock: () => Date,
): Promise<void> {
  const user_id = readAuthenticatedUserId(req, deps.auth);
  if (!user_id) {
    respond(res, 401, { error: authenticatedUserRequiredMessage(deps.auth) });
    return;
  }

  const body = await readJsonBody(req, MAX_REQUEST_BODY_BYTES);
  if (body.kind === "error") {
    respond(res, body.status, { error: body.error });
    return;
  }
  if (body.value === null || typeof body.value !== "object") {
    respond(res, 400, { error: "request body must be an object" });
    return;
  }
  const raw = body.value as Record<string, unknown>;
  const screen_id =
    typeof raw.screen_id === "string" ? raw.screen_id : randomUUID();
  const now = clock().toISOString();
  // The server is authoritative for both timestamps. created_at is preserved
  // from the existing record on replace; updated_at is always bumped to `now`
  // so neither can be spoofed by the client.
  const existing = isUuidV4(screen_id) ? await deps.screens.find(screen_id) : null;
  if (existing && existing.user_id !== user_id) {
    respond(res, 404, { error: `screen not found: ${screen_id}` });
    return;
  }
  const created_at = existing?.created_at ?? now;
  const updated_at = now;

  let screen: ScreenSubject;
  try {
    screen = persistScreen({
      screen_id,
      user_id,
      name: raw.name as string,
      definition: raw.definition as ScreenerQuery,
      created_at,
      updated_at,
    });
  } catch (err) {
    respond(res, 400, { error: errorMessage(err, "invalid screen subject") });
    return;
  }

  const result = await deps.screens.save(screen);
  respond(res, result.status === "created" ? 201 : 200, {
    status: result.status,
    screen: result.screen,
  });
}

async function handleListScreens(
  req: IncomingMessage,
  res: ServerResponse,
  deps: ScreenerServerDeps,
): Promise<void> {
  const user_id = readAuthenticatedUserId(req, deps.auth);
  if (!user_id) {
    respond(res, 401, { error: authenticatedUserRequiredMessage(deps.auth) });
    return;
  }
  const screens = await deps.screens.listForUser(user_id);
  respond(res, 200, { screens });
}

async function handleGetScreen(
  req: IncomingMessage,
  res: ServerResponse,
  deps: ScreenerServerDeps,
  screen_id: string,
): Promise<void> {
  const screen = await loadScreenForUserOrThrow(req, res, deps, screen_id);
  if (!screen) return;
  respond(res, 200, { screen });
}

async function handleDeleteScreen(
  req: IncomingMessage,
  res: ServerResponse,
  deps: ScreenerServerDeps,
  screen_id: string,
): Promise<void> {
  const screen = await loadScreenForUserOrThrow(req, res, deps, screen_id);
  if (!screen) return;
  await deps.screens.delete(screen_id);
  res.statusCode = 204;
  res.end();
}

async function handleReplayScreen(
  req: IncomingMessage,
  res: ServerResponse,
  deps: ScreenerServerDeps,
  clock: () => Date,
  screen_id: string,
): Promise<void> {
  const screen = await loadScreenForUserOrThrow(req, res, deps, screen_id);
  if (!screen) return;
  const response = executeScreenerQuery(
    { candidates: deps.candidates, clock },
    replayScreen(screen),
  );
  respond(res, 200, response);
}

async function loadScreenForUserOrThrow(
  req: IncomingMessage,
  res: ServerResponse,
  deps: ScreenerServerDeps,
  screen_id: string,
): Promise<ScreenSubject | null> {
  const user_id = readAuthenticatedUserId(req, deps.auth);
  if (!user_id) {
    respond(res, 401, { error: authenticatedUserRequiredMessage(deps.auth) });
    return null;
  }
  const screen = await loadScreenOrThrow(deps, screen_id);
  if (screen.user_id !== user_id) throw new ScreenNotFoundError(screen_id);
  return screen;
}

async function loadScreenOrThrow(
  deps: ScreenerServerDeps,
  screen_id: string,
): Promise<ScreenSubject> {
  const screen = await deps.screens.find(screen_id);
  if (!screen) throw new ScreenNotFoundError(screen_id);
  return screen;
}

function respond(res: ServerResponse, status: number, body: object) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

type JsonBodyResult =
  | { kind: "ok"; value: unknown }
  | { kind: "error"; status: number; error: string };

async function readJsonBody(
  req: IncomingMessage,
  maxBytes: number,
): Promise<JsonBodyResult> {
  const contentType = (req.headers["content-type"] ?? "").toString().toLowerCase();
  if (!contentType.startsWith("application/json")) {
    return { kind: "error", status: 415, error: "content-type must be application/json" };
  }
  let total = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    const buf = chunk instanceof Buffer ? chunk : Buffer.from(chunk as Uint8Array);
    total += buf.byteLength;
    if (total > maxBytes) {
      return { kind: "error", status: 413, error: `request body exceeds ${maxBytes} bytes` };
    }
    chunks.push(buf);
  }
  if (total === 0) {
    return { kind: "error", status: 400, error: "request body is empty" };
  }
  const text = Buffer.concat(chunks, total).toString("utf8");
  try {
    return { kind: "ok", value: JSON.parse(text) };
  } catch (err) {
    return { kind: "error", status: 400, error: `invalid JSON: ${errorMessage(err, "parse failed")}` };
  }
}

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message.length > 0) return err.message;
  if (typeof err === "string" && err.length > 0) return err;
  return fallback;
}
