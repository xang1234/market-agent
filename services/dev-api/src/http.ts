import { createServer, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import {
  getAnalyzeTemplate,
  listAnalyzeTemplatesByUser,
  persistAnalyzeTemplateRunAfterSnapshotSealWithPool,
  type AnalyzeTemplateRunClientPool,
} from "../../analyze/src/index.ts";
import {
  claimAgentRun,
  completeAgentRun,
  createAgent,
  getAgent,
  listAgentsByUser,
  updateAgent,
  type AgentRow,
  type AgentRunRow,
  type AgentUniverse,
  type QueryExecutor,
} from "../../agents/src/index.ts";
import type { JsonValue } from "../../observability/src/types.ts";
import type { SnapshotSealResult } from "../../snapshot/src/snapshot-sealer.ts";
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

type DevAnalyzeRun = {
  run_id: string;
  template_id: string;
  template_version: number;
  snapshot_id: string;
  blocks: ReadonlyArray<Record<string, unknown>>;
  created_at: string;
};

type DevAnalyzeTemplate = {
  template_id: string;
  name: string;
  prompt_template: string;
  source_categories: string[];
  version: number;
};

export type DevApiAnalyzeAdapter = {
  listTemplates(input: { userId: string }): Promise<{
    templates: DevAnalyzeTemplate[];
    runs?: DevAnalyzeRun[];
  }>;
  createRun(input: {
    userId: string;
    body: Record<string, unknown>;
  }): Promise<DevAnalyzeRun>;
};

export type DevApiAgentsAdapter = {
  list(input: { userId: string }): Promise<{
    agents: DevAgent[];
    runs: DevAgentRun[];
  }>;
  create(input: {
    userId: string;
    body: Record<string, unknown>;
  }): Promise<DevAgent>;
  update(input: {
    userId: string;
    agentId: string;
    body: Record<string, unknown>;
  }): Promise<DevAgent | null>;
  delete(input: { userId: string; agentId: string }): Promise<boolean>;
  run(input: { userId: string; agentId: string }): Promise<DevAgentRun | null>;
};

export type DevApiAdapters = {
  analyze: DevApiAnalyzeAdapter;
  agents: DevApiAgentsAdapter;
};

export type DevApiServerOptions = {
  adapters?: DevApiAdapters;
};

export function createDevApiServer(
  env: Record<string, string | undefined> = process.env,
  options: DevApiServerOptions = {},
): Server {
  const flags = readDevFlags(env);
  const adapters = options.adapters;

  return createServer(async (req, res) => {
    try {
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
        services: serviceCatalog(env, Boolean(adapters)),
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/v1/analyze/templates") {
      const userId = readUserIdHeader(req.headers["x-user-id"]);
      if (userId === null) {
        respondJson(res, 401, { error: "x-user-id header is required" });
        return;
      }
      if (!adapters) {
        respondJson(res, 503, { error: "durable analyze adapter is not configured" });
        return;
      }
      respondJson(res, 200, await adapters.analyze.listTemplates({ userId }));
      return;
    }

    if (req.method === "POST" && url.pathname === "/v1/analyze/runs") {
      const userId = readUserIdHeader(req.headers["x-user-id"]);
      if (userId === null) {
        respondJson(res, 401, { error: "x-user-id header is required" });
        return;
      }
      if (!adapters) {
        respondJson(res, 503, { error: "durable analyze adapter is not configured" });
        return;
      }
      const body = await readJson(req).catch(() => BAD_JSON);
      if (body === BAD_JSON) {
        respondJson(res, 400, { error: "request body must be valid JSON" });
        return;
      }
      const input = typeof body === "object" && body !== null ? body as Record<string, unknown> : {};
      respondJson(res, 201, await adapters.analyze.createRun({ userId, body: input }));
      return;
    }

    if (req.method === "GET" && url.pathname === "/v1/agents") {
      const userId = readUserIdHeader(req.headers["x-user-id"]);
      if (userId === null) {
        respondJson(res, 401, { error: "x-user-id header is required" });
        return;
      }
      if (!adapters) {
        respondJson(res, 503, { error: "durable agents adapter is not configured" });
        return;
      }
      respondJson(res, 200, await adapters.agents.list({ userId }));
      return;
    }

    if (req.method === "POST" && url.pathname === "/v1/agents") {
      const userId = readUserIdHeader(req.headers["x-user-id"]);
      if (userId === null) {
        respondJson(res, 401, { error: "x-user-id header is required" });
        return;
      }
      const body = await readJson(req).catch(() => BAD_JSON);
      if (body === BAD_JSON) {
        respondJson(res, 400, { error: "request body must be valid JSON" });
        return;
      }
      const input = typeof body === "object" && body !== null ? body as Record<string, unknown> : {};
      if (!adapters) {
        respondJson(res, 503, { error: "durable agents adapter is not configured" });
        return;
      }
      respondJson(res, 201, await adapters.agents.create({ userId, body: input }));
      return;
    }

    const agentMatch = url.pathname.match(/^\/v1\/agents\/([^/]+)$/);
    if (agentMatch && req.method === "PATCH") {
      const userId = readUserIdHeader(req.headers["x-user-id"]);
      if (userId === null) {
        respondJson(res, 401, { error: "x-user-id header is required" });
        return;
      }
      const agentId = decodeURIComponent(agentMatch[1]);
      const body = await readJson(req).catch(() => BAD_JSON);
      if (body === BAD_JSON) {
        respondJson(res, 400, { error: "request body must be valid JSON" });
        return;
      }
      const input = typeof body === "object" && body !== null ? body as Record<string, unknown> : {};
      if (!adapters) {
        respondJson(res, 503, { error: "durable agents adapter is not configured" });
        return;
      }
      const next = await adapters.agents.update({ userId, agentId, body: input });
      if (next === null) {
        respondJson(res, 404, { error: "agent not found" });
        return;
      }
      respondJson(res, 200, next);
      return;
    }

    if (agentMatch && req.method === "DELETE") {
      const userId = readUserIdHeader(req.headers["x-user-id"]);
      if (userId === null) {
        respondJson(res, 401, { error: "x-user-id header is required" });
        return;
      }
      const agentId = decodeURIComponent(agentMatch[1]);
      if (!adapters) {
        respondJson(res, 503, { error: "durable agents adapter is not configured" });
        return;
      }
      const deleted = await adapters.agents.delete({ userId, agentId });
      if (!deleted) {
        respondJson(res, 404, { error: "agent not found" });
        return;
      }
      res.statusCode = 204;
      res.end();
      return;
    }

    const runMatch = url.pathname.match(/^\/v1\/agents\/([^/]+)\/runs$/);
    if (req.method === "POST" && runMatch) {
      const userId = readUserIdHeader(req.headers["x-user-id"]);
      if (userId === null) {
        respondJson(res, 401, { error: "x-user-id header is required" });
        return;
      }
      const agentId = decodeURIComponent(runMatch[1]);
      if (!adapters) {
        respondJson(res, 503, { error: "durable agents adapter is not configured" });
        return;
      }
      const run = await adapters.agents.run({ userId, agentId });
      if (run === null) {
        respondJson(res, 404, { error: "agent not found" });
        return;
      }
      respondJson(res, 201, run);
      return;
    }

    respondJson(res, 404, { error: "not found" });
    } catch (error) {
      if (res.headersSent) {
        res.end();
        return;
      }
      if (error instanceof DevApiHttpError) {
        respondJson(res, error.status, { error: error.message });
        return;
      }
      respondJson(res, 500, { error: error instanceof Error ? error.message : "internal server error" });
    }
  });
}

