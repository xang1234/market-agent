// Composition of the financial answer HTTP routes into the dev API, kept out of
// the already large runtime modules. Identity comes from an injected
// authenticator. The development authenticator below trusts the `x-user-id`
// header exactly as the other dev routes do; it is a local-development
// convenience, not production authority, and a deployment must supply its
// own authenticator backed by verified credentials.

import type { IncomingMessage, ServerResponse } from "node:http";

import { FINANCIAL_HTTP_PREFIX, handleFinancialHttp, type FinancialPool } from "../../financial-engine/src/http.ts";

export type FinancialAuthenticator = (req: IncomingMessage) => string | null;

export type DevApiFinancialAdapter = { handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/** Development only: the dev API's existing header identity, restricted to a UUID. */
export const developmentHeaderAuthenticator: FinancialAuthenticator = (req) => {
  const value = req.headers["x-user-id"];
  return typeof value === "string" && UUID.test(value.trim()) ? value.trim().toLowerCase() : null;
};

export function createFinancialDevApiAdapter(input: { db: FinancialPool; authenticate: FinancialAuthenticator }): DevApiFinancialAdapter {
  return Object.freeze({
    async handle(req, res) {
      const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
      if (!pathname.startsWith(FINANCIAL_HTTP_PREFIX)) return false;
      const userId = input.authenticate(req);
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
