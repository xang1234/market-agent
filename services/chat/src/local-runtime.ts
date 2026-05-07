import { Pool } from "pg";

import { createLocalRuntimeEvidence, type LocalRuntimeEvidence } from "../../evidence/src/index.ts";
import { hashJsonValue, toolCallArgsDigest } from "../../observability/src/tool-call.ts";
import { serializeJsonValue, type JsonValue } from "../../observability/src/types.ts";
import type { SnapshotSubjectRef, ToolCallManifestContribution } from "../../snapshot/src/manifest-staging.ts";
import { stageSnapshotManifest } from "../../snapshot/src/manifest-staging.ts";
import { sealSnapshotWithPool } from "../../snapshot/src/snapshot-sealer.ts";
import {
  createRegistryBackedAnalystToolRuntime,
  type ChatAnalystToolRuntime,
  type ChatAnalystToolRuntimeResult,
  type ChatAnalystToolRuntimeToolCall,
  type ChatAssistantMessagePersistence,
  type ChatAssistantMessagePersistenceInput,
} from "./coordinator.ts";
import { createChatMessagePersistence } from "./messages.ts";

let localPool: Pool | null = null;
const toolContributionsBySnapshot = new Map<string, ReadonlyArray<ToolCallManifestContribution>>();
const evidenceBySnapshot = new Map<string, ReadonlyArray<LocalRuntimeEvidence>>();

export const analystToolRuntime: ChatAnalystToolRuntime = async (context) => {
  const asOf = new Date().toISOString();
  const subjectRefs = context.subjectPreResolution?.status === "resolved"
    ? [context.subjectPreResolution.subject_ref]
    : [{ kind: "screen" as const, id: context.threadId }];
  const registryRuntime = createRegistryBackedAnalystToolRuntime({
    executeTool: async ({ toolName, arguments: args }) => {
      const evidence = await createLocalRuntimeEvidence(pool(), {
        provider: "chat-local-runtime",
        title: `Chat tool evidence: ${toolName}`,
        summary: localToolSummary({
          toolName,
          userIntent: context.userIntent,
          subjectRefs,
        }),
        predicate: `chat.tool.${toolName}`,
        subject_refs: subjectRefs,
        as_of: asOf,
      });
      return {
        kind: "local_evidence_tool_result",
        status: "ok",
        tool_name: toolName,
        arguments: args,
        manifest_contribution: {
          subject_refs: subjectRefs,
          claim_refs: evidence.claim_refs,
          document_refs: evidence.document_refs,
          source_ids: evidence.source_ids,
        },
        evidence,
      };
    },
  });
  const result = await registryRuntime(context);
  const evidence = evidenceForToolCalls(result.tool_calls);
  const toolContributions = manifestContributionsForToolCalls(result.tool_calls, subjectRefs);
  await writeLocalToolCallLogs(context.threadId, result.tool_calls);
  toolContributionsBySnapshot.set(result.snapshot_id, toolContributions);
  evidenceBySnapshot.set(result.snapshot_id, evidence);
  const defaultRefs = defaultEvidenceRefs(evidence);
  return {
    ...result,
    blocks: result.blocks.map((block) =>
      normalizeAssistantBlock(block, {
        snapshotId: result.snapshot_id,
        asOf,
        subjectRefs,
        defaultRefs,
      })
    ),
  } satisfies ChatAnalystToolRuntimeResult;
};

export const persistAssistantMessage: ChatAssistantMessagePersistence = async (message) =>
  createChatMessagePersistence({
    pool: pool(),
    sealSnapshot: sealAssistantMessageSnapshot,
  })(message);

