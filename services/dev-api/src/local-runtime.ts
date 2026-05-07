import { randomUUID } from "node:crypto";

import { Pool } from "pg";

import type { JsonValue } from "../../observability/src/types.ts";
import { writeRunActivity } from "../../observability/src/run-activity.ts";
import { generateFinding, type FindingRow } from "../../agents/src/finding-generator.ts";
import type { SnapshotSubjectRef } from "../../snapshot/src/manifest-staging.ts";
import { stageSnapshotManifest } from "../../snapshot/src/manifest-staging.ts";
import { sealSnapshotWithPool } from "../../snapshot/src/snapshot-sealer.ts";
import type {
  DevApiAgentLoopStageFactory,
  DevApiAnalyzeWorkflowInput,
  DevApiAnalyzeWorkflowResult,
  DevApiServiceAdapterDeps,
} from "./http.ts";

let localPool: Pool | null = null;

export async function runAnalyzeWorkflow(
  input: DevApiAnalyzeWorkflowInput,
): Promise<DevApiAnalyzeWorkflowResult> {
  const asOf = new Date().toISOString();
  const subjectRefs = normalizeSubjectRefs(input.subjectRefs, input.snapshotId);
  return {
    blocks: [
      {
        id: randomUUID(),
        kind: "rich_text",
        snapshot_id: input.snapshotId,
        data_ref: { kind: "rich_text", id: `analyze:${input.template.template_id}` },
        source_refs: [],
        as_of: asOf,
        subject_refs: subjectRefs,
        title: input.template.name,
        segments: [
          {
            type: "text",
            text: analyzeMemoText(input),
          },
        ],
      },
    ],
  };
}

export async function sealAnalyzeSnapshot(
  input: Parameters<DevApiServiceAdapterDeps["sealAnalyzeSnapshot"]>[0],
) {
  const blocks = input.blocks as ReadonlyArray<Record<string, unknown>>;
  const snapshotId = input.snapshotId;
  const asOf = maxBlockAsOf(blocks) ?? new Date().toISOString();
  const subjectRefs = subjectRefsFromBlocks(blocks, snapshotId);
  return sealSnapshotWithPool(pool(), {
    snapshot_id: snapshotId,
    manifest: stageSnapshotManifest({
      subject_refs: subjectRefs,
      as_of: asOf,
      basis: "reported",
      normalization: "raw",
      allowed_transforms: {},
      model_version: "dev-api-local-runtime",
      tool_calls: [],
    }),
    blocks: blocks as never,
    sources: [],
    documents: [],
  });
}

export const createAgentLoopStages: DevApiAgentLoopStageFactory = ({ userId, runId, agent }) => {
  const subjectRefs = normalizeSubjectRefs(subjectRefsFromUniverse(agent.universe), agent.agent_id);
  const snapshotId = randomUUID();
  const asOf = new Date().toISOString();
  const claimClusterId = randomUUID();
  let findings: ReadonlyArray<FindingRow> = [];
  return {
    readDeltas: async ({ current_watermarks }) => {
      const seal = await sealSnapshotWithPool(pool(), {
        snapshot_id: snapshotId,
        manifest: stageSnapshotManifest({
          subject_refs: subjectRefs,
          as_of: asOf,
          basis: "unadjusted",
          normalization: "raw",
          allowed_transforms: {},
          model_version: "dev-api-local-agent-runtime",
          tool_calls: [],
        }),
        blocks: [],
        sources: [],
        documents: [],
      });
      if (!seal.ok) {
        throw new Error(`local agent runtime failed to seal run snapshot: ${JSON.stringify(seal.verification.failures)}`);
      }
      return {
        trigger: "manual",
        run_id: runId,
        snapshot_id: snapshotId,
        current_watermarks,
      };
    },
    extractEvidence: async ({ deltas }) => ({
      deltas,
      subject_refs: subjectRefs,
    }),
    clusterEvidence: async ({ evidence }) => ({
      evidence,
      clusters: [],
    }),
    analyze: async ({ clusters }) => ({
      clusters,
      findings: [],
    }),
    nextWatermarks: async ({ current_watermarks }) => ({
      ...(isJsonObject(current_watermarks) ? current_watermarks : {}),
      last_manual_run_id: runId,
      last_checked_at: new Date().toISOString(),
    }),
    applySideEffects: async ({ tx }) => {
      await writeRunActivity(tx, {
        user_id: userId,
        agent_id: agent.agent_id,
        stage: "reading",
        subject_refs: subjectRefs,
        summary: "Checked configured research universe for new evidence.",
      });
      const finding = await generateFinding(tx, {
        agent_id: agent.agent_id,
        snapshot_id: snapshotId,
        snapshot_manifest: {
          snapshot_id: snapshotId,
          source_ids: [],
          as_of: asOf,
        },
        subject_refs: subjectRefs,
        claim_cluster_ids: [claimClusterId],
        headline: "Local agent run checked the configured research universe",
        severity_input: {
          evidence: {
            trust_tier: "user",
            corroborating_source_count: 0,
            confidence: 0.5,
          },
          impact: {
            direction: "unknown",
            channel: "sentiment",
            horizon: "near_term",
            confidence: 0.35,
          },
          thesis_relevance: 0.5,
        },
        source_refs: [],
      });
      findings = [finding];
      return {
        findings: findings.length,
        activities: 1,
      };
    },
    alertFindings: async () => findings,
  };
};