export function createFixtureDevApiAdapters(): DevApiAdapters {
  const agents = new Map<string, DevAgent>();
  const agentRuns: DevAgentRun[] = [];
  const analyzeRuns: DevAnalyzeRun[] = [];
  const analyzeRunOwners = new Map<string, string>();
  const runOwner = (runId: string) => analyzeRunOwners.get(runId) ?? null;
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

  return {
    analyze: {
      async listTemplates({ userId }) {
        return {
          templates: defaultAnalyzeTemplates(),
          runs: analyzeRuns.filter((run) => runOwner(run.run_id) === userId),
        };
      },
      async createRun({ userId, body }) {
        const runId = stableUuid(`analyze-run:${userId}:${analyzeRuns.length}:${String(body.template_id ?? "")}`);
        const snapshotId = stableUuid(`analyze-snapshot:${runId}`);
        const instructions = nonEmptyString(body.instructions) ?? "Assess the selected subject using the chosen sources.";
        const sourceCategories = Array.isArray(body.source_categories)
          ? body.source_categories.filter((category): category is string => typeof category === "string" && category.trim() !== "")
          : [];
        const run: DevAnalyzeRun = {
          run_id: runId,
          template_id: nonEmptyString(body.template_id) ?? "earnings-quality",
          template_version: 1,
          snapshot_id: snapshotId,
          blocks: [
            richTextBlock({
              id: stableUuid(`analyze-block:${runId}`),
              snapshotId,
              title: "Analyze memo",
              text: `${instructions} Sources: ${sourceCategories.length > 0 ? sourceCategories.join(", ") : "default evidence set"}.`,
            }),
          ],
          created_at: new Date().toISOString(),
        };
        analyzeRuns.unshift(run);
        analyzeRunOwners.set(run.run_id, userId);
        return run;
      },
    },
    agents: {
      async list({ userId }) {
        const visibleAgentIds = new Set(
          [...agents.values()]
            .filter((agent) => agent.user_id === userId)
            .map((agent) => agent.agent_id),
        );
        return {
          agents: [...agents.values()].filter((agent) => agent.user_id === userId),
          runs: agentRuns.filter((run) => visibleAgentIds.has(run.agent_id)),
        };
      },
      async create({ userId, body }) {
        const agent: DevAgent = {
          agent_id: stableUuid(`agent:${userId}:${String(body.name ?? "")}:${agents.size}`),
          user_id: userId,
          name: nonEmptyString(body.name) ?? "Untitled agent",
          thesis: nonEmptyString(body.thesis) ?? "Monitor source-backed changes.",
          cadence: nonEmptyString(body.cadence) ?? "daily",
          enabled: true,
          updated_at: new Date().toISOString(),
        };
        agents.set(agent.agent_id, agent);
        return agent;
      },
      async update({ userId, agentId, body }) {
        const existing = agents.get(agentId);
        if (!existing || existing.user_id !== userId) return null;
        const next: DevAgent = {
          ...existing,
          enabled: typeof body.enabled === "boolean" ? body.enabled : existing.enabled,
          name: nonEmptyString(body.name) ?? existing.name,
          thesis: nonEmptyString(body.thesis) ?? existing.thesis,
          cadence: nonEmptyString(body.cadence) ?? existing.cadence,
          updated_at: new Date().toISOString(),
        };
        agents.set(agentId, next);
        return next;
      },
      async delete({ userId, agentId }) {
        const existing = agents.get(agentId);
        if (!existing || existing.user_id !== userId) return false;
        agents.delete(agentId);
        return true;
      },
      async run({ userId, agentId }) {
        const agent = agents.get(agentId);
        if (!agent || agent.user_id !== userId) return null;
        const run: DevAgentRun = {
          agent_run_log_id: stableUuid(`run:${agentId}:${agentRuns.length}`),
          agent_id: agentId,
          status: "completed",
          started_at: new Date().toISOString(),
          ended_at: new Date().toISOString(),
          error: null,
        };
        agentRuns.unshift(run);
        return run;
      },
    },
  };
}

