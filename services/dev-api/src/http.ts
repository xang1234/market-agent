import { createServer, type Server, type ServerResponse } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import {
  getAnalyzeTemplate,
  getAnalyzeTemplateRun,
  listAnalyzeTemplatesByUser,
  mapSourceCategoriesToBundles,
  persistAnalyzeTemplateRunAfterSnapshotSealWithPool,
  SourceCategoryMappingError,
  type AnalyzeTemplateRunRow,
  type AnalyzeTemplateRunClientPool,
  type AnalyzeTemplateRow,
} from "../../analyze/src/index.ts";
import {
  claimAgentRun,
  completeAgentRun,
  createAgent,
  failAgentRun,
  getAgent,
  listAgentsByUser,
  runAgentLoop,
  updateAgent,
  type AgentLoopStages,
  type AgentRow,
  type AgentRunRow,
  type AgentUniverse,
  type QueryExecutor,
} from "../../agents/src/index.ts";
import {
  shareArtifactToChat,
  type ShareableArtifactBlock,
} from "../../artifact/src/index.ts";
import {
  persistImportedArtifactMessage,
  type ChatMessagePersistenceDb,
  type ChatMessageRow,
} from "../../chat/src/messages.ts";
import {
  createThread,
  type ChatThread,
  type ChatThreadsDb,
} from "../../chat/src/threads-repo.ts";
import type { JsonValue } from "../../observability/src/types.ts";
import type { SubjectRef } from "../../resolver/src/subject-ref.ts";
import type { SnapshotSealResult } from "../../snapshot/src/snapshot-sealer.ts";
import { readDevFlags } from "../../shared/src/devFlags.ts";
import {
  listThemeMembershipRationalesBySubject,
  type ThemeMembershipRationaleRow,
} from "../../themes/src/index.ts";

