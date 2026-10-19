import type { IncomingMessage, ServerResponse } from "node:http";

import { FINANCIAL_HTTP_PREFIX, handleFinancialHttp, type FinancialPool } from "../../financial-engine/src/http.ts";
import { readAuthenticatedUserId, type RequestAuthConfig } from "../../shared/src/request-auth.ts";

export type DevApiFinancialAdapter = {
  handle(req: IncomingMessage, res: ServerResponse, auth: RequestAuthConfig): Promise<boolean>;
};

export function createFinancialDevApiAdapter(input: { db: FinancialPool }): DevApiFinancialAdapter {
  return Object.freeze({
    async handle(req, res, auth) {
      const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
      if (!pathname.startsWith(FINANCIAL_HTTP_PREFIX)) return false;
      const userId = readAuthenticatedUserId(req, auth)?.toLowerCase() ?? null;
      if (userId === null) {
        res.statusCode = 401;
        res.setHeader("content-type", "application/json");
        res.setHeader("cache-control", "private, no-store");
        res.end(JSON.stringify({ error: "authentication is required", code: "unauthenticated" }));
        return true;
      }
      return handleFinancialHttp(req, res, { userId, db: input.db });
    },
  });
}