async function sealAssistantMessageSnapshot(input: ChatAssistantMessagePersistenceInput) {
  const blocks = input.blocks as ReadonlyArray<Record<string, unknown>>;
  const snapshotId = snapshotIdFromBlocks(blocks);
  const asOf = maxBlockAsOf(blocks) ?? new Date().toISOString();
  const evidence = evidenceBySnapshot.get(snapshotId) ?? [];
  try {
    return await sealSnapshotWithPool(pool(), {
      snapshot_id: snapshotId,
      thread_id: input.threadId,
      manifest: stageSnapshotManifest({
        subject_refs: subjectRefsFromBlocks(blocks, input.threadId),
        as_of: asOf,
        basis: "unadjusted",
        normalization: "raw",
        allowed_transforms: {},
        model_version: "chat-local-runtime",
        tool_calls: toolContributionsBySnapshot.get(snapshotId) ?? [],
      }),
      blocks: blocks as never,
      sources: evidence.flatMap((item) => item.verifier_sources),
      documents: evidence.flatMap((item) => item.verifier_documents),
      claims: evidence.flatMap((item) => item.verifier_claims),
    });
  } finally {
    toolContributionsBySnapshot.delete(snapshotId);
    evidenceBySnapshot.delete(snapshotId);
  }
}

function manifestContributionsForToolCalls(
  toolCalls: ReadonlyArray<ChatAnalystToolRuntimeToolCall>,
  subjectRefs: ReadonlyArray<SnapshotSubjectRef>,
): ReadonlyArray<ToolCallManifestContribution> {
  return toolCalls
    .filter((toolCall) => toolCall.status === "ok" && isJsonObject(toolCall.result))
    .map((toolCall) => ({
      tool_call_id: toolCall.tool_call_id,
      result: toolCall.result as JsonValue,
      subject_refs: subjectRefs,
      ...manifestContributionFromResult(toolCall.result),
    }));
}

function manifestContributionFromResult(
  result: unknown,
): Omit<ToolCallManifestContribution, "tool_call_id" | "result"> {
  if (!isJsonObject(result) || !isJsonObject(result.manifest_contribution)) return {};
  const contribution = result.manifest_contribution;
  const staged: Omit<ToolCallManifestContribution, "tool_call_id" | "result"> = {};
  if (Array.isArray(contribution.subject_refs)) {
    staged.subject_refs = contribution.subject_refs.filter(isSnapshotSubjectRef);
  }
  const claimRefs = uuidArray(contribution.claim_refs);
  if (claimRefs !== undefined) staged.claim_refs = claimRefs;
  const documentRefs = uuidArray(contribution.document_refs);
  if (documentRefs !== undefined) staged.document_refs = documentRefs;
  const sourceIds = uuidArray(contribution.source_ids);
  if (sourceIds !== undefined) staged.source_ids = sourceIds;
  return staged;
}

function evidenceForToolCalls(
  toolCalls: ReadonlyArray<ChatAnalystToolRuntimeToolCall>,
): ReadonlyArray<LocalRuntimeEvidence> {
  return Object.freeze(
    toolCalls.flatMap((toolCall) => {
      if (toolCall.status !== "ok" || !isJsonObject(toolCall.result)) return [];
      return isLocalRuntimeEvidence(toolCall.result.evidence) ? [toolCall.result.evidence] : [];
    }),
  );
}

function defaultEvidenceRefs(evidence: ReadonlyArray<LocalRuntimeEvidence>): {
  source_refs: ReadonlyArray<string>;
  claim_refs: ReadonlyArray<string>;
  document_refs: ReadonlyArray<string>;
} {
  return {
    source_refs: firstSeen(evidence.flatMap((item) => item.source_ids)),
    claim_refs: firstSeen(evidence.flatMap((item) => item.claim_refs)),
    document_refs: firstSeen(evidence.flatMap((item) => item.document_refs)),
  };
}

async function writeLocalToolCallLogs(
  threadId: string,
  toolCalls: ReadonlyArray<ChatAnalystToolRuntimeToolCall>,
): Promise<void> {
  for (const toolCall of toolCalls) {
    if (toolCall.status !== "ok" || toolCall.result === undefined) continue;
    const args = (toolCall.arguments ?? {}) as JsonValue;
    const result = toolCall.result;
    await pool().query(
      `insert into tool_call_logs
         (tool_call_id, thread_id, tool_name, args, result_hash, duration_ms, status, error_code)
       values ($1::uuid, $2::uuid, $3, $4::jsonb, $5, $6, $7, $8)
       on conflict (tool_call_id) do update
          set result_hash = excluded.result_hash,
              status = excluded.status,
              error_code = excluded.error_code`,
      [
        toolCall.tool_call_id,
        threadId,
        toolCall.tool_name,
        serializeJsonValue(toolCallArgsDigest(args)),
        hashJsonValue(result),
        0,
        "ok",
        null,
      ],
    );
  }
}

