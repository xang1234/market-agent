import assert from "node:assert/strict";
import test from "node:test";

import {
  shareArtifactToChat,
  type ShareableArtifactBlock,
  type ShareableArtifactSource,
} from "../src/share-to-chat.ts";
import { FactEgressEntitlementError } from "../../evidence/src/fact-repo.ts";
import type { QueryExecutor } from "../../evidence/src/types.ts";

const ANALYZE_SNAPSHOT = "11111111-1111-4111-8111-111111111111";
const FINDING_SNAPSHOT = "22222222-2222-4222-8222-222222222222";
const FACT_ID = "33333333-3333-4333-8333-333333333333";
const PERF_BLOCK_ID = "block-perf-001";
const RICH_BLOCK_ID = "block-rich-001";
const SOURCE_ID = "44444444-4444-4444-8444-444444444444";
const SUBJECT_ID = "55555555-5555-4555-8555-555555555555";
const METRIC_ID = "66666666-6666-4666-8666-666666666666";

type Query = { text: string; values?: unknown[] };

class FakeEgressDb implements QueryExecutor {
  readonly queries: Query[] = [];
  private readonly allowedFactIds: ReadonlySet<string>;

  constructor(allowedFactIds: ReadonlySet<string> = new Set([FACT_ID])) {
    this.allowedFactIds = allowedFactIds;
  }

  async query<R extends Record<string, unknown> = Record<string, unknown>>(text: string, values?: unknown[]) {
    this.queries.push({ text, values });

    if (/from facts/i.test(text) && /entitlement_channels \? \$2/i.test(text)) {
      const factIds = Array.isArray(values?.[0]) ? values[0] as string[] : [];
      const rows = factIds
        .filter((factId) => this.allowedFactIds.has(factId))
        .map((factId) => factRow({ fact_id: factId, entitlement_channels: ["app", values?.[1]] }));
      return { rows, rowCount: rows.length } as never;
    }

    return { rows: [], rowCount: 0 } as never;
  }
}

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

async function share(input: ShareToChatInputWithoutEgress, db = new FakeEgressDb()) {
  return shareArtifactToChat({
    ...input,
    egress: { db },
  });
}

type ShareToChatInputWithoutEgress = {
  sources: ReadonlyArray<ShareableArtifactSource>;
};

function factRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    fact_id: FACT_ID,
    subject_kind: "issuer",
    subject_id: SUBJECT_ID,
    metric_id: METRIC_ID,
    period_kind: "point",
    period_start: null,
    period_end: null,
    fiscal_year: null,
    fiscal_period: null,
    value_num: "1",
    value_text: null,
    unit: "usd",
    currency: "USD",
    scale: "1",
    as_of: "2026-05-05T00:00:00.000Z",
    reported_at: null,
    observed_at: "2026-05-05T00:00:00.000Z",
    source_id: SOURCE_ID,
    method: "reported",
    adjustment_basis: null,
    definition_version: 1,
    verification_status: "authoritative",
    freshness_class: "filing_time",
    coverage_level: "full",
    quality_flags: [],
    entitlement_channels: ["app", "export"],
    confidence: "1",
    supersedes: null,
    superseded_by: null,
    invalidated_at: null,
    ingestion_batch_id: null,
    created_at: "2026-05-05T00:00:00.000Z",
    updated_at: "2026-05-05T00:00:00.000Z",
    ...overrides,
  };
}

test("shareArtifactToChat reads fact refs through the export entitlement gate", async () => {
  const db = new FakeEgressDb();

  const result = await share({
    sources: [
      memoSource([
        block({
          id: PERF_BLOCK_ID,
          snapshot_id: ANALYZE_SNAPSHOT,
          fact_refs: [FACT_ID] as never,
        }),
      ]),
    ],
  }, db);

  assert.equal(result.ok, true);
  assert.equal(db.queries.length, 1);
  assert.match(db.queries[0].text, /entitlement_channels \? \$2/);
  assert.deepEqual(db.queries[0].values, [[FACT_ID], "export"]);
});

test("shareArtifactToChat blocks app-only fact refs from export egress", async () => {
  const db = new FakeEgressDb(new Set());

  await assert.rejects(
    () => share({
      sources: [
        memoSource([
          block({
            id: PERF_BLOCK_ID,
            snapshot_id: ANALYZE_SNAPSHOT,
            fact_refs: [FACT_ID] as never,
          }),
        ]),
      ],
    }, db),
    (error) =>
      error instanceof FactEgressEntitlementError &&
      error.channel === "export" &&
      error.denied_fact_ids.includes(FACT_ID),
  );

  assert.match(db.queries[0].text, /entitlement_channels \? \$2/);
  assert.deepEqual(db.queries[0].values, [[FACT_ID], "export"]);
});

