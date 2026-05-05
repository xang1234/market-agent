import type { JsonObject, JsonValue } from "../../observability/src/types.ts";
import { listFactsForEgress } from "../../evidence/src/fact-repo.ts";
import type { QueryExecutor } from "../../evidence/src/types.ts";

export type ShareableArtifactBlock = JsonObject & {
  id: string;
  kind: string;
  snapshot_id: string;
};

export const SHAREABLE_ARTIFACT_SOURCE_KINDS = ["memo", "finding", "block"] as const;
export type ShareableArtifactSourceKind = (typeof SHAREABLE_ARTIFACT_SOURCE_KINDS)[number];

// source_kind is currently a caller-side discriminator only — the handoff
// itself just copies blocks. P6.4 (export & share policy) will read it to
// route per-kind entitlement filters; until then, validation only enforces
// it's one of the legal values via the union.
export type ShareableArtifactSource = {
  source_kind: ShareableArtifactSourceKind;
  origin_snapshot_id: string;
  blocks: ReadonlyArray<ShareableArtifactBlock>;
};

export type ShareToChatInput = {
  sources: ReadonlyArray<ShareableArtifactSource>;
  egress: {
    db: QueryExecutor;
  };
};

export type ShareToChatRejectionReason =
  | "missing_snapshot_id"
  | "origin_snapshot_mismatch"
  | "empty_share"
  | "empty_source"
  | "invalid_block_shape";

export type ShareToChatRejection = {
  reason: ShareToChatRejectionReason;
  source_index: number;
  block_index?: number;
};

export type ShareToChatResult =
  | {
      ok: true;
      blocks: ReadonlyArray<ShareableArtifactBlock>;
      origin_snapshot_ids: ReadonlyArray<string>;
    }
  | {
      ok: false;
      rejections: ReadonlyArray<ShareToChatRejection>;
    };

// Handoff is a copy: each block keeps its origin snapshot_id so transforms
// route to the same sealed manifest (invariant I5). The chat row's own
// snapshot_id stays distinct — adding an artifact does NOT advance the
// thread's latest snapshot. That second contract is enforced at the chat
// persistence layer (services/chat/src/messages.ts), not here; this function
// only produces the blocks payload, leaving the caller responsible for not
// advancing latest_snapshot_id when writing an add-only message.
export async function shareArtifactToChat(input: ShareToChatInput): Promise<ShareToChatResult> {
  if (input.sources.length === 0) {
    return Object.freeze({
      ok: false,
      rejections: Object.freeze([Object.freeze({ reason: "empty_share", source_index: 0 })]),
    });
  }

  const rejections: ShareToChatRejection[] = [];
  const blocks: ShareableArtifactBlock[] = [];

  input.sources.forEach((source, sourceIndex) => {
    if (!isNonEmptyString(source.origin_snapshot_id)) {
      rejections.push(reject("missing_snapshot_id", sourceIndex));
      return;
    }
    if (source.blocks.length === 0) {
      rejections.push(reject("empty_source", sourceIndex));
      return;
    }

    source.blocks.forEach((block, blockIndex) => {
      if (!isShareableBlock(block)) {
        rejections.push(reject("invalid_block_shape", sourceIndex, blockIndex));
        return;
      }
      if (block.snapshot_id !== source.origin_snapshot_id) {
        rejections.push(reject("origin_snapshot_mismatch", sourceIndex, blockIndex));
        return;
      }
      // isShareableBlock only checks the three top-level required strings.
      // Nested data may still violate the JsonObject contract (functions /
      // symbols make structuredClone throw a DOMException; cycles outside the
      // visited-set guard in deepFreezeJson would blow the stack). Convert
      // either failure mode into a rejection so the result type's promise
      // holds end-to-end.
      try {
        blocks.push(deepFreezeBlock(block));
      } catch {
        rejections.push(reject("invalid_block_shape", sourceIndex, blockIndex));
      }
    });
  });

  if (rejections.length > 0) {
    return Object.freeze({ ok: false, rejections: Object.freeze(rejections) });
  }

  await listFactsForEgress(input.egress.db, {
    fact_ids: factIdsForEgress(blocks),
    channel: "export",
  });

  // Dedupe in source order — callers can rely on the first appearance of a
  // snapshot id determining its position in the result.
  const originSnapshotIds = Object.freeze([
    ...new Set(input.sources.map((source) => source.origin_snapshot_id)),
  ]);

  return Object.freeze({
    ok: true,
    blocks: Object.freeze(blocks),
    origin_snapshot_ids: originSnapshotIds,
  });
}

function reject(
  reason: ShareToChatRejectionReason,
  source_index: number,
  block_index?: number,
): ShareToChatRejection {
  return Object.freeze(
    block_index === undefined ? { reason, source_index } : { reason, source_index, block_index },
  );
}

function isShareableBlock(value: unknown): value is ShareableArtifactBlock {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const obj = value as JsonObject;
  return (
    isNonEmptyString(obj.id) &&
    isNonEmptyString(obj.kind) &&
    isNonEmptyString(obj.snapshot_id)
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function factIdsForEgress(blocks: ReadonlyArray<ShareableArtifactBlock>): ReadonlyArray<string> {
  const factIds = new Set<string>();
  for (const block of blocks) {
    collectFactIds(block, factIds);
  }
  return Object.freeze([...factIds]);
}

function collectFactIds(value: unknown, factIds: Set<string>): void {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item) => collectFactIds(item, factIds));
    return;
  }

  const obj = value as Record<string, unknown>;
  if (obj.ref_kind === "fact" && isNonEmptyString(obj.ref_id)) {
    factIds.add(obj.ref_id);
  }
  if (isNonEmptyString(obj.fact_id)) {
    factIds.add(obj.fact_id);
  }
  if (Array.isArray(obj.fact_refs)) {
    obj.fact_refs.forEach((factId) => {
      if (isNonEmptyString(factId)) factIds.add(factId);
    });
  }
  Object.values(obj).forEach((item) => collectFactIds(item, factIds));
}

// Deep-clone + recursively freeze so the returned block can't be mutated
// through the source artifact's reference. Shallow Object.freeze leaves
// nested arrays (e.g. source_refs) and objects (e.g. data_ref.params)
// mutable, defeating the immutability the handoff promises consumers.
//
// Throws on inputs that violate the JsonObject contract (unsupported value
// types, cycles deeper than the visited-set guard) — the caller wraps this
// in try/catch so the failure becomes invalid_block_shape rather than an
// unhandled exception.
function deepFreezeBlock(block: ShareableArtifactBlock): ShareableArtifactBlock {
  return deepFreezeJson(structuredClone(block), new WeakSet()) as ShareableArtifactBlock;
}

function deepFreezeJson<T extends JsonValue>(value: T, visited: WeakSet<object>): T {
  if (value === null || typeof value !== "object") return value;
  if (visited.has(value)) {
    throw new Error("deepFreezeJson: cyclic reference is not a valid JsonValue");
  }
  visited.add(value);
  if (Array.isArray(value)) {
    value.forEach((item) => deepFreezeJson(item, visited));
  } else {
    Object.values(value as JsonObject).forEach((item) => deepFreezeJson(item, visited));
  }
  return Object.freeze(value);
}
