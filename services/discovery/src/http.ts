import type { IncomingMessage, ServerResponse } from "node:http";

import type { DiscoveryService } from "./ports.ts";
import { DiscoveryError } from "./types.ts";

export async function handleDiscoveryHttp(
  req: IncomingMessage,
  res: ServerResponse,
  input: { userId: string; service: DiscoveryService },
): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (!isDiscoveryPath(url.pathname)) return false;
  res.setHeader("cache-control", "no-store");
  try {
    const result = await dispatch(url, req, input);
    if (result === NOT_FOUND) { send(res, 404, { error: "not found" }); return true; }
    if (result === NO_CONTENT) { res.statusCode = 204; res.end(); return true; }
    send(res, result.status, result.body);
  } catch (error) {
    if (error instanceof DiscoveryError) send(res, error.status, { error: error.message, code: error.code });
    else send(res, 500, { error: "internal server error" });
  }
  return true;
}

const NOT_FOUND = Symbol("not found");
const NO_CONTENT = Symbol("no content");
type Dispatch = { status: number; body: object } | typeof NOT_FOUND | typeof NO_CONTENT;

async function dispatch(url: URL, req: IncomingMessage, input: { userId: string; service: DiscoveryService }): Promise<Dispatch> {
  const { pathname } = url;
  if (pathname === "/v1/discovery/metric-options") {
    return req.method === "GET" ? { status: 200, body: { items: await input.service.listMetricOptions(input.userId) } } : methodNotAllowed();
  }
  if (pathname === "/v1/discovery/campaigns") {
    if (req.method === "GET") return { status: 200, body: await input.service.listCampaigns(input.userId, nullable(url.searchParams.get("cursor")), readLimit(url.searchParams.get("limit"), 20)) };
    if (req.method === "POST") {
      const body = await objectBody(req, ["name", "question"]);
      return { status: 201, body: await input.service.createCampaign(input.userId, { name: requireString(body.name, "name"), question: requireString(body.question, "question") }) };
    }
    return methodNotAllowed();
  }
  const campaign = pathname.match(/^\/v1\/discovery\/campaigns\/([^/]+)$/);
  if (campaign) {
    const campaignId = routeId(campaign[1], "campaign_id");
    if (req.method === "GET") return { status: 200, body: await input.service.getCampaign(input.userId, campaignId) };
    if (req.method === "DELETE") { await noBody(req); await input.service.deleteCampaign(input.userId, campaignId); return NO_CONTENT; }
    return methodNotAllowed();
  }
  const draft = pathname.match(/^\/v1\/discovery\/campaigns\/([^/]+)\/draft$/);
  if (draft) {
    if (req.method !== "POST") return methodNotAllowed();
    const body = await objectBody(req, ["expected_version"]);
    return { status: 200, body: await input.service.draftBrief(input.userId, routeId(draft[1], "campaign_id"), integer(body.expected_version, "expected_version", 0)) };
  }
  const brief = pathname.match(/^\/v1\/discovery\/campaigns\/([^/]+)\/brief$/);
  if (brief) {
    if (req.method !== "PUT") return methodNotAllowed();
    const body = await objectBody(req, ["expected_version", "brief"]);
    if (body.brief === undefined) throw new DiscoveryError("validation", "brief is required");
    return { status: 200, body: await input.service.saveBrief(input.userId, routeId(brief[1], "campaign_id"), integer(body.expected_version, "expected_version", 0), body.brief as never) };
  }
  const runs = pathname.match(/^\/v1\/discovery\/campaigns\/([^/]+)\/runs$/);
  if (runs) {
    const campaignId = routeId(runs[1], "campaign_id");
    if (req.method === "GET") return { status: 200, body: await input.service.listRuns(input.userId, campaignId, nullable(url.searchParams.get("cursor")), readLimit(url.searchParams.get("limit"), 20)) };
    if (req.method === "POST") {
      const body = await objectBody(req, ["brief_version", "brief_hash", "request_key"]);
      return { status: 201, body: await input.service.startRun(input.userId, campaignId, {
        brief_version: integer(body.brief_version, "brief_version", 1), brief_hash: sha256(body.brief_hash), request_key: routeId(requireString(body.request_key, "request_key"), "request_key"),
      }) };
    }
    return methodNotAllowed();
  }
  const run = pathname.match(/^\/v1\/discovery\/runs\/([^/]+)$/);
  if (run) return req.method === "GET" ? { status: 200, body: await input.service.getRun(input.userId, routeId(run[1], "run_id")) } : methodNotAllowed();
  const candidates = pathname.match(/^\/v1\/discovery\/runs\/([^/]+)\/candidates$/);
  if (candidates) {
    if (req.method !== "GET") return methodNotAllowed();
    const state = nullable(url.searchParams.get("state"));
    return { status: 200, body: await input.service.getCandidates(input.userId, routeId(candidates[1], "run_id"), { cursor: nullable(url.searchParams.get("cursor")), limit: readLimit(url.searchParams.get("limit"), 25), state: state as never }) };
  }
  const events = pathname.match(/^\/v1\/discovery\/runs\/([^/]+)\/events$/);
  if (events) return req.method === "GET" ? { status: 200, body: await input.service.getEvents(input.userId, routeId(events[1], "run_id"), integer(Number(url.searchParams.get("after") ?? 0), "after", 0)) } : methodNotAllowed();
  const cancel = pathname.match(/^\/v1\/discovery\/runs\/([^/]+)\/cancel$/);
  if (cancel) {
    if (req.method !== "POST") return methodNotAllowed();
    await noBody(req);
    return { status: 200, body: await input.service.cancelRun(input.userId, routeId(cancel[1], "run_id")) };
  }
  return NOT_FOUND;
}

