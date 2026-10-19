import { createServer, type IncomingMessage, type Server } from "node:http";
import {
  authenticatedUserRequiredMessage,
  readAuthenticatedUserId,
  type RequestAuthConfig,
} from "../../shared/src/request-auth.ts";
import { createGrid, getGrid, listGrids, loadRunForUser, getRunDetail } from "./queries.ts";
import { listColumns, validateColumnSpecs } from "./column-catalog.ts";
import {
  GridNotFoundError,
  GridValidationError,
  type CreateGridInput,
  type QueryExecutor,
} from "./types.ts";
import { startGridRun, type RunEngineDeps } from "./run-engine.ts";
import type { GridFinancialDeps } from "./financial-column.ts";
import { validateUniverseSpec, type UniverseResolverDeps } from "./universe.ts";
import type { SnapshotClientPool } from "../../snapshot/src/snapshot-sealer.ts";
import type { ReaderColumnDeps } from "./column-catalog.ts";
import { readBody, RequestBodyTooLargeError, respondJson } from "../../shared/src/http.ts";

const MAX_BODY = 64 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const text = (await readBody(req, { maxBytes: MAX_BODY })) || "{}";
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
  validateUniverseSpec(body.universe_spec);
  if (!Array.isArray(body.column_specs)) throw new GridValidationError("'column_specs' must be an array");
  validateColumnSpecs(body.column_specs);
  return {
    name: body.name,
    description: typeof body.description === "string" ? body.description : null,
    universe_spec: body.universe_spec,
    column_specs: body.column_specs as CreateGridInput["column_specs"],
  };
}

export type AnalystGridsServerDeps = {
  db: QueryExecutor;
  pool: SnapshotClientPool;
  universe: UniverseResolverDeps;
  reader?: ReaderColumnDeps;
  auth?: RequestAuthConfig;
  financial?: GridFinancialDeps;
};

export function createAnalystGridsServer(deps: AnalystGridsServerDeps): Server {
  const { db, pool, universe, reader, auth, financial } = deps;
  return createServer(async (req, res) => {
    try {
      const method = req.method ?? "GET";
      const url = new URL(req.url ?? "/", "http://localhost");
      const path = url.pathname;

      const userId = readAuthenticatedUserId(req, auth);
      if (!userId) {
        respondJson(res, 401, { error: authenticatedUserRequiredMessage(auth) });
        return;
      }

      if (method === "GET" && path === "/v1/analyst-grids/columns") {
        respondJson(res, 200, { columns: listColumns() });
        return;
      }

      if (method === "GET" && path === "/v1/analyst-grids") {
        respondJson(res, 200, { grids: await listGrids(db, userId) });
        return;
      }

      if (method === "POST" && path === "/v1/analyst-grids") {
        const input = parseCreateInput(await readJson(req));
        const grid = await createGrid(db, userId, input);
        respondJson(res, 201, grid);
        return;
      }

      // POST /v1/analyst-grids/:gridId/runs — start an async run
      const runStartMatch = path.match(/^\/v1\/analyst-grids\/([^/]+)\/runs$/);
      if (method === "POST" && runStartMatch && UUID_RE.test(runStartMatch[1])) {
        const engineDeps: RunEngineDeps = { db, pool, universe, reader, financial };
        const result = await startGridRun(engineDeps, { gridId: runStartMatch[1], userId, asOf: new Date().toISOString() });
        respondJson(res, 202, result);
        return;
      }

      // GET /v1/analyst-grids/runs/:runId — owner-scoped run detail
      const runGetMatch = path.match(/^\/v1\/analyst-grids\/runs\/([^/]+)$/);
      if (method === "GET" && runGetMatch && UUID_RE.test(runGetMatch[1])) {
        const owned = await loadRunForUser(db, userId, runGetMatch[1]);
        if (!owned) {
          respondJson(res, 404, { error: "grid run not found" });
          return;
        }
        respondJson(res, 200, await getRunDetail(db, runGetMatch[1]));
        return;
      }

      const gridMatch = path.match(/^\/v1\/analyst-grids\/([^/]+)$/);
      if (method === "GET" && gridMatch && UUID_RE.test(gridMatch[1])) {
        const grid = await getGrid(db, userId, gridMatch[1]);
        respondJson(res, 200, grid);
        return;
      }

      respondJson(res, 404, { error: "not found" });
    } catch (error) {
      if (error instanceof GridValidationError || error instanceof RequestBodyTooLargeError) {
        respondJson(res, 400, { error: error.message });
        return;
      }
      if (error instanceof GridNotFoundError) {
        respondJson(res, 404, { error: error.message });
        return;
      }
      console.error("analyst-grids request failed", error);
      respondJson(res, 500, { error: "internal error" });
    }
  });
}