export type DevApiServiceAdapterDeps = {
  db: QueryExecutor & AnalyzeTemplateRunClientPool;
  sealAnalyzeSnapshot(input: {
    userId: string;
    templateId: string;
    body: Record<string, unknown>;
    blocks: ReadonlyArray<Record<string, unknown>>;
  }): Promise<SnapshotSealResult>;
};

export function createServiceDevApiAdapters(deps: DevApiServiceAdapterDeps): DevApiAdapters {
  return {
    analyze: {
      async listTemplates({ userId }) {
        const templates = await listAnalyzeTemplatesByUser(deps.db, userId);
        const runs = (
          await Promise.all(
            templates.map((template) => listAnalyzeRunsForTemplate(deps.db, template.template_id)),
          )
        ).flat();
        return {
          templates: templates.map((template) => ({
            template_id: template.template_id,
            name: template.name,
            prompt_template: template.prompt_template,
            source_categories: [...template.source_categories],
            version: template.version,
          })),
          runs,
        };
      },
      async createRun({ userId, body }) {
        const templateId = requireNonEmpty(body.template_id, "template_id");
        const template = await getAnalyzeTemplate(deps.db, templateId);
        if (template === null || template.user_id !== userId) {
          throw new DevApiHttpError(404, "analyze template not found");
        }
        const blockId = randomUUID();
        const blocks = [
          richTextBlock({
            id: blockId,
            snapshotId: "pending",
            title: template.name,
            text: nonEmptyString(body.instructions) ?? template.prompt_template,
          }),
        ];
        const persisted = await persistAnalyzeTemplateRunAfterSnapshotSealWithPool(deps.db, {
          template_id: template.template_id,
          template_version: template.version,
          blocks: blocks as JsonValue,
          sealSnapshot: () => deps.sealAnalyzeSnapshot({
            userId,
            templateId: template.template_id,
            body,
            blocks,
          }),
        });
        if (!persisted.ok) {
          throw new DevApiHttpError(422, "snapshot seal failed");
        }
        return {
          run_id: persisted.run.run_id,
          template_id: persisted.run.template_id,
          template_version: persisted.run.template_version,
          snapshot_id: persisted.run.snapshot_id,
          blocks: persisted.run.blocks as ReadonlyArray<Record<string, unknown>>,
          created_at: persisted.run.created_at,
        };
      },
    },
    agents: {
      async list({ userId }) {
        const rows = await listAgentsByUser(deps.db, userId);
        return {
          agents: rows.map(toDevAgent),
          runs: await listRunsForAgents(deps.db, rows.map((row) => row.agent_id)),
        };
      },
      async create({ userId, body }) {
        const row = await createAgent(deps.db, {
          user_id: userId,
          name: nonEmptyString(body.name) ?? "Untitled agent",
          thesis: nonEmptyString(body.thesis) ?? "Monitor source-backed changes.",
          cadence: nonEmptyString(body.cadence) ?? "daily",
          universe: readUniverse(body.universe),
          prompt_template: nonEmptyString(body.prompt_template) ?? undefined,
        });
        return toDevAgent(row);
      },
      async update({ userId, agentId, body }) {
        const existing = await getAgent(deps.db, agentId);
        if (existing === null || existing.user_id !== userId) return null;
        const row = await updateAgent(deps.db, agentId, {
          enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
          name: nonEmptyString(body.name) ?? undefined,
          thesis: nonEmptyString(body.thesis) ?? undefined,
          cadence: nonEmptyString(body.cadence) ?? undefined,
          universe: body.universe === undefined ? undefined : readUniverse(body.universe),
          prompt_template: nonEmptyString(body.prompt_template) ?? undefined,
        });
        return toDevAgent(row);
      },
      async delete({ userId, agentId }) {
        const result = await deps.db.query(
          `delete from agents
            where agent_id = $1::uuid
              and user_id = $2::uuid`,
          [agentId, userId],
        );
        return (result.rowCount ?? 0) > 0;
      },
      async run({ userId, agentId }) {
        const existing = await getAgent(deps.db, agentId);
        if (existing === null || existing.user_id !== userId) return null;
        const runId = randomUUID();
        const claimed = await claimAgentRun(deps.db, {
          run_id: runId,
          agent_id: agentId,
          inputs_watermark: { trigger: "manual" },
        });
        if (!claimed.claimed) return toDevAgentRun(claimed.row);
        return toDevAgentRun(await completeAgentRun(deps.db, {
          run_id: runId,
          outputs_summary: { trigger: "manual", status: "completed" },
        }));
      },
    },
  };
}

class DevApiHttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "DevApiHttpError";
    this.status = status;
  }
}

function requireNonEmpty(value: unknown, label: string): string {
  const text = nonEmptyString(value);
  if (text === null) throw new DevApiHttpError(400, `${label} is required`);
  return text;
}

function readUniverse(value: unknown): AgentUniverse {
  if (value !== null && typeof value === "object") return value as AgentUniverse;
  return { mode: "static", subject_refs: [] };
}

async function listAnalyzeRunsForTemplate(
  db: AnalyzeTemplateRunClientPool,
  templateId: string,
): Promise<DevAnalyzeRun[]> {
  const { listAnalyzeTemplateRunsByTemplate } = await import("../../analyze/src/index.ts");
  const rows = await listAnalyzeTemplateRunsByTemplate(db, templateId);
  return rows.map((row) => ({
    run_id: row.run_id,
    template_id: row.template_id,
    template_version: row.template_version,
    snapshot_id: row.snapshot_id,
    blocks: row.blocks as ReadonlyArray<Record<string, unknown>>,
    created_at: row.created_at,
  }));
}

async function listRunsForAgents(db: QueryExecutor, agentIds: string[]): Promise<DevAgentRun[]> {
  if (agentIds.length === 0) return [];
  const { rows } = await db.query<{
    agent_run_log_id: string;
    agent_id: string | null;
    status: "running" | "completed" | "failed";
    started_at: Date | string;
    ended_at: Date | string | null;
    error: string | null;
  }>(
    `select agent_run_log_id::text as agent_run_log_id,
            agent_id::text as agent_id,
            status,
            started_at,
            ended_at,
            error
       from agent_run_logs
      where agent_id = any($1::uuid[])
      order by started_at desc, agent_run_log_id asc`,
    [agentIds],
  );
  return rows.map((row) => ({
    agent_run_log_id: row.agent_run_log_id,
    agent_id: row.agent_id ?? "",
    status: row.status,
    started_at: new Date(row.started_at).toISOString(),
    ended_at: row.ended_at === null ? null : new Date(row.ended_at).toISOString(),
    error: row.error,
  }));
}