function pool(): Pool {
  if (localPool) return localPool;
  const databaseUrl = process.env.DEV_API_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for dev-api local runtime");
  }
  localPool = new Pool({ connectionString: databaseUrl });
  return localPool;
}

export async function closeLocalRuntimePoolForTests(): Promise<void> {
  const poolToClose = localPool;
  localPool = null;
  await poolToClose?.end();
}

function analyzeMemoText(input: DevApiAnalyzeWorkflowInput): string {
  const sources = input.sourceCategories.length > 0 ? input.sourceCategories.join(", ") : "base template scope";
  const subjects = input.subjectRefs.length > 0
    ? input.subjectRefs.map((subject) => `${subject.kind}:${subject.id}`).join(", ")
    : "the active workspace context";
  return [
    input.instructions,
    `Sources: ${sources}.`,
    `Subjects: ${subjects}.`,
    `Bundles: ${input.bundleIds.join(", ")}.`,
  ].join("\n\n");
}

function subjectRefsFromBlocks(
  blocks: ReadonlyArray<Record<string, unknown>>,
  fallbackId: string,
): ReadonlyArray<SnapshotSubjectRef> {
  const refs: SnapshotSubjectRef[] = [];
  for (const block of blocks) {
    const subjectRefs = block.subject_refs;
    if (!Array.isArray(subjectRefs)) continue;
    for (const subjectRef of subjectRefs) {
      if (isSnapshotSubjectRef(subjectRef)) refs.push(subjectRef);
    }
  }
  return normalizeSubjectRefs(refs, fallbackId);
}

function subjectRefsFromUniverse(universe: unknown): ReadonlyArray<SnapshotSubjectRef> {
  if (!isJsonObject(universe)) return [];
  if (universe.mode === "static" && Array.isArray(universe.subject_refs)) {
    return universe.subject_refs.filter(isSnapshotSubjectRef);
  }
  if (typeof universe.mode === "string" && typeof universe[`${universe.mode}_id`] === "string") {
    const kind = universe.mode === "agent" ? "screen" : universe.mode;
    const id = universe[`${universe.mode}_id`];
    if (isSnapshotSubjectKind(kind) && isUuid(id)) return [{ kind, id }];
  }
  return [];
}

function normalizeSubjectRefs(
  refs: ReadonlyArray<unknown>,
  fallbackId: string,
): ReadonlyArray<SnapshotSubjectRef> {
  const normalized = refs.filter(isSnapshotSubjectRef);
  if (normalized.length > 0) return normalized;
  return [{ kind: "screen", id: fallbackId }];
}

function maxBlockAsOf(blocks: ReadonlyArray<Record<string, unknown>>): string | null {
  const values = blocks
    .map((block) => block.as_of)
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .sort();
  return values.at(-1) ?? null;
}

function isSnapshotSubjectRef(value: unknown): value is SnapshotSubjectRef {
  if (!isJsonObject(value)) return false;
  return isSnapshotSubjectKind(value.kind) && typeof value.id === "string" && isUuid(value.id);
}

function isSnapshotSubjectKind(value: unknown): value is SnapshotSubjectRef["kind"] {
  return value === "issuer" ||
    value === "instrument" ||
    value === "listing" ||
    value === "theme" ||
    value === "macro_topic" ||
    value === "portfolio" ||
    value === "screen";
}

function isUuid(value: string): boolean {
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(value);
}

function isJsonObject(value: unknown): value is Record<string, JsonValue> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
