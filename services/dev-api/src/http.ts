import { createServer, type Server, type ServerResponse } from "node:http";
import { readDevFlags } from "../../shared/src/devFlags.ts";

export function createDevApiServer(
  env: Record<string, string | undefined> = process.env,
): Server {
  const flags = readDevFlags(env);

  return createServer((req, res) => {
    if (req.method === "GET" && req.url === "/healthz") {
      respondJson(res, 200, { status: "ok", service: "dev-api", flags });
      return;
    }

    if (req.method === "GET" && req.url === "/v1/dev/placeholders") {
      if (!flags.placeholderApiEnabled) {
        respondJson(res, 503, { error: "placeholder api disabled" });
        return;
      }

      respondJson(res, 200, {
        placeholders: ["home-feed", "agents-feed", "analyze-run"],
      });
      return;
    }

    respondJson(res, 404, { error: "not found" });
  });
}

function respondJson(res: ServerResponse, status: number, body: object) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}