function normalizeAssistantBlock(
  block: Record<string, unknown>,
  input: {
    snapshotId: string;
    asOf: string;
    subjectRefs: ReadonlyArray<SnapshotSubjectRef>;
    defaultRefs: {
      source_refs: ReadonlyArray<string>;
      claim_refs: ReadonlyArray<string>;
      document_refs: ReadonlyArray<string>;
    };
  },
): Record<string, unknown> {
  const kind = typeof block.kind === "string" && block.kind.length > 0 ? block.kind : "rich_text";
  return {
    ...block,
    kind,
    snapshot_id: input.snapshotId,
    data_ref: { kind, id: String(block.id ?? input.snapshotId) },
    source_refs: Array.isArray(block.source_refs) && block.source_refs.length > 0
      ? block.source_refs
      : input.defaultRefs.source_refs,
    claim_refs: Array.isArray(block.claim_refs) && block.claim_refs.length > 0
      ? block.claim_refs
      : input.defaultRefs.claim_refs,
    document_refs: Array.isArray(block.document_refs) && block.document_refs.length > 0
      ? block.document_refs
      : input.defaultRefs.document_refs,
    as_of: input.asOf,
    subject_refs: input.subjectRefs,
  };
}

function snapshotIdFromBlocks(blocks: ReadonlyArray<Record<string, unknown>>): string {
  const snapshotId = blocks.find((block) => typeof block.snapshot_id === "string")?.snapshot_id;
  if (typeof snapshotId !== "string" || !isUuid(snapshotId)) {
    throw new Error("assistant blocks must carry a UUID snapshot_id before sealing");
  }
  return snapshotId;
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
  if (refs.length > 0) return refs;
  return [{ kind: "screen", id: fallbackId }];
}

function maxBlockAsOf(blocks: ReadonlyArray<Record<string, unknown>>): string | null {
  const values = blocks
    .map((block) => block.as_of)
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .sort();
  return values.at(-1) ?? null;
}

function pool(): Pool {
  if (localPool) return localPool;
  const databaseUrl = process.env.CHAT_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for chat local runtime");
  }
  localPool = new Pool({ connectionString: databaseUrl });
  return localPool;
}

function localToolSummary(input: {
  toolName: string;
  userIntent: string | undefined;
  subjectRefs: ReadonlyArray<SnapshotSubjectRef>;
}): string {
  const intent = input.userIntent?.trim() || "Start a research thread";
  const subjects = input.subjectRefs.map((subject) => `${subject.kind}:${subject.id}`).join(", ");
  return `${intent}. ${input.toolName} read the local evidence plane for ${subjects} and returned structured provenance for a sealed chat response.`;
}

function uuidArray(value: unknown): ReadonlyArray<string> | undefined {
  if (!Array.isArray(value)) return undefined;
  const refs = firstSeen(value.filter((item): item is string => typeof item === "string" && isUuid(item)));
  return refs.length > 0 ? refs : undefined;
}

function firstSeen(values: ReadonlyArray<string>): ReadonlyArray<string> {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return Object.freeze(result);
}

function isLocalRuntimeEvidence(value: unknown): value is LocalRuntimeEvidence {
  if (!isJsonObject(value)) return false;
  return Array.isArray(value.source_ids) &&
    Array.isArray(value.document_refs) &&
    Array.isArray(value.claim_refs) &&
    Array.isArray(value.verifier_sources) &&
    Array.isArray(value.verifier_documents) &&
    Array.isArray(value.verifier_claims);
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
