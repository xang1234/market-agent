import { Pool } from "pg";

import type { JsonValue } from "../../observability/src/types.ts";
import type { SnapshotSubjectRef } from "../../snapshot/src/manifest-staging.ts";
import { stageSnapshotManifest } from "../../snapshot/src/manifest-staging.ts";
import { sealSnapshotWithPool } from "../../snapshot/src/snapshot-sealer.ts";
import {
  createRegistryBackedAnalystToolRuntime,
  type ChatAnalystToolRuntime,
  type ChatAnalystToolRuntimeResult,
  type ChatAssistantMessagePersistence,
  type ChatAssistantMessagePersistenceInput,
} from "./coordinator.ts";
import { createChatMessagePersistence } from "./messages.ts";

let localPool: Pool | null = null;

const registryRuntime = createRegistryBackedAnalystToolRuntime({
  executeTool: async ({ toolName, arguments: args }) => ({
    kind: "local_tool_result",
    status: "ok",
    tool_name: toolName,
    arguments: args,
  }),
});

export const analystToolRuntime: ChatAnalystToolRuntime = async (context) => {
  const result = await registryRuntime(context);
  const asOf = new Date().toISOString();
  const subjectRefs = context.subjectPreResolution?.status === "resolved"
    ? [context.subjectPreResolution.subject_ref]
    : [{ kind: "screen" as const, id: context.threadId }];
  return {
    ...result,
    blocks: result.blocks.map((block) =>
      normalizeAssistantBlock(block, {
        snapshotId: result.snapshot_id,
        asOf,
        subjectRefs,
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
  return sealSnapshotWithPool(pool(), {
    snapshot_id: snapshotId,
    thread_id: input.threadId,
    manifest: stageSnapshotManifest({
      subject_refs: subjectRefsFromBlocks(blocks, input.threadId),
      as_of: asOf,
      basis: "reported",
      normalization: "raw",
      allowed_transforms: {},
      model_version: "chat-local-runtime",
      tool_calls: [],
    }),
    blocks: blocks as never,
    sources: [],
    documents: [],
  });
}

function normalizeAssistantBlock(
  block: Record<string, unknown>,
  input: {
    snapshotId: string;
    asOf: string;
    subjectRefs: ReadonlyArray<SnapshotSubjectRef>;
  },
): Record<string, unknown> {
  const kind = typeof block.kind === "string" && block.kind.length > 0 ? block.kind : "rich_text";
  return {
    ...block,
    kind,
    snapshot_id: input.snapshotId,
    data_ref: { kind, id: String(block.id ?? input.snapshotId) },
    source_refs: Array.isArray(block.source_refs) ? block.source_refs : [],
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