function toDevAgent(row: AgentRow): DevAgent {
  return {
    agent_id: row.agent_id,
    user_id: row.user_id,
    name: row.name,
    thesis: row.thesis,
    cadence: row.cadence,
    enabled: row.enabled,
    updated_at: row.updated_at,
  };
}

function toDevAgentRun(row: AgentRunRow): DevAgentRun {
  return {
    agent_run_log_id: row.agent_run_log_id,
    agent_id: row.agent_id,
    status: row.status,
    started_at: row.started_at,
    ended_at: row.ended_at,
    error: row.error,
  };
}

function respondJson(res: ServerResponse, status: number, body: object) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

const BAD_JSON = Symbol("BAD_JSON");

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

function readUserIdHeader(value: string | string[] | undefined): string | null {
  if (typeof value !== "string") return null;
  return nonEmptyString(value);
}

function stableUuid(seed: string): string {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }
  const suffix = hash.toString(16).padStart(12, "0").slice(-12);
  return `00000000-0000-4000-8000-${suffix}`;
}

function richTextBlock(input: {
  id: string;
  snapshotId: string;
  title: string;
  text: string;
}): Record<string, unknown> {
  return {
    id: input.id,
    kind: "rich_text",
    snapshot_id: input.snapshotId,
    data_ref: { kind: "analyze_run", id: input.id },
    source_refs: [],
    as_of: new Date(0).toISOString(),
    title: input.title,
    segments: [{ type: "text", text: input.text }],
  };
}

function defaultAnalyzeTemplates(): DevAnalyzeTemplate[] {
  return [
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
  ];
}

function serviceCatalog(env: Record<string, string | undefined>, hasAdapters: boolean) {
  const bffStatus = hasAdapters ? "bff_durable_adapter" : "bff_unavailable";
  return [
    { name: "chat", status: "vite_proxy", origin: env.CHAT_ORIGIN ?? "http://127.0.0.1:4310" },
    { name: "resolver", status: "vite_proxy", origin: env.RESOLVER_ORIGIN ?? "http://127.0.0.1:4311" },
    { name: "watchlists", status: "vite_proxy", origin: env.WATCHLISTS_ORIGIN ?? "http://127.0.0.1:4313" },
    { name: "market", status: "vite_proxy", origin: env.MARKET_ORIGIN ?? "http://127.0.0.1:4321" },
    { name: "fundamentals", status: "vite_proxy", origin: env.FUNDAMENTALS_ORIGIN ?? "http://127.0.0.1:4322" },
    { name: "screener", status: "vite_proxy", origin: env.SCREENER_ORIGIN ?? "http://127.0.0.1:4323" },
    { name: "portfolio", status: "vite_proxy", origin: env.PORTFOLIO_ORIGIN ?? "http://127.0.0.1:4333" },
    { name: "home", status: "vite_proxy", origin: env.HOME_ORIGIN ?? "http://127.0.0.1:4334" },
    { name: "evidence", status: "vite_proxy", origin: env.EVIDENCE_ORIGIN ?? "http://127.0.0.1:4335" },
    { name: "analyze", status: bffStatus, origin: env.DEV_API_ORIGIN ?? "http://127.0.0.1:4312" },
    { name: "agents", status: bffStatus, origin: env.DEV_API_ORIGIN ?? "http://127.0.0.1:4312" },
    { name: "artifact", status: "library", note: "shared through service callers; no standalone dev HTTP server" },
    { name: "snapshot", status: "library", note: "used by chat/analyze persistence paths; no standalone dev HTTP server" },
    { name: "tools", status: "library", note: "analyst tool registry package; no standalone dev HTTP server" },
    { name: "observability", status: "library", note: "run activity primitives exposed through chat/home routes" },
    { name: "themes", status: "library", note: "theme inference package; no standalone dev HTTP server" },
    { name: "summary", status: "library", note: "summary package; no standalone dev HTTP server" },
  ];
}