type DevAgent = {
  agent_id: string;
  user_id: string;
  name: string;
  thesis: string;
  cadence: string;
  universe: AgentUniverse;
  alert_rules: JsonValue;
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

type DevAgentFinding = {
  finding_id: string;
  agent_id: string;
  snapshot_id: string;
  headline: string;
  severity: string;
  subject_refs: JsonValue;
  claim_cluster_ids: JsonValue;
  summary_blocks: JsonValue;
  created_at: string;
};

type DevAgentActivity = {
  run_activity_id: string;
  agent_id: string;
  stage: string;
  subject_refs: JsonValue;
  source_refs: JsonValue;
  summary: string;
  ts: string;
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

type DevArtifactShareResult = {
  thread: ChatThread;
  message: ChatMessageRow;
  origin_snapshot_ids: ReadonlyArray<string>;
};

type DevThemeMembershipRationale = {
  theme_id: string;
  theme_name: string;
  theme_description: string | null;
  membership_mode: ThemeMembershipRationaleRow["membership_mode"];
  score: number | null;
  rationale_supported: boolean;
  rationale_claim_ids: ReadonlyArray<string>;
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
  shareRunToChat(input: {
    userId: string;
    runId: string;
    body: Record<string, unknown>;
  }): Promise<DevArtifactShareResult>;
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
  listFindings(input: { userId: string; agentId: string }): Promise<{
    findings: DevAgentFinding[];
  } | null>;
  listActivity(input: { userId: string; agentId: string }): Promise<{
    activity: DevAgentActivity[];
  } | null>;
};

export type DevApiThemesAdapter = {
  listMembershipRationales(input: {
    subjectRef: SubjectRef;
    asOf?: string;
    limit?: number;
  }): Promise<{
    memberships: DevThemeMembershipRationale[];
    truncated: boolean;
  }>;
};

export type DevApiAdapters = {
  analyze: DevApiAnalyzeAdapter;
  agents: DevApiAgentsAdapter;
  themes: DevApiThemesAdapter;
};

export type DevApiAnalyzeWorkflowInput = {
  userId: string;
  template: AnalyzeTemplateRow;
  body: Record<string, unknown>;
  snapshotId: string;
  instructions: string;
  sourceCategories: ReadonlyArray<string>;
  bundleIds: ReadonlyArray<string>;
  subjectRefs: ReadonlyArray<SubjectRef>;
};

export type DevApiAnalyzeWorkflowResult = {
  blocks: ReadonlyArray<Record<string, unknown>>;
};

export type DevApiAgentLoopStageFactoryInput = {
  userId: string;
  runId: string;
  agent: AgentRow;
  trigger?: "manual" | "scheduled";
};

export type DevApiAgentLoopStageFactory = (
  input: DevApiAgentLoopStageFactoryInput,
) => AgentLoopStages;

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

    if (req.method === "GET" && url.pathname === "/v1/themes/membership-rationales") {
      if (!adapters) {
        respondJson(res, 503, { error: "durable themes adapter is not configured" });
        return;
      }
      respondJson(res, 200, await adapters.themes.listMembershipRationales({
        subjectRef: readSubjectRefFromQuery(url),
        asOf: readOptionalIsoTimestamp(url.searchParams.get("as_of"), "as_of"),
        limit: readOptionalPositiveInteger(url.searchParams.get("limit"), "limit"),
      }));
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

    const analyzeShareMatch = url.pathname.match(/^\/v1\/analyze\/runs\/([^/]+)\/share-to-chat$/);
    if (req.method === "POST" && analyzeShareMatch) {
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
        respondJson(res, 503, { error: "durable artifact adapter is not configured" });
        return;
      }
      respondJson(res, 201, await adapters.analyze.shareRunToChat({
        userId,
        runId: decodeURIComponent(analyzeShareMatch[1]),
        body: input,
      }));
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

    const findingsMatch = url.pathname.match(/^\/v1\/agents\/([^/]+)\/findings$/);
    if (req.method === "GET" && findingsMatch) {
      const userId = readUserIdHeader(req.headers["x-user-id"]);
      if (userId === null) {
        respondJson(res, 401, { error: "x-user-id header is required" });
        return;
      }
      const agentId = decodeURIComponent(findingsMatch[1]);
      if (!adapters) {
        respondJson(res, 503, { error: "durable agents adapter is not configured" });
        return;
      }
      const findings = await adapters.agents.listFindings({ userId, agentId });
      if (findings === null) {
        respondJson(res, 404, { error: "agent not found" });
        return;
      }
      respondJson(res, 200, findings);
      return;
    }

    const activityMatch = url.pathname.match(/^\/v1\/agents\/([^/]+)\/activity$/);
    if (req.method === "GET" && activityMatch) {
      const userId = readUserIdHeader(req.headers["x-user-id"]);
      if (userId === null) {
        respondJson(res, 401, { error: "x-user-id header is required" });
        return;
      }
      const agentId = decodeURIComponent(activityMatch[1]);
      if (!adapters) {
        respondJson(res, 503, { error: "durable agents adapter is not configured" });
        return;
      }
      const activity = await adapters.agents.listActivity({ userId, agentId });
      if (activity === null) {
        respondJson(res, 404, { error: "agent not found" });
        return;
      }
      respondJson(res, 200, activity);
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
        respondJson(res, error.status, {
          error: error.message,
          ...(error.details === undefined ? {} : { details: error.details }),
        });
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
    universe: { mode: "static", subject_refs: [{ kind: "issuer", id: "demo-issuer" }] },
    alert_rules: [
      {
        rule_id: "demo-margin",
        severity_at_least: "critical",
        headline_contains: "margin",
        channels: ["email"],
      },
    ],
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
      async shareRunToChat({ userId, runId, body }) {
        const run = analyzeRuns.find((candidate) => candidate.run_id === runId);
        if (!run || runOwner(run.run_id) !== userId) {
          throw new DevApiHttpError(404, "analyze run not found");
        }
        const thread = fixtureThread({
          userId,
          title: nonEmptyString(body.title) ?? "Research memo",
          primarySubjectRef: readOptionalSubjectRef(body.primary_subject_ref),
        });
        const blocks = enrichAnalyzeRunBlocks(run.blocks, run);
        const shared = await shareArtifactToChat({
          sources: [
            {
              source_kind: "memo",
              origin_snapshot_id: run.snapshot_id,
              blocks,
            },
          ],
          egress: {
            db: emptyEgressDb(),
            listFactsForEgress: async (_db, input) =>
              input.fact_ids.map((factId) => ({ fact_id: factId }) as never),
          },
        });
        if (!shared.ok) throw new DevApiHttpError(422, "artifact share rejected", shared.rejections);
        const sharedBlocks = shared.blocks as JsonValue;
        return {
          thread,
          message: {
            message_id: stableUuid(`artifact-message:${thread.thread_id}:${contentHash(sharedBlocks)}`),
            thread_id: thread.thread_id,
            role: "assistant",
            snapshot_id: shared.origin_snapshot_ids[0] ?? run.snapshot_id,
            blocks: sharedBlocks,
            content_hash: contentHash(sharedBlocks),
            created_at: new Date().toISOString(),
          },
          origin_snapshot_ids: shared.origin_snapshot_ids,
        };
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
          universe: readUniverse(body.universe),
          alert_rules: readAlertRules(body.alert_rules),
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
          universe: body.universe === undefined ? existing.universe : readUniverse(body.universe),
          alert_rules: body.alert_rules === undefined ? existing.alert_rules : readAlertRules(body.alert_rules),
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
      async listFindings({ userId, agentId }) {
        const agent = agents.get(agentId);
        if (!agent || agent.user_id !== userId) return null;
        return { findings: [] };
      },
      async listActivity({ userId, agentId }) {
        const agent = agents.get(agentId);
        if (!agent || agent.user_id !== userId) return null;
        return { activity: [] };
      },
    },
    themes: {
      async listMembershipRationales() {
        return { memberships: [], truncated: false };
      },
    },
  };
}

export type DevApiServiceAdapterDeps = {
  db: QueryExecutor & AnalyzeTemplateRunClientPool & ChatMessagePersistenceDb & ChatThreadsDb;
  runAnalyzeWorkflow?(
    input: DevApiAnalyzeWorkflowInput,
  ): Promise<DevApiAnalyzeWorkflowResult> | DevApiAnalyzeWorkflowResult;
  createAgentLoopStages?: DevApiAgentLoopStageFactory;
  sealAnalyzeSnapshot(input: {
    snapshotId: string;
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
        const snapshotId = randomUUID();
        const sourceCategories = readAnalyzeSourceCategories(body.source_categories, template.source_categories);
        const bundleIds = analyzeBundleIds(sourceCategories);
        const subjectRefs = analyzeSubjectRefs({
          primary: readOptionalSubjectRef(body.subject_ref ?? body.primary_subject_ref),
          added: template.added_subject_refs,
        });
        const instructions = nonEmptyString(body.instructions) ?? template.prompt_template;
        if (!deps.runAnalyzeWorkflow) {
          throw new DevApiHttpError(503, "durable analyze workflow is not configured");
        }
        const rendered = await deps.runAnalyzeWorkflow({
          userId,
          template,
          body,
          snapshotId,
          instructions,
          sourceCategories,
          bundleIds,
          subjectRefs,
        });
        const blocks = Object.freeze(rendered.blocks.map((block) => Object.freeze({ ...block })));
        const persisted = await persistAnalyzeTemplateRunAfterSnapshotSealWithPool(deps.db, {
          template_id: template.template_id,
          template_version: template.version,
          blocks: blocks as JsonValue,
          sealSnapshot: async () => {
            const seal = await deps.sealAnalyzeSnapshot({
              snapshotId,
              userId,
              templateId: template.template_id,
              body,
              blocks,
            });
            if (seal.ok && seal.snapshot.snapshot_id !== snapshotId) {
              return {
                ok: false,
                verification: {
                  ok: false,
                  failures: [
                    {
                      reason_code: "invalid_block_binding",
                      details: {
                        reason: "analyze_snapshot_id_mismatch",
                        expected_snapshot_id: snapshotId,
                        actual_snapshot_id: seal.snapshot.snapshot_id,
                      },
                    },
                  ],
                },
              };
            }
            return seal;
          },
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
      async shareRunToChat({ userId, runId, body }) {
        const run = await getAnalyzeTemplateRun(deps.db, runId);
        if (run === null) throw new DevApiHttpError(404, "analyze run not found");
        const template = await getAnalyzeTemplate(deps.db, run.template_id);
        if (template === null || template.user_id !== userId) {
          throw new DevApiHttpError(404, "analyze run not found");
        }
        const blocks = enrichAnalyzeRunBlocks(run.blocks, run);
        const shared = await shareArtifactToChat({
          sources: [
            {
              source_kind: "memo",
              origin_snapshot_id: run.snapshot_id,
              blocks,
            },
          ],
          egress: { db: deps.db },
        });
        if (!shared.ok) throw new DevApiHttpError(422, "artifact share rejected", shared.rejections);
        const snapshotId = shared.origin_snapshot_ids[0];
        if (snapshotId === undefined) throw new DevApiHttpError(422, "artifact share rejected");

        const client = await deps.db.connect();
        try {
          await client.query("begin");
          const thread = await createThread(client, userId, {
            title: nonEmptyString(body.title) ?? "Research memo",
            primary_subject_ref: readOptionalSubjectRef(body.primary_subject_ref) ?? undefined,
          });
          const message = await persistImportedArtifactMessage(client, {
            thread_id: thread.thread_id,
            user_id: userId,
            role: "assistant",
            snapshot_id: snapshotId,
            blocks: shared.blocks as JsonValue,
            content_hash: contentHash(shared.blocks as JsonValue),
          });
          if (message === null) throw new DevApiHttpError(404, "chat thread not found");
          await client.query("commit");
          return {
            thread,
            message,
            origin_snapshot_ids: shared.origin_snapshot_ids,
          };
        } catch (error) {
          try {
            await client.query("rollback");
          } catch (rollbackError) {
            if (error !== null && typeof error === "object") {
              (error as { rollback_error?: unknown }).rollback_error = rollbackError;
            }
          }
          throw error;
        } finally {
          client.release();
        }
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
          alert_rules: readAlertRules(body.alert_rules),
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
          alert_rules: body.alert_rules === undefined ? undefined : readAlertRules(body.alert_rules),
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
      async listFindings({ userId, agentId }) {
        const existing = await getAgent(deps.db, agentId);
        if (existing === null || existing.user_id !== userId) return null;
        return { findings: await listFindingsForAgent(deps.db, agentId) };
      },
      async listActivity({ userId, agentId }) {
        const existing = await getAgent(deps.db, agentId);
        if (existing === null || existing.user_id !== userId) return null;
        return { activity: await listActivityForAgent(deps.db, agentId) };
      },
      async run({ userId, agentId }) {
        const existing = await getAgent(deps.db, agentId);
        if (existing === null || existing.user_id !== userId) return null;
        if (!deps.createAgentLoopStages) {
          throw new DevApiHttpError(503, "durable agent loop stages are not configured");
        }
        const runId = randomUUID();
        const claimed = await claimAgentRun(deps.db, {
          run_id: runId,
          agent_id: agentId,
          inputs_watermark: { trigger: "manual" },
        });
        if (!claimed.claimed) return toDevAgentRun(claimed.row);
        try {
          const loopAgent = await getAgent(deps.db, agentId);
          if (loopAgent === null || loopAgent.user_id !== userId) {
            return toDevAgentRun(await failAgentRun(deps.db, {
              run_id: runId,
              error: "agent not found after run claim",
              outputs_summary: { trigger: "manual", status: "failed" },
            }));
          }
          const loopResult = await runAgentLoop({
            pool: deps.db,
            agent_id: agentId,
            run_id: runId,
            current_watermarks: loopAgent.watermarks,
            alert_rules: Array.isArray(loopAgent.alert_rules) ? loopAgent.alert_rules : [],
            stages: deps.createAgentLoopStages({
              userId,
              runId,
              agent: loopAgent,
              trigger: "manual",
            }),
          });
          return toDevAgentRun(await completeAgentRun(deps.db, {
            run_id: runId,
            outputs_summary: {
              trigger: "manual",
              status: "completed",
              ...jsonObjectOrEmpty(loopResult.outputs_summary),
              next_watermarks: loopResult.next_watermarks,
            },
          }));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return toDevAgentRun(await failAgentRun(deps.db, {
            run_id: runId,
            error: message,
            outputs_summary: { trigger: "manual", status: "failed" },
          }));
        }
      },
    },
    themes: {
      async listMembershipRationales({ subjectRef, asOf, limit }) {
        const page = await listThemeMembershipRationalesBySubject(deps.db, subjectRef, {
          asOf,
          limit,
        });
        return {
          memberships: page.rows.map(toDevThemeMembershipRationale),
          truncated: page.truncated,
        };
      },
    },
  };
}

class DevApiHttpError extends Error {
  readonly status: number;
  readonly details: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = "DevApiHttpError";
    this.status = status;
    this.details = details;
  }
}

function requireNonEmpty(value: unknown, label: string): string {
  const text = nonEmptyString(value);
  if (text === null) throw new DevApiHttpError(400, `${label} is required`);
  return text;
}

function contentHash(value: JsonValue): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function readAnalyzeSourceCategories(
  value: unknown,
  fallback: ReadonlyArray<string>,
): ReadonlyArray<string> {
  if (value === undefined || value === null) return [...fallback];
  if (!Array.isArray(value)) {
    throw new DevApiHttpError(400, "source_categories must be an array");
  }
  const categories = value.map((category, index) => {
    const text = nonEmptyString(category);
    if (text === null) throw new DevApiHttpError(400, `source_categories[${index}] must be a non-empty string`);
    return text;
  });
  return categories;
}

function analyzeBundleIds(sourceCategories: ReadonlyArray<string>): ReadonlyArray<string> {
  try {
    return mapSourceCategoriesToBundles({ categories: sourceCategories }).bundle_ids;
  } catch (error) {
    if (error instanceof SourceCategoryMappingError) {
      throw new DevApiHttpError(400, error.message);
    }
    throw error;
  }
}

function analyzeSubjectRefs(input: {
  primary: SubjectRef | null;
  added: ReadonlyArray<SubjectRef>;
}): ReadonlyArray<SubjectRef> {
  const byKey = new Map<string, SubjectRef>();
  for (const ref of [
    ...(input.primary ? [input.primary] : []),
    ...input.added,
  ]) {
    byKey.set(`${ref.kind}:${ref.id}`, { kind: ref.kind, id: ref.id });
  }
  return Object.freeze([...byKey.values()]);
}

function readOptionalSubjectRef(value: unknown): SubjectRef | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new DevApiHttpError(400, "primary_subject_ref is invalid");
  }
  const candidate = value as Partial<SubjectRef>;
  if (typeof candidate.kind !== "string" || typeof candidate.id !== "string") {
    throw new DevApiHttpError(400, "primary_subject_ref is invalid");
  }
  return { kind: candidate.kind as SubjectRef["kind"], id: candidate.id };
}

const SUBJECT_KINDS: ReadonlyArray<SubjectRef["kind"]> = Object.freeze([
  "issuer",
  "instrument",
  "listing",
  "theme",
  "macro_topic",
  "portfolio",
  "screen",
]);

function readSubjectRefFromQuery(url: URL): SubjectRef {
  const kind = nonEmptyString(url.searchParams.get("subject_kind"));
  const id = nonEmptyString(url.searchParams.get("subject_id"));
  if (kind === null || id === null) {
    throw new DevApiHttpError(400, "subject_kind and subject_id are required");
  }
  if (!SUBJECT_KINDS.includes(kind as SubjectRef["kind"])) {
    throw new DevApiHttpError(400, "subject_kind is invalid");
  }
  return { kind: kind as SubjectRef["kind"], id };
}

function readOptionalPositiveInteger(value: string | null, label: string): number | undefined {
  if (value === null || value.trim() === "") return undefined;
  const numberValue = Number(value);
  if (!Number.isInteger(numberValue) || numberValue <= 0) {
    throw new DevApiHttpError(400, `${label} must be a positive integer`);
  }
  return numberValue;
}

function readOptionalIsoTimestamp(value: string | null, label: string): string | undefined {
  const text = nonEmptyString(value);
  if (text === null) return undefined;
  if (Number.isNaN(Date.parse(text))) {
    throw new DevApiHttpError(400, `${label} must be a valid ISO timestamp`);
  }
  return text;
}

function enrichAnalyzeRunBlocks(
  blocks: ReadonlyArray<Record<string, unknown> | JsonValue>,
  run: Pick<AnalyzeTemplateRunRow | DevAnalyzeRun, "run_id" | "template_id" | "template_version" | "snapshot_id" | "created_at">,
): ShareableArtifactBlock[] {
  return blocks.map((block) => {
    if (block === null || typeof block !== "object" || Array.isArray(block)) {
      return block as ShareableArtifactBlock;
    }
    const record = block as Record<string, JsonValue>;
    const dataRef = record.data_ref;
    const dataRefRecord = dataRef !== null && typeof dataRef === "object" && !Array.isArray(dataRef)
      ? dataRef as Record<string, JsonValue>
      : { kind: "analyze_run", id: run.run_id };
    const params = dataRefRecord.params;
    const paramsRecord = params !== null && typeof params === "object" && !Array.isArray(params)
      ? params as Record<string, JsonValue>
      : {};
    return {
      ...record,
      data_ref: {
        ...dataRefRecord,
        params: {
          ...paramsRecord,
          analyze_run_id: run.run_id,
          analyze_template_id: run.template_id,
          analyze_template_version: run.template_version,
          analyze_run_created_at: run.created_at,
          origin_snapshot_id: run.snapshot_id,
        },
      },
    } as ShareableArtifactBlock;
  });
}

function fixtureThread(input: {
  userId: string;
  title: string | null;
  primarySubjectRef: SubjectRef | null;
}): ChatThread {
  const now = new Date().toISOString();
  return {
    thread_id: stableUuid(`thread:${input.userId}:${input.title ?? ""}:${now}`),
    user_id: input.userId,
    title: input.title,
    primary_subject_ref: input.primarySubjectRef,
    latest_snapshot_id: null,
    archived_at: null,
    created_at: now,
    updated_at: now,
  };
}

function emptyEgressDb(): QueryExecutor {
  return {
    async query() {
      return { rows: [], rowCount: 0 };
    },
  };
}

function readUniverse(value: unknown): AgentUniverse {
  if (value !== null && typeof value === "object") return value as AgentUniverse;
  return { mode: "static", subject_refs: [] };
}

function readAlertRules(value: unknown): JsonValue {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new DevApiHttpError(400, "alert_rules must be an array");
  }
  return value as JsonValue;
}

function jsonObjectOrEmpty(value: JsonValue | null | undefined): Record<string, JsonValue> {
  return value !== null && value !== undefined && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function jsonArrayOrEmpty(value: JsonValue | null | undefined): JsonValue {
  return Array.isArray(value) ? value : [];
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

async function listFindingsForAgent(db: QueryExecutor, agentId: string): Promise<DevAgentFinding[]> {
  const { rows } = await db.query<{
    finding_id: string;
    agent_id: string;
    snapshot_id: string;
    headline: string;
    severity: string;
    subject_refs: JsonValue | null;
    claim_cluster_ids: JsonValue | null;
    summary_blocks: JsonValue | null;
    created_at: Date | string;
  }>(
    `select finding_id::text as finding_id,
            agent_id::text as agent_id,
            snapshot_id::text as snapshot_id,
            headline,
            severity::text as severity,
            subject_refs,
            claim_cluster_ids,
            summary_blocks,
            created_at
       from findings
      where agent_id = $1::uuid
      order by created_at desc, finding_id asc`,
    [agentId],
  );
  return rows.map((row) => ({
    finding_id: row.finding_id,
    agent_id: row.agent_id,
    snapshot_id: row.snapshot_id,
    headline: row.headline,
    severity: row.severity,
    subject_refs: jsonArrayOrEmpty(row.subject_refs),
    claim_cluster_ids: jsonArrayOrEmpty(row.claim_cluster_ids),
    summary_blocks: jsonArrayOrEmpty(row.summary_blocks),
    created_at: new Date(row.created_at).toISOString(),
  }));
}

async function listActivityForAgent(db: QueryExecutor, agentId: string): Promise<DevAgentActivity[]> {
  const { rows } = await db.query<{
    run_activity_id: string;
    agent_id: string;
    stage: string;
    subject_refs: JsonValue | null;
    source_refs: JsonValue | null;
    summary: string;
    ts: Date | string;
  }>(
    `select run_activity_id::text as run_activity_id,
            agent_id::text as agent_id,
            stage::text as stage,
            subject_refs,
            source_refs,
            summary,
            ts
       from run_activities
      where agent_id = $1::uuid
      order by ts desc, run_activity_id asc`,
    [agentId],
  );
  return rows.map((row) => ({
    run_activity_id: row.run_activity_id,
    agent_id: row.agent_id,
    stage: row.stage,
    subject_refs: jsonArrayOrEmpty(row.subject_refs),
    source_refs: jsonArrayOrEmpty(row.source_refs),
    summary: row.summary,
    ts: new Date(row.ts).toISOString(),
  }));
}

function toDevAgent(row: AgentRow): DevAgent {
  return {
    agent_id: row.agent_id,
    user_id: row.user_id,
    name: row.name,
    thesis: row.thesis,
    cadence: row.cadence,
    universe: row.universe,
    alert_rules: row.alert_rules,
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

function toDevThemeMembershipRationale(row: ThemeMembershipRationaleRow): DevThemeMembershipRationale {
  return {
    theme_id: row.theme_id,
    theme_name: row.theme_name,
    theme_description: row.theme_description,
    membership_mode: row.membership_mode,
    score: row.score,
    rationale_supported: row.rationale_supported,
    rationale_claim_ids: [...row.rationale_claim_ids],
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
    { name: "artifact", status: bffStatus, origin: env.DEV_API_ORIGIN ?? "http://127.0.0.1:4312", note: "share-to-chat is exposed through dev-api; no standalone dev HTTP server" },
    { name: "snapshot", status: "library", note: "used by chat/analyze persistence paths; no standalone dev HTTP server" },
    { name: "tools", status: "library", note: "analyst tool registry package; no standalone dev HTTP server" },
    { name: "observability", status: "library", note: "run activity primitives exposed through chat/home routes" },
    { name: "themes", status: bffStatus, origin: env.DEV_API_ORIGIN ?? "http://127.0.0.1:4312", note: "theme membership rationale is exposed through dev-api; no standalone dev HTTP server" },
    { name: "summary", status: "library", note: "summary package; no standalone dev HTTP server" },
  ];
}
