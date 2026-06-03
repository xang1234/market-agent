import test from "node:test";
import assert from "node:assert/strict";

import { emitPeerComparisonBlock } from "../src/metrics-comparison-emitter.ts";
import type { PeerSetResolver } from "../../fundamentals/src/peer-set-resolver.ts";
import type { MetricsComparisonBlock } from "../src/metrics-comparison-block-builder.ts";
import { verifySnapshotSeal } from "../../snapshot/src/snapshot-verifier.ts";
import {
  AS_OF,
  BLOCK_ID,
  fakeDb,
  PEER,
  PRIMARY,
  REV_PEER,
  REV_PRIMARY,
  resolver,
  SNAP,
  stats,
} from "./peer-comparison-fixtures.ts";

const OPTS = { clock: () => new Date("2025-01-15T12:00:00.000Z") };

test("emitPeerComparisonBlock composes the chain into a sealable peer_table block", async () => {
  const { db } = fakeDb();
  const result = await emitPeerComparisonBlock(
    { peers: resolver, stats, db, clock: OPTS.clock },
    { primary: PRIMARY, snapshotId: SNAP, blockId: BLOCK_ID, asOf: AS_OF, title: "Peers" },
  );

  assert.ok(result, "a block was emitted");
  const sealInput = result;
  // blocks[0] is the finalized metrics_comparison block; cast to inspect its
  // mc-specific fields (the seal input types it as the opaque VerifierBlock).
  const block = sealInput.blocks[0] as unknown as MetricsComparisonBlock;

  // Primary leads; the resolved peer follows.
  assert.deepEqual(block.subjects, [PRIMARY, PEER]);
  assert.deepEqual(block.primary_subject_ref, PRIMARY);
  assert.deepEqual(block.metrics, ["Revenue", "Gross Margin"]);
  assert.equal(block.snapshot_id, SNAP);
  assert.equal(block.title, "Peers");

  // Revenue cells reuse the existing facts; gross_margin cells are freshly minted.
  assert.equal(block.cells[0][0]?.value_ref, REV_PRIMARY);
  assert.equal(block.cells[1][0]?.value_ref, REV_PEER);
  assert.equal(block.cells[0][1]?.format, "46.0%");

  // Manifest binds all four cell facts.
  assert.equal(sealInput.manifest.fact_refs.length, 4);

  // The block declares a fact_binding per cell fact (what the web emitted-block
  // fixture mirrors) — one for each manifest fact_ref.
  const bindings = (block.data_ref.params?.fact_bindings ?? []) as ReadonlyArray<{ fact_id: string }>;
  assert.deepEqual(
    new Set(bindings.map((binding) => binding.fact_id)),
    new Set(sealInput.manifest.fact_refs),
  );
});

test("the emitted seal input passes the real snapshot verifier", async () => {
  const { db } = fakeDb();
  const result = await emitPeerComparisonBlock(
    { peers: resolver, stats, db, clock: OPTS.clock },
    { primary: PRIMARY, snapshotId: SNAP, blockId: BLOCK_ID, asOf: AS_OF },
  );
  assert.ok(result);

  const verification = await verifySnapshotSeal(result);
  assert.equal(verification.ok, true, JSON.stringify(verification.failures, null, 2));
});

test("emitPeerComparisonBlock returns null when the resolver finds no peers", async () => {
  const { db } = fakeDb();
  const noPeers: PeerSetResolver = { async resolvePeers() { return []; } };
  const result = await emitPeerComparisonBlock(
    { peers: noPeers, stats, db, clock: OPTS.clock },
    { primary: PRIMARY, snapshotId: SNAP, blockId: BLOCK_ID, asOf: AS_OF },
  );
  assert.equal(result, null);
});
