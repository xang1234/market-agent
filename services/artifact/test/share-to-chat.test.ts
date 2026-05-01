import assert from "node:assert/strict";
import test from "node:test";

import {
  shareArtifactToChat,
  type ShareableArtifactBlock,
  type ShareableArtifactSource,
} from "../src/share-to-chat.ts";

const ANALYZE_SNAPSHOT = "11111111-1111-4111-8111-111111111111";
const FINDING_SNAPSHOT = "22222222-2222-4222-8222-222222222222";
const PERF_BLOCK_ID = "block-perf-001";
const RICH_BLOCK_ID = "block-rich-001";

function block(overrides: Partial<ShareableArtifactBlock> & { snapshot_id: string; id: string }): ShareableArtifactBlock {
  return Object.freeze({
    id: overrides.id,
    kind: overrides.kind ?? "perf_comparison",
    snapshot_id: overrides.snapshot_id,
    data_ref: overrides.data_ref ?? Object.freeze({ kind: "snapshot.transform", id: "x" }),
    source_refs: overrides.source_refs ?? Object.freeze([]),
    as_of: overrides.as_of ?? "2026-04-29T00:00:00.000Z",
    ...overrides,
  }) as ShareableArtifactBlock;
}

function memoSource(blocks: ReadonlyArray<ShareableArtifactBlock>): ShareableArtifactSource {
  return Object.freeze({
    source_kind: "memo",
    origin_snapshot_id: ANALYZE_SNAPSHOT,
    blocks,
  });
}