test("shareArtifactToChat does not allow callers to downgrade share egress to app channel", async () => {
  const db = new FakeEgressDb();

  const result = await shareArtifactToChat({
    sources: [
      memoSource([
        block({
          id: PERF_BLOCK_ID,
          snapshot_id: ANALYZE_SNAPSHOT,
          fact_refs: [FACT_ID] as never,
        }),
      ]),
    ],
    egress: { db, channel: "app" },
  } as never);

  assert.equal(result.ok, true);
  assert.deepEqual(db.queries[0].values, [[FACT_ID], "export"]);
});

test("shareArtifactToChat strips watchlist and held badge state from shared blocks", async () => {
  const result = await share({
    sources: [
      memoSource([
        block({
          id: PERF_BLOCK_ID,
          snapshot_id: ANALYZE_SNAPSHOT,
          subject_ref: { kind: "listing", id: SUBJECT_ID },
          watchlist_state: "watchlisted",
          watchlisted: true,
          held: true,
          held_state: "open",
          headline: "Revenue beat",
        } as never),
      ]),
    ],
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.blocks[0].headline, "Revenue beat");
  assert.deepEqual(result.blocks[0].subject_ref, { kind: "listing", id: SUBJECT_ID });
  assert.equal("watchlist_state" in result.blocks[0], false);
  assert.equal("watchlisted" in result.blocks[0], false);
  assert.equal("held" in result.blocks[0], false);
  assert.equal("held_state" in result.blocks[0], false);
});

test("shareArtifactToChat strips portfolio contribution quantities from shared blocks", async () => {
  const result = await share({
    sources: [
      memoSource([
        block({
          id: PERF_BLOCK_ID,
          snapshot_id: ANALYZE_SNAPSHOT,
          rows: [
            {
              subject_ref: { kind: "listing", id: SUBJECT_ID },
              display_name: "Apple",
              portfolio_contributions: [
                {
                  portfolio_id: "77777777-7777-4777-8777-777777777777",
                  portfolio_name: "Core",
                  base_currency: "USD",
                  quantity: 100,
                  cost_basis: 17500,
                  held_state: "open",
                  opened_at: "2026-01-01T00:00:00.000Z",
                  closed_at: null,
                },
              ],
            },
          ],
        } as never),
      ]),
    ],
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  const row = (result.blocks[0].rows as Array<Record<string, unknown>>)[0];
  assert.equal(row.display_name, "Apple");
  assert.equal("portfolio_contributions" in row, false);
  assert.equal(JSON.stringify(result.blocks[0]).includes("17500"), false);
  assert.equal(JSON.stringify(result.blocks[0]).includes("77777777-7777-4777-8777-777777777777"), false);
});

test("shareArtifactToChat preserves the origin snapshot_id on every block (invariant I5)", async () => {
  const result = await share({
    sources: [memoSource([block({ id: PERF_BLOCK_ID, snapshot_id: ANALYZE_SNAPSHOT })])],
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.blocks.length, 1);
  assert.equal(result.blocks[0].snapshot_id, ANALYZE_SNAPSHOT);
  assert.deepEqual(result.origin_snapshot_ids, [ANALYZE_SNAPSHOT]);
});

test("shareArtifactToChat keeps each source's origin snapshot intact when sharing from multiple sources", async () => {
  // Two artifacts from two different snapshots — each block must carry its
  // own origin id, not be collapsed to a single shared snapshot. Order
  // follows source order: the dedupe contract is "first appearance wins".
  const result = await share({
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
  assert.deepEqual(result.origin_snapshot_ids, [ANALYZE_SNAPSHOT, FINDING_SNAPSHOT]);
});

test("shareArtifactToChat dedupes origin_snapshot_ids in source order when the same snapshot appears twice", async () => {
  // Two memo references to the same snapshot — the snapshot id appears once,
  // and ordering is stable on first appearance. Lock the contract so a
  // future implementation switch (e.g. to a sorted set) is intentional.
  const result = await share({
    sources: [
      Object.freeze({
        source_kind: "finding",
        origin_snapshot_id: FINDING_SNAPSHOT,
        blocks: [block({ id: RICH_BLOCK_ID, kind: "finding_card", snapshot_id: FINDING_SNAPSHOT })],
      }),
      memoSource([block({ id: PERF_BLOCK_ID, snapshot_id: ANALYZE_SNAPSHOT })]),
      memoSource([block({ id: `${PERF_BLOCK_ID}-2`, snapshot_id: ANALYZE_SNAPSHOT })]),
    ],
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.origin_snapshot_ids, [FINDING_SNAPSHOT, ANALYZE_SNAPSHOT]);
});

test("shareArtifactToChat rejects when a block's snapshot_id disagrees with its source", async () => {
  // Cross-source contamination would silently misroute transforms. Reject.
  const result = await share({
    sources: [memoSource([block({ id: PERF_BLOCK_ID, snapshot_id: FINDING_SNAPSHOT })])],
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.rejections[0].reason, "origin_snapshot_mismatch");
  assert.equal(result.rejections[0].source_index, 0);
  assert.equal(result.rejections[0].block_index, 0);
});

test("shareArtifactToChat rejects an empty source (a source with no blocks) with empty_source", async () => {
  // empty_share is reserved for the top-level "no sources at all" case;
  // empty_source distinguishes the per-source case so a caller can tell
  // which source failed without crawling source_index.
  const result = await share({
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

test("shareArtifactToChat rejects a block that is missing snapshot_id", async () => {
  const malformed = Object.freeze({
    id: PERF_BLOCK_ID,
    kind: "perf_comparison",
    data_ref: Object.freeze({ kind: "x", id: "y" }),
    source_refs: Object.freeze([]),
    as_of: "2026-04-29T00:00:00.000Z",
    // snapshot_id intentionally absent
  }) as unknown as ShareableArtifactBlock;
  const result = await share({ sources: [memoSource([malformed])] });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.rejections[0].reason, "invalid_block_shape");
});

test("shareArtifactToChat rejects an empty share with empty_share", async () => {
  const result = await share({ sources: [] });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.rejections[0].reason, "empty_share");
});

test("shareArtifactToChat rejects a source with a missing origin_snapshot_id", async () => {
  const result = await share({
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

test("shareArtifactToChat deep-freezes output blocks so consumers cannot mutate the handoff payload", async () => {
  // Shallow freeze would leave nested arrays (source_refs) and objects
  // (data_ref.params) mutable, defeating the immutability promise.
  const result = await share({
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

test("shareArtifactToChat returns a defensive copy — mutating the source after handoff does not affect the output", async () => {
  // structuredClone semantics: source can't poison the handoff payload.
  const mutableBlock = {
    id: PERF_BLOCK_ID,
    kind: "perf_comparison",
    snapshot_id: ANALYZE_SNAPSHOT,
    data_ref: { kind: "snapshot.transform", id: "x" },
    source_refs: ["src-a"],
    as_of: "2026-04-29T00:00:00.000Z",
  } as unknown as ShareableArtifactBlock;
  const result = await share({
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

test("shareArtifactToChat converts a structuredClone failure (unsupported value) into invalid_block_shape rather than throwing", async () => {
  // structuredClone throws DOMException on functions/symbols. The result
  // contract promises rejections, not unhandled exceptions — wrap and
  // convert.
  const blockWithFunction = {
    id: PERF_BLOCK_ID,
    kind: "perf_comparison",
    snapshot_id: ANALYZE_SNAPSHOT,
    data_ref: { kind: "x", id: "y" },
    source_refs: [],
    as_of: "2026-04-29T00:00:00.000Z",
    bad_field: () => "definitely not JSON",
  } as unknown as ShareableArtifactBlock;
  const result = await share({
    sources: [
      Object.freeze({
        source_kind: "memo",
        origin_snapshot_id: ANALYZE_SNAPSHOT,
        blocks: [blockWithFunction],
      }),
    ],
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.rejections[0].reason, "invalid_block_shape");
});

test("shareArtifactToChat converts a cyclic nested object into invalid_block_shape rather than recursing forever", async () => {
  // structuredClone preserves cycles, but a deepFreeze without a visited-set
  // would recurse forever. The visited-set throws on cycles; the caller's
  // try/catch turns that into a normal rejection.
  const cyclic: Record<string, unknown> = {
    id: PERF_BLOCK_ID,
    kind: "perf_comparison",
    snapshot_id: ANALYZE_SNAPSHOT,
    data_ref: { kind: "x", id: "y" },
    source_refs: [],
    as_of: "2026-04-29T00:00:00.000Z",
  };
  cyclic.self = cyclic;
  const result = await share({
    sources: [
      Object.freeze({
        source_kind: "memo",
        origin_snapshot_id: ANALYZE_SNAPSHOT,
        blocks: [cyclic as unknown as ShareableArtifactBlock],
      }),
    ],
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.rejections[0].reason, "invalid_block_shape");
});

test("shareArtifactToChat collects all rejections rather than failing on the first", async () => {
  const result = await share({
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
