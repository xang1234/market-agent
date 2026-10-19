import { createServer, type IncomingMessage, type Server } from "node:http";

import { isUuidV4 } from "../../market/src/validators.ts";

import { HomeFindingFeedError } from "./finding-feed-repo.ts";
import type { HomeSectionsDeps } from "./secondary-types.ts";
import { getHomeSummary } from "./summary.ts";
import type { QueryExecutor } from "./types.ts";
import { respondJson } from "../../shared/src/http.ts";

const USER_ID_HEADER = "x-user-id";

type Route = { kind: "healthz" } | { kind: "summary" } | null;

export function createHomeServer(db: QueryExecutor, deps: HomeSectionsDeps): Server {
  return createServer(async (req, res) => {
    try {
      const route = matchRoute(req.method ?? "GET", req.url ?? "/");
      if (route === null) {
        respondJson(res, 404, { error: "not found" });
        return;
      }

      if (route.kind === "healthz") {
        respondJson(res, 200, { status: "ok", service: "home" });
        return;
      }

      const userId = readUserId(req);
      if (userId === null) {
        respondJson(res, 401, { error: `'${USER_ID_HEADER}' header with a valid UUID is required` });
        return;
      }

      const summary = await getHomeSummary(db, deps, { user_id: userId });
      respondJson(res, 200, summary);
    } catch (error) {
      if (error instanceof HomeFindingFeedError) {
        if (!res.headersSent) respondJson(res, 400, { error: error.message });
        return;
      }
      console.error("home request failed", error);
      if (!res.headersSent) respondJson(res, 500, { error: "internal home error" });
    }
  });
}

function matchRoute(method: string, rawUrl: string): Route {
  if (method !== "GET") return null;
  const path = rawUrl.split("?")[0];
  if (path === "/healthz" || path === "/v1/home/healthz") return { kind: "healthz" };
  if (path === "/v1/home/summary") return { kind: "summary" };
  return null;
}

function readUserId(req: IncomingMessage): string | null {
  const raw = req.headers[USER_ID_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return isUuidV4(trimmed) ? trimmed : null;
}
