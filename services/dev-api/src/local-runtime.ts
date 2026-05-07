import { randomUUID } from "node:crypto";

import { Pool } from "pg";

import { createLocalRuntimeEvidence, type LocalRuntimeEvidence } from "../../evidence/src/index.ts";
import { hashJsonValue, toolCallArgsDigest } from "../../observability/src/tool-call.ts";
import type { JsonValue } from "../../observability/src/types.ts";
import { serializeJsonValue } from "../../observability/src/types.ts";
import { writeRunActivity } from "../../observability/src/run-activity.ts";
import { generateFinding, type FindingRow } from "../../agents/src/finding-generator.ts";
import type { SnapshotManifestDraft, SnapshotSubjectRef, ToolCallManifestContribution } from "../../snapshot/src/manifest-staging.ts";
import { STAGED_SNAPSHOT_MANIFEST, stageSnapshotManifest } from "../../snapshot/src/manifest-staging.ts";
import { sealSnapshotWithPool } from "../../snapshot/src/snapshot-sealer.ts";
import type {
  DevApiAgentLoopStageFactory,
  DevApiAnalyzeWorkflowInput,
  DevApiAnalyzeWorkflowResult,
  DevApiServiceAdapterDeps,
} from "./http.ts";

let localPool: Pool | null = null;
const analyzeEvidenceBySnapshot = new Map<string, LocalRuntimeEvidence & {
  readonly tool_call_id: string;
  readonly tool_result: JsonValue;
  readonly tool_contribution: ToolCallManifestContribution;
}>();

export async function runAnalyzeWorkflow(
  input: DevApiAnalyzeWorkflowInput,
): Promise<DevApiAnalyzeWorkflowResult> {
  const asOf = new Date().toISOString();
  const subjectRefs = normalizeSubjectRefs(input.subjectRefs, input.snapshotId);
  const evidence = await createLocalRuntimeEvidence(pool(), {
    provider: "dev-api-local-analyze",
    title: `Analyze memo: ${input.template.name}`,
    summary: analyzeMemoText(input),
    predicate: "analyze.memo.generated",
    subject_refs: subjectRefs,
    as_of: asOf,
    user_id: input.userId,
  });
  const toolCallId = randomUUID();
  const toolContribution = {
    tool_call_id: toolCallId,
    subject_refs: subjectRefs,
    claim_refs: evidence.claim_refs,
    document_refs: evidence.document_refs,
    source_ids: evidence.source_ids,
  } satisfies ToolCallManifestContribution;
  const toolResult = {
    kind: "local_analyze_workflow_result",
    template_id: input.template.template_id,
    bundle_ids: [...input.bundleIds],
    manifest_contribution: {
      subject_refs: subjectRefs,
      claim_refs: evidence.claim_refs,
      document_refs: evidence.document_refs,
      source_ids: evidence.source_ids,
    },
  } satisfies JsonValue;
  await writeLocalToolCallLog({
    toolCallId,
    toolName: "local_analyze_workflow",
    args: {
      template_id: input.template.template_id,
      source_categories: [...input.sourceCategories],
      bundle_ids: [...input.bundleIds],
      subject_refs: subjectRefs,
    },
    result: toolResult,
  });
  analyzeEvidenceBySnapshot.set(input.snapshotId, {
    ...evidence,
    tool_call_id: toolCallId,
    tool_result: toolResult,
    tool_contribution: {
      ...toolContribution,
      result: toolResult,
    },
  });
  return {
    blocks: [
      {
        id: randomUUID(),
        kind: "rich_text",
        snapshot_id: input.snapshotId,
        data_ref: { kind: "rich_text", id: `analyze:${input.template.template_id}` },
        source_refs: evidence.source_ids,
        claim_refs: evidence.claim_refs,
        document_refs: evidence.document_refs,
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
  const evidence = analyzeEvidenceBySnapshot.get(snapshotId);
  try {
    return await sealSnapshotWithPool(pool(), {
      snapshot_id: snapshotId,
      manifest: evidence
        ? stageSnapshotManifest({
          subject_refs: subjectRefs,
          as_of: asOf,
          basis: "unadjusted",
          normalization: "raw",
          allowed_transforms: {},
          model_version: "dev-api-local-runtime",
          tool_calls: [evidence.tool_contribution],
        })
        : manifestFromBlockRefs({
          subjectRefs,
          asOf,
          modelVersion: "dev-api-local-runtime",
          blocks,
        }),
      blocks: blocks as never,
      sources: evidence?.verifier_sources ?? [],
      documents: evidence?.verifier_documents ?? [],
      claims: evidence?.verifier_claims ?? [],
    });
  } finally {
    analyzeEvidenceBySnapshot.delete(snapshotId);
  }
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

async function writeLocalToolCallLog(input: {
  toolCallId: string;
  threadId?: string | null;
  toolName: string;
  args: JsonValue;
  result: JsonValue;
}): Promise<void> {
  await pool().query(
    `insert into tool_call_logs
       (tool_call_id, thread_id, tool_name, args, result_hash, duration_ms, status, error_code)
     values ($1::uuid, $2::uuid, $3, $4::jsonb, $5, $6, $7, $8)
     on conflict (tool_call_id) do update
        set result_hash = excluded.result_hash,
            status = excluded.status,
            error_code = excluded.error_code`,
    [
      input.toolCallId,
      input.threadId ?? null,
      input.toolName,
      serializeJsonValue(toolCallArgsDigest(input.args)),
      hashJsonValue(input.result),
      0,
      "ok",
      null,
    ],
  );
}

function manifestFromBlockRefs(input: {
  subjectRefs: ReadonlyArray<SnapshotSubjectRef>;
  asOf: string;
  modelVersion: string;
  blocks: ReadonlyArray<Record<string, unknown>>;
}): SnapshotManifestDraft {
  return Object.freeze({
    [STAGED_SNAPSHOT_MANIFEST]: true,
    subject_refs: Object.freeze([...input.subjectRefs]),
    fact_refs: Object.freeze([]),
    claim_refs: Object.freeze(uuidRefsFromBlocks(input.blocks, "claim_refs")),
    event_refs: Object.freeze(uuidRefsFromBlocks(input.blocks, "event_refs")),
    document_refs: Object.freeze(uuidRefsFromBlocks(input.blocks, "document_refs")),
    series_specs: Object.freeze([]),
    source_ids: Object.freeze(uuidRefsFromBlocks(input.blocks, "source_refs")),
    tool_call_ids: Object.freeze([]),
    tool_call_result_hashes: Object.freeze([]),
    as_of: input.asOf,
    basis: "unadjusted",
    normalization: "raw",
    coverage_start: null,
    allowed_transforms: Object.freeze({}),
    model_version: input.modelVersion,
    parent_snapshot: null,
  });
}

function uuidRefsFromBlocks(
  blocks: ReadonlyArray<Record<string, unknown>>,
  key: string,
): string[] {
  const seen = new Set<string>();
  const refs: string[] = [];
  for (const block of blocks) {
    const values = block[key];
    if (!Array.isArray(values)) continue;
    for (const value of values) {
      if (typeof value !== "string" || !isUuid(value) || seen.has(value)) continue;
      seen.add(value);
      refs.push(value);
    }
  }
  return refs;
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