test("shareArtifactToChat preserves the origin snapshot_id on every block (invariant I5)", () => {
  const result = shareArtifactToChat({
    sources: [memoSource([block({ id: PERF_BLOCK_ID, snapshot_id: ANALYZE_SNAPSHOT })])],
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.blocks.length, 1);
  assert.equal(result.blocks[0].snapshot_id, ANALYZE_SNAPSHOT);
  assert.deepEqual(result.origin_snapshot_ids, [ANALYZE_SNAPSHOT]);
});

test("shareArtifactToChat keeps each source's origin snapshot intact when sharing from multiple sources", () => {
  // Two artifacts from two different snapshots — each block must carry its
  // own origin id, not be collapsed to a single shared snapshot.
  const result = shareArtifactToChat({
    sources: [
      memoSource([block({ id: PERF_BLOCK_ID, snapshot_id: ANALYZE_SNAPSHOT })]),
      Object.freeze({
        source_kind: "finding",
        origin_snapshot_id: FINDING_SNAPSHOT,
        blocks: [block({ id: RICH_BLOCK_ID, kind: "finding_card", snapshot_id: FINDING_SNAPSHOT })],
      }),
    ],
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.blocks[0].snapshot_id, ANALYZE_SNAPSHOT);
  assert.equal(result.blocks[1].snapshot_id, FINDING_SNAPSHOT);
  assert.deepEqual([...result.origin_snapshot_ids].sort(), [ANALYZE_SNAPSHOT, FINDING_SNAPSHOT].sort());
});

test("shareArtifactToChat rejects when a block's snapshot_id disagrees with its source", () => {
  // Cross-source contamination would silently misroute transforms. Reject.
  const result = shareArtifactToChat({
    sources: [memoSource([block({ id: PERF_BLOCK_ID, snapshot_id: FINDING_SNAPSHOT })])],
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.rejections[0].reason, "origin_snapshot_mismatch");
  assert.equal(result.rejections[0].source_index, 0);
  assert.equal(result.rejections[0].block_index, 0);
});

test("shareArtifactToChat rejects an empty source (a source with no blocks) with empty_source", () => {
  // empty_share is reserved for the top-level "no sources at all" case;
  // empty_source distinguishes the per-source case so a caller can tell
  // which source failed without crawling source_index.
  const result = shareArtifactToChat({
    sources: [
      Object.freeze({
        source_kind: "memo",
        origin_snapshot_id: ANALYZE_SNAPSHOT,
        blocks: [],
      }),
    ],
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.rejections[0].reason, "empty_source");
  assert.equal(result.rejections[0].source_index, 0);
  assert.equal(result.rejections[0].block_index, undefined);
});

test("shareArtifactToChat rejects a block that is missing snapshot_id", () => {
  const malformed = Object.freeze({
    id: PERF_BLOCK_ID,
    kind: "perf_comparison",
    data_ref: Object.freeze({ kind: "x", id: "y" }),
    source_refs: Object.freeze([]),
    as_of: "2026-04-29T00:00:00.000Z",
    // snapshot_id intentionally absent
  }) as unknown as ShareableArtifactBlock;
  const result = shareArtifactToChat({ sources: [memoSource([malformed])] });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.rejections[0].reason, "invalid_block_shape");
});

test("shareArtifactToChat rejects an empty share with empty_share", () => {
  const result = shareArtifactToChat({ sources: [] });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.rejections[0].reason, "empty_share");
});

test("shareArtifactToChat rejects a source with a missing origin_snapshot_id", () => {
  const result = shareArtifactToChat({
    sources: [
      Object.freeze({
        source_kind: "memo",
        origin_snapshot_id: "",
        blocks: [block({ id: PERF_BLOCK_ID, snapshot_id: ANALYZE_SNAPSHOT })],
      }),
    ],
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.rejections[0].reason, "missing_snapshot_id");
});

test("shareArtifactToChat deep-freezes output blocks so consumers cannot mutate the handoff payload", () => {
  // Shallow freeze would leave nested arrays (source_refs) and objects
  // (data_ref.params) mutable, defeating the immutability promise.
  const result = shareArtifactToChat({
    sources: [
      memoSource([
        block({
          id: PERF_BLOCK_ID,
          snapshot_id: ANALYZE_SNAPSHOT,
          data_ref: { kind: "snapshot.transform", id: "x", params: { range: "1y" } } as never,
          source_refs: ["src-a", "src-b"] as never,
        }),
      ]),
    ],
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(Object.isFrozen(result.blocks), true);
  assert.equal(Object.isFrozen(result.blocks[0]), true);
  assert.equal(Object.isFrozen(result.blocks[0].data_ref), true);
  assert.equal(Object.isFrozen((result.blocks[0].data_ref as Record<string, unknown>).params), true);
  assert.equal(Object.isFrozen(result.blocks[0].source_refs), true);
});

test("shareArtifactToChat returns a defensive copy — mutating the source after handoff does not affect the output", () => {
  // structuredClone semantics: source can't poison the handoff payload.
  const mutableBlock = {
    id: PERF_BLOCK_ID,
    kind: "perf_comparison",
    snapshot_id: ANALYZE_SNAPSHOT,
    data_ref: { kind: "snapshot.transform", id: "x" },
    source_refs: ["src-a"],
    as_of: "2026-04-29T00:00:00.000Z",
  } as unknown as ShareableArtifactBlock;
  const result = shareArtifactToChat({
    sources: [
      Object.freeze({
        source_kind: "memo",
        origin_snapshot_id: ANALYZE_SNAPSHOT,
        blocks: [mutableBlock],
      }),
    ],
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  // Mutate the source after the call. The handoff blocks must be unaffected.
  (mutableBlock as unknown as { kind: string }).kind = "tampered";
  assert.equal(result.blocks[0].kind, "perf_comparison");
});

test("shareArtifactToChat collects all rejections rather than failing on the first", () => {
  const result = shareArtifactToChat({
    sources: [
      memoSource([
        block({ id: PERF_BLOCK_ID, snapshot_id: FINDING_SNAPSHOT }),
        block({ id: RICH_BLOCK_ID, snapshot_id: FINDING_SNAPSHOT }),
      ]),
    ],
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.rejections.length, 2);
  assert.equal(result.rejections[0].block_index, 0);
  assert.equal(result.rejections[1].block_index, 1);
});
