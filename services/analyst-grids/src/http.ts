import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  authenticatedUserRequiredMessage,
  readAuthenticatedUserId,
  type RequestAuthConfig,
} from "../../shared/src/request-auth.ts";
import { createGrid, getGrid, listGrids } from "./queries.ts";
import { listColumns } from "./column-catalog.ts";
import {
  GridNotFoundError,
  GridValidationError,
  UNIVERSE_SOURCES,
  type CreateGridInput,
  type QueryExecutor,
} from "./types.ts";

const MAX_BODY = 64 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function respond(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(json);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new GridValidationError("request body too large");
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8") || "{}";
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new GridValidationError("request body must be valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null) throw new GridValidationError("body must be an object");
  return parsed as Record<string, unknown>;
}

function parseCreateInput(body: Record<string, unknown>): CreateGridInput {
  if (typeof body.name !== "string" || body.name.length === 0) throw new GridValidationError("'name' is required");
  if (typeof body.universe_spec !== "object" || body.universe_spec === null) throw new GridValidationError("'universe_spec' is required");
  const source = (body.universe_spec as { source?: unknown }).source;
  if (typeof source !== "string" || !(UNIVERSE_SOURCES as readonly string[]).includes(source)) {
    throw new GridValidationError(`'universe_spec.source' must be one of: ${UNIVERSE_SOURCES.join(", ")}`);
  }
  if (!Array.isArray(body.column_specs)) throw new GridValidationError("'column_specs' must be an array");
  return {
    name: body.name,
    description: typeof body.description === "string" ? body.description : null,
    universe_spec: body.universe_spec as CreateGridInput["universe_spec"],
    column_specs: body.column_specs as CreateGridInput["column_specs"],
  };
}

export function createAnalystGridsServer(
  db: QueryExecutor,
  options: { auth?: RequestAuthConfig } = {},
): Server {
  return createServer(async (req, res) => {
    try {
      const method = req.method ?? "GET";
      const url = new URL(req.url ?? "/", "http://localhost");
      const path = url.pathname;

      const userId = readAuthenticatedUserId(req, options.auth);
      if (!userId) {
        respond(res, 401, { error: authenticatedUserRequiredMessage(options.auth) });
        return;
      }

      if (method === "GET" && path === "/v1/analyst-grids/columns") {
        respond(res, 200, { columns: listColumns() });
        return;
      }

      if (method === "GET" && path === "/v1/analyst-grids") {
        respond(res, 200, { grids: await listGrids(db, userId) });
        return;
      }

      if (method === "POST" && path === "/v1/analyst-grids") {
        const input = parseCreateInput(await readJson(req));
        const grid = await createGrid(db, userId, input);
        respond(res, 201, grid);
        return;
      }

      const gridMatch = path.match(/^\/v1\/analyst-grids\/([^/]+)$/);
      if (method === "GET" && gridMatch && UUID_RE.test(gridMatch[1])) {
        const grid = await getGrid(db, userId, gridMatch[1]);
        respond(res, 200, grid);
        return;
      }

      respond(res, 404, { error: "not found" });
    } catch (error) {
      if (error instanceof GridValidationError) {
        respond(res, 400, { error: error.message });
        return;
      }
      if (error instanceof GridNotFoundError) {
        respond(res, 404, { error: error.message });
        return;
      }
      console.error("analyst-grids request failed", error);
      respond(res, 500, { error: "internal error" });
    }
  });
}
