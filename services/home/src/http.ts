import { createServer, type Server } from "node:http";

import { isUuidV4 } from "../../market/src/validators.ts";
import {
  authenticatedUserRequiredMessage,
  readAuthenticatedUserId,
  resolveAuthMode,
  type RequestAuthConfig,
} from "../../shared/src/request-auth.ts";

import { HomeFindingFeedError } from "./finding-feed-repo.ts";
import type { HomeSectionsDeps } from "./secondary-types.ts";
import { getHomeSummary } from "./summary.ts";
import type { QueryExecutor } from "./types.ts";
import { respondJson } from "../../shared/src/http.ts";

type Route = { kind: "healthz" } | { kind: "summary" } | null;

export function createHomeServer(
  db: QueryExecutor,
  deps: HomeSectionsDeps,
  options: { auth?: RequestAuthConfig } = {},
): Server {
  const auth: RequestAuthConfig = { ...options.auth, mode: resolveAuthMode(options.auth) };
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

      const userId = readAuthenticatedUserId(req, auth);
      if (userId === null || !isUuidV4(userId)) {
        respondJson(res, 401, { error: authenticatedUserRequiredMessage(auth) });
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

