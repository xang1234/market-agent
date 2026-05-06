import { createServer, type Server, type ServerResponse } from "node:http";
import { readDevFlags } from "../../shared/src/devFlags.ts";

type DevAgent = {
  agent_id: string;
  user_id: string;
  name: string;
  thesis: string;
  cadence: string;
  enabled: boolean;
  updated_at: string;
};

type DevAgentRun = {
  agent_run_log_id: string;
  agent_id: string;
  status: "running" | "completed" | "failed";
  started_at: string;
  ended_at: string | null;
  error: string | null;
};

export function createDevApiServer(
  env: Record<string, string | undefined> = process.env,
): Server {
  const flags = readDevFlags(env);
  const agents = new Map<string, DevAgent>();
  const runs: DevAgentRun[] = [];
  const seedAgent = {
    agent_id: "11111111-1111-4111-8111-111111111111",
    user_id: "00000000-0000-4000-8000-000000000001",
    name: "Quality monitor",
    thesis: "Find margin, cash conversion, guidance, and source-backed claim changes.",
    cadence: "daily",
    enabled: true,
    updated_at: "2026-05-06T00:00:00.000Z",
  } satisfies DevAgent;
  agents.set(seedAgent.agent_id, seedAgent);

  return createServer(async (req, res) => {
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

    const url = new URL(req.url ?? "/", "http://localhost");

    if (req.method === "GET" && url.pathname === "/v1/dev/services") {
      respondJson(res, 200, {
        services: serviceCatalog(env),
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/v1/analyze/templates") {
      respondJson(res, 200, {
        templates: [
          {
            template_id: "earnings-quality",
            name: "Earnings quality",
            prompt_template: "Assess revenue quality, margins, cash conversion, and management commentary.",
            source_categories: ["filings", "transcripts", "news"],
            version: 1,
          },
          {
            template_id: "variant-view",
            name: "Variant view",
            prompt_template: "Compare the market narrative with evidence-backed counterpoints.",
            source_categories: ["filings", "news", "social"],
            version: 1,
          },
        ],
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/v1/agents") {
      const userId = req.headers["x-user-id"];
      respondJson(res, 200, {
        agents: [...agents.values()].filter((agent) => typeof userId !== "string" || agent.user_id === userId),
        runs,
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/v1/agents") {
      const userId = typeof req.headers["x-user-id"] === "string"
        ? req.headers["x-user-id"]
        : seedAgent.user_id;
      const body = await readJson(req);
      const input = typeof body === "object" && body !== null ? body as Record<string, unknown> : {};
      const agent: DevAgent = {
        agent_id: stableUuid(`agent:${userId}:${String(input.name ?? "")}:${agents.size}`),
        user_id: userId,
        name: nonEmptyString(input.name) ?? "Untitled agent",
        thesis: nonEmptyString(input.thesis) ?? "Monitor source-backed changes.",
        cadence: nonEmptyString(input.cadence) ?? "daily",
        enabled: true,
        updated_at: new Date().toISOString(),
      };
      agents.set(agent.agent_id, agent);
      respondJson(res, 201, agent);
      return;
    }

    const runMatch = url.pathname.match(/^\/v1\/agents\/([^/]+)\/runs$/);
    if (req.method === "POST" && runMatch) {
      const agentId = decodeURIComponent(runMatch[1]);
      if (!agents.has(agentId)) {
        respondJson(res, 404, { error: "agent not found" });
        return;
      }
      const run: DevAgentRun = {
        agent_run_log_id: stableUuid(`run:${agentId}:${runs.length}`),
        agent_id: agentId,
        status: "running",
        started_at: new Date().toISOString(),
        ended_at: null,
        error: null,
      };
      runs.unshift(run);
      respondJson(res, 201, run);
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

async function readJson(req: AsyncIterable<Uint8Array | string>): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (text.trim() === "") return null;
  return JSON.parse(text);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function stableUuid(seed: string): string {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }
  const suffix = hash.toString(16).padStart(12, "0").slice(-12);
  return `00000000-0000-4000-8000-${suffix}`;
}

function serviceCatalog(env: Record<string, string | undefined>) {
  return [
    { name: "chat", status: "proxied", origin: env.CHAT_ORIGIN ?? "http://127.0.0.1:4310" },
    { name: "resolver", status: "proxied", origin: env.RESOLVER_ORIGIN ?? "http://127.0.0.1:4311" },
    { name: "watchlists", status: "proxied", origin: env.WATCHLISTS_ORIGIN ?? "http://127.0.0.1:4313" },
    { name: "market", status: "proxied", origin: env.MARKET_ORIGIN ?? "http://127.0.0.1:4321" },
    { name: "fundamentals", status: "proxied", origin: env.FUNDAMENTALS_ORIGIN ?? "http://127.0.0.1:4322" },
    { name: "screener", status: "proxied", origin: env.SCREENER_ORIGIN ?? "http://127.0.0.1:4323" },
    { name: "portfolio", status: "proxied", origin: env.PORTFOLIO_ORIGIN ?? "http://127.0.0.1:4333" },
    { name: "home", status: "proxied", origin: env.HOME_ORIGIN ?? "http://127.0.0.1:4334" },
    { name: "evidence", status: "proxied", origin: env.EVIDENCE_ORIGIN ?? "http://127.0.0.1:4335" },
    { name: "analyze", status: "bff", origin: env.DEV_API_ORIGIN ?? "http://127.0.0.1:4312" },
    { name: "agents", status: "bff", origin: env.DEV_API_ORIGIN ?? "http://127.0.0.1:4312" },
    { name: "artifact", status: "library", note: "shared through service callers; no standalone dev HTTP server" },
    { name: "snapshot", status: "library", note: "used by chat/analyze persistence paths; no standalone dev HTTP server" },
    { name: "tools", status: "library", note: "analyst tool registry package; no standalone dev HTTP server" },
    { name: "observability", status: "library", note: "run activity primitives exposed through chat/home routes" },
    { name: "themes", status: "library", note: "theme inference package; no standalone dev HTTP server" },
    { name: "summary", status: "library", note: "summary package; no standalone dev HTTP server" },
  ];
}
