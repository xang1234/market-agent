import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPeerComparisonSealInput,
  type PeerComparisonFactRow,
} from "../src/metrics-comparison-snapshot.ts";
import { buildMetricsComparisonBlock } from "../src/metrics-comparison-block-builder.ts";
import type { MaterializedPeer } from "../src/metrics-comparison-materializer.ts";
import { verifySnapshotSeal } from "../../snapshot/src/snapshot-verifier.ts";

const SNAP = "11111111-1111-4111-a111-111111111111";
const SRC = "aaaaaaaa-aaaa-4aaa-a000-0000000000ed";
const AAPL = { kind: "issuer", id: "22222222-2222-4222-a222-222222222222" } as const;
const MSFT = { kind: "issuer", id: "33333333-3333-4333-a333-333333333333" } as const;

const RV_A = "f0000000-0000-4000-8000-000000000001";
const GM_A = "f0000000-0000-4000-8000-000000000002";
const RV_M = "f0000000-0000-4000-8000-000000000003";
const GM_M = "f0000000-0000-4000-8000-000000000004";

function blockWith(peers: MaterializedPeer[]) {
  return buildMetricsComparisonBlock({
    peers,
    primary: AAPL,
    base: {
      id: "block-1",
      snapshot_id: SNAP,
      as_of: "2024-11-01T20:30:00.000Z",
      source_refs: [SRC],
    },
  });
}

function factRow(fact_id: string): PeerComparisonFactRow {
  return {
    fact_id,
    source_id: SRC,
    unit: "usd",
    period_kind: "fiscal_y",
    period_end: "2024-09-28",
    fiscal_year: 2024,
    fiscal_period: "FY",
  };
}

const TWO_PEERS: MaterializedPeer[] = [
  {
    subject: AAPL,
    metrics: [
      { metric: "revenue", value_ref: RV_A, value_num: 391_000_000_000, format: "currency" },
      { metric: "gross_margin", value_ref: GM_A, value_num: 0.46, format: "percent" },
    ],
  },
  {
    subject: MSFT,
    metrics: [
      { metric: "revenue", value_ref: RV_M, value_num: 245_000_000_000, format: "currency" },
      { metric: "gross_margin", value_ref: GM_M, value_num: 0.69, format: "percent" },
    ],
  },
];

test("buildPeerComparisonSealInput binds cell facts, sources, and subjects into the manifest", () => {
  const block = blockWith(TWO_PEERS);
  const input = buildPeerComparisonSealInput({
    block,
    facts: [RV_A, GM_A, RV_M, GM_M].map(factRow),
  });

  assert.equal(input.snapshot_id, SNAP);
  assert.deepEqual(input.manifest.fact_refs, [RV_A, GM_A, RV_M, GM_M]);
  assert.deepEqual(input.manifest.source_ids, [SRC]);
  assert.deepEqual(input.manifest.subject_refs, [
    { kind: "issuer", id: AAPL.id },
    { kind: "issuer", id: MSFT.id },
  ]);
  assert.deepEqual(input.sources, [SRC]);
  assert.equal(input.facts?.length, 4);
});

test("the assembled seal input passes the real snapshot verifier", async () => {
  const block = blockWith(TWO_PEERS);
  const input = buildPeerComparisonSealInput({
    block,
    facts: [RV_A, GM_A, RV_M, GM_M].map(factRow),
  });

  const result = await verifySnapshotSeal(input);
  assert.equal(result.ok, true, JSON.stringify(result.failures, null, 2));
  assert.deepEqual(result.failures, []);
});

test("a null gap cell contributes no fact_ref", () => {
  const peers: MaterializedPeer[] = [
    {
      subject: AAPL,
      metrics: [
        { metric: "revenue", value_ref: RV_A, value_num: 391_000_000_000, format: "currency" },
        { metric: "gross_margin", value_ref: GM_A, value_num: 0.46, format: "percent" },
      ],
    },
    {
      // MSFT lacks gross_margin → a null gap cell, so only its revenue fact is bound.
      subject: MSFT,
      metrics: [{ metric: "revenue", value_ref: RV_M, value_num: 245_000_000_000, format: "currency" }],
    },
  ];
  const block = blockWith(peers);
  const input = buildPeerComparisonSealInput({ block, facts: [RV_A, GM_A, RV_M].map(factRow) });

  assert.deepEqual(input.manifest.fact_refs, [RV_A, GM_A, RV_M]);
});

test("missing a fact row for a cell value_ref fails loudly", () => {
  const block = blockWith(TWO_PEERS);
  assert.throws(
    () => buildPeerComparisonSealInput({ block, facts: [RV_A, GM_A, RV_M].map(factRow) }), // GM_M missing
    /missing fact rows for value_refs.*000000000004/,
  );
});
