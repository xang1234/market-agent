// Financial answer HTTP: run status, committed result inspection, and pinned
// replay requests. The caller is authenticated before this handler runs (the
// deployment's trusted mechanism supplies `userId`); the handler never reads
// identity from the request itself. GETs only read. Every miss — another
// owner's run, an uncommitted result, revoked evidence — is the same 404, and
// responses are private to the caller and never cached by shared caches.

import type { IncomingMessage, ServerResponse } from "node:http";

import { inspectCommittedResult } from "./inspection.ts";
import type { SqlExecutor } from "./ports.ts";
import { readRunStatus } from "./read-model.ts";
import { reserveReplayRun } from "./run-repo.ts";

/** Reads go through the pool; the one transactional write (replay reservation) pins a connection. */
export type FinancialPool = SqlExecutor & { connect(): Promise<SqlExecutor & { release(): void }> };

export type FinancialHttpDeps = Readonly<{ userId: string; db: FinancialPool }>;

export const FINANCIAL_HTTP_PREFIX = "/v1/financial/";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const REQUEST_KEY = /^[A-Za-z0-9_.:-]{1,128}$/u;
const MAX_BODY_BYTES = 4096;

type Reply = { status: number; body: object };

export function isFinancialHttpPath(pathname: string): boolean {
  return pathname.startsWith(FINANCIAL_HTTP_PREFIX);
}

export async function handleFinancialHttp(req: IncomingMessage, res: ServerResponse, deps: FinancialHttpDeps): Promise<boolean> {
  const { pathname } = new URL(req.url ?? "/", "http://localhost");
  if (!isFinancialHttpPath(pathname)) return false;
  let reply: Reply;
  try {
    reply = await dispatch(pathname, req, deps);
  } catch (error) {
    reply = error instanceof BadRequest ? { status: 400, body: { error: error.message, code: "invalid_request" } } : { status: 500, body: { error: "internal server error", code: "internal" } };
  }
  res.statusCode = reply.status;
  res.setHeader("content-type", "application/json");
  res.setHeader("cache-control", "private, no-store");
  res.setHeader("vary", "authorization, x-user-id");
  res.end(JSON.stringify(reply.body));
  return true;
}

const NOT_FOUND: Reply = { status: 404, body: { error: "not found", code: "not_found" } };

async function dispatch(pathname: string, req: IncomingMessage, deps: FinancialHttpDeps): Promise<Reply> {
  const run = pathname.match(/^\/v1\/financial\/runs\/([^/]+)$/u);
  if (run) {
    if (req.method !== "GET") return methodNotAllowed();
    const status = await readRunStatus(deps.db, deps.userId, uuid(run[1]));
    return status ? { status: 200, body: status } : NOT_FOUND;
  }
  const result = pathname.match(/^\/v1\/financial\/results\/([^/]+)$/u);
  if (result) {
    if (req.method !== "GET") return methodNotAllowed();
    const inspection = await inspectCommittedResult(deps.db, deps.userId, uuid(result[1]));
    return inspection ? { status: 200, body: inspection } : NOT_FOUND;
  }
  const replay = pathname.match(/^\/v1\/financial\/runs\/([^/]+)\/replays$/u);
  if (replay) {
    if (req.method !== "POST") return methodNotAllowed();
    const sourceRunId = uuid(replay[1]);
    const requestKey = await replayRequestKey(req);
    const client = await deps.db.connect();
    let outcome;
    try {
      outcome = await reserveReplayRun(client, { owner_user_id: deps.userId, source_run_id: sourceRunId, request_key: requestKey });
    } finally {
      client.release();
    }
    if (outcome.status === "not_found") return NOT_FOUND;
    if (outcome.status === "conflict") {
      return { status: 409, body: { error: outcome.reason === "source_not_final" ? "only a completed run can be replayed" : "request_key was used for a different replay", code: outcome.reason } };
    }
    return {
      status: outcome.status === "created" ? 202 : 200,
      body: { replay_run_id: outcome.run.run_id, replay_of_run_id: outcome.run.replay_of_run_id, execution_state: outcome.run.execution_state, created: outcome.status === "created" },
    };
  }
  return NOT_FOUND;
}

class BadRequest extends Error {}

function methodNotAllowed(): Reply {
  return { status: 405, body: { error: "method not allowed", code: "method_not_allowed" } };
}

function uuid(segment: string | undefined): string {
  let decoded = "";
  try {
    decoded = decodeURIComponent(segment ?? "");
  } catch {
    // Falls through to the format check.
  }
  if (!UUID.test(decoded)) throw new BadRequest("identifier must be a UUID");
  return decoded.toLowerCase();
}

async function replayRequestKey(req: IncomingMessage): Promise<string> {
  let text = "";
  for await (const chunk of req) {
    text += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
    if (text.length > MAX_BODY_BYTES) throw new BadRequest("request body is too large");
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new BadRequest("request body must be valid JSON");
  }
  if (body === null || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 1) {
    throw new BadRequest("request body must be exactly { request_key }");
  }
  const key = (body as { request_key?: unknown }).request_key;
  if (typeof key !== "string" || !REQUEST_KEY.test(key)) throw new BadRequest("request_key must be 1-128 characters of [A-Za-z0-9_.:-]");
  return key;
}
