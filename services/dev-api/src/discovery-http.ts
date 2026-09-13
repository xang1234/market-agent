import type { IncomingMessage, ServerResponse } from "node:http";

import { handleDiscoveryHttp } from "../../discovery/src/http.ts";
import type { DiscoveryService } from "../../discovery/src/ports.ts";

export type DevApiDiscoveryAdapter = { handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> };

/** Authenticates discovery before its service can reserve any provider work. */
export function createDiscoveryDevApiAdapter(service: DiscoveryService): DevApiDiscoveryAdapter {
  return Object.freeze({
    async handle(req, res) {
      if (!new URL(req.url ?? "/", "http://localhost").pathname.startsWith("/v1/discovery")) return false;
      const userId = typeof req.headers["x-user-id"] === "string" ? req.headers["x-user-id"].trim() : "";
      if (userId === "") {
        res.statusCode = 401;
        res.setHeader("content-type", "application/json");
        res.setHeader("cache-control", "no-store");
        res.end(JSON.stringify({ error: "x-user-id header is required" }));
        return true;
      }
      return handleDiscoveryHttp(req, res, { userId, service });
    },
  });
}