function methodNotAllowed(): Dispatch { return { status: 405, body: { error: "method not allowed" } }; }
async function objectBody(req: IncomingMessage, keys: readonly string[]): Promise<Record<string, unknown>> {
  const text = await bodyText(req);
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new DiscoveryError("validation", "request body must be valid JSON"); }
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new DiscoveryError("validation", "request body must be a JSON object");
  const body = value as Record<string, unknown>;
  if (Object.keys(body).length !== keys.length || keys.some((key) => !(key in body))) throw new DiscoveryError("validation", "request body has unknown or missing fields");
  return body;
}
async function noBody(req: IncomingMessage): Promise<void> { if ((await bodyText(req)).length !== 0) throw new DiscoveryError("validation", "request body is not allowed"); }
async function bodyText(req: IncomingMessage): Promise<string> { let text = ""; for await (const chunk of req) text += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : Buffer.from(chunk).toString("utf8"); return text; }
function routeId(value: string | undefined, label: string): string {
  let decoded: string;
  try { decoded = value === undefined ? "" : decodeURIComponent(value); } catch { throw new DiscoveryError("validation", `${label} must be a UUID`); }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(decoded)) throw new DiscoveryError("validation", `${label} must be a UUID`);
  return decoded;
}
function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new DiscoveryError("validation", `${label} is required`);
  return value;
}
function integer(value: unknown, label: string, minimum: number): number {
  if (!Number.isInteger(value) || (value as number) < minimum) throw new DiscoveryError("validation", `${label} is invalid`);
  return value as number;
}
function sha256(value: unknown): string { const hash = requireString(value, "brief_hash"); if (!/^sha256:[0-9a-f]{64}$/.test(hash)) throw new DiscoveryError("validation", "brief_hash must be a SHA-256 hash"); return hash; }
function readLimit(value: string | null, fallback: number): number { return value === null ? fallback : integer(Number(value), "limit", 1); }
function nullable(value: string | null): string | null { return value === null || value === "" ? null : value; }
function send(res: ServerResponse, status: number, body: object): void { res.statusCode = status; res.setHeader("content-type", "application/json"); res.end(JSON.stringify(body)); }
function isDiscoveryPath(pathname: string): boolean { return pathname === "/v1/discovery" || pathname.startsWith("/v1/discovery/"); }
