import type { IncomingMessage, ServerResponse } from "node:http";

import { handleDiscoveryHttp } from "../../discovery/src/http.ts";
import type { DiscoveryService } from "../../discovery/src/ports.ts";
import {
  authenticatedUserRequiredMessage,
  readAuthenticatedUserId,
  type RequestAuthConfig,
} from "../../shared/src/request-auth.ts";

export type DevApiDiscoveryAdapter = {
  handle(req: IncomingMessage, res: ServerResponse, auth: RequestAuthConfig): Promise<boolean>;
};

/** Authenticates discovery before its service can reserve any provider work. */
export function createDiscoveryDevApiAdapter(service: DiscoveryService): DevApiDiscoveryAdapter {
  return Object.freeze({
    async handle(req, res, auth) {
      const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
      if (pathname !== "/v1/discovery" && !pathname.startsWith("/v1/discovery/")) return false;
      const userId = readAuthenticatedUserId(req, auth);
      if (userId === null) {
        res.statusCode = 401;
        res.setHeader("content-type", "application/json");
        res.setHeader("cache-control", "no-store");
        res.end(JSON.stringify({ error: authenticatedUserRequiredMessage(auth) }));
        return true;
      }
      return handleDiscoveryHttp(req, res, { userId, service });
    },
  });
}
