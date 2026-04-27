import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import {
  createPortfolio,
  deletePortfolio,
  getPortfolio,
  listPortfolios,
  PortfolioNotFoundError,
  type QueryExecutor,
} from "./queries.ts";
import { assertPortfolioCreateInput, type Portfolio } from "./portfolio.ts";
import { isUuidV4 } from "./validators.ts";

const MAX_REQUEST_BODY_BYTES = 16 * 1024;
const USER_ID_HEADER = "x-user-id";
const USER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class RequestBodyTooLargeError extends Error {
  constructor() {
    super("request body too large");
  }
}

export type ListPortfoliosResponse = { portfolios: Portfolio[] };
export type GetPortfolioResponse = { portfolio: Portfolio };
export type CreatePortfolioResponse = { portfolio: Portfolio };

export function createPortfolioServer(db: QueryExecutor): Server {
  return createServer(async (req, res) => {
    try {
      const userId = readUserId(req);
      if (!userId) {
        respond(res, 401, { error: `'${USER_ID_HEADER}' header is required` });
        return;
      }

      const route = matchRoute(req.method ?? "GET", req.url ?? "/");
      if (!route) {
        respond(res, 404, { error: "not found" });
        return;
      }

      switch (route.action) {
        case "list": {
          const portfolios = await listPortfolios(db, userId);
          respond(res, 200, { portfolios } satisfies ListPortfoliosResponse);
          return;
        }
        case "create": {
          const body = await readBody(req);
          let parsed: unknown;
          try {
            parsed = JSON.parse(body);
          } catch {
            respond(res, 400, { error: "request body must be valid JSON" });
            return;
          }
          try {
            assertPortfolioCreateInput(parsed);
          } catch (err) {
            respond(res, 400, { error: errorMessage(err, "invalid portfolio input") });
            return;
          }
          const portfolio = await createPortfolio(db, userId, parsed);
          respond(res, 201, { portfolio } satisfies CreatePortfolioResponse);
          return;
        }
        case "get": {
          const portfolio = await getPortfolio(db, userId, route.portfolio_id);
          respond(res, 200, { portfolio } satisfies GetPortfolioResponse);
          return;
        }
        case "delete": {
          await deletePortfolio(db, userId, route.portfolio_id);
          res.statusCode = 204;
          res.end();
          return;
        }
        default: {
          const _exhaustive: never = route;
          void _exhaustive;
          respond(res, 500, { error: "unhandled route" });
          return;
        }
      }
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        if (!res.headersSent) respond(res, 413, { error: error.message });
        return;
      }
      if (error instanceof PortfolioNotFoundError) {
        if (!res.headersSent) respond(res, 404, { error: error.message });
        return;
      }

      console.error("portfolio request failed", error);
      if (!res.headersSent) respond(res, 500, { error: "internal portfolio error" });
    }
  });
}

type Route =
  | { action: "list" }
  | { action: "create" }
  | { action: "get"; portfolio_id: string }
  | { action: "delete"; portfolio_id: string };

function matchRoute(method: string, rawUrl: string): Route | null {
  const url = new URL(rawUrl, "http://localhost");
  const { pathname } = url;

  if (pathname === "/v1/portfolios") {
    if (method === "GET") return { action: "list" };
    if (method === "POST") return { action: "create" };
    return null;
  }

  const match = pathname.match(/^\/v1\/portfolios\/([^/]+)$/);
  if (match) {
    const portfolio_id = match[1];
    if (!isUuidV4(portfolio_id)) return null;
    if (method === "GET") return { action: "get", portfolio_id };
    if (method === "DELETE") return { action: "delete", portfolio_id };
  }

  return null;
}

function readUserId(req: IncomingMessage): string | null {
  const raw = req.headers[USER_ID_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return USER_ID_PATTERN.test(trimmed) ? trimmed : null;
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

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message.length > 0) return err.message;
  if (typeof err === "string" && err.length > 0) return err;
  return fallback;
}
