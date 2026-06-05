import test from "node:test";
import assert from "node:assert/strict";

import { runDeterministicSections } from "../src/section-runner.ts";
import { ANALYZE_PLAYBOOKS } from "../src/playbook.ts";
import type { QueryExecutor } from "../../evidence/src/types.ts";
import { AS_OF, fakeDb, PRIMARY, resolver, SNAP, stats } from "./peer-comparison-fixtures.ts";

const peerComparison = ANALYZE_PLAYBOOKS.find((p) => p.playbook_id === "peer_comparison")!;
const earningsQuality = ANALYZE_PLAYBOOKS.find((p) => p.playbook_id === "earnings_quality")!;
const CLOCK = () => new Date("2025-01-15T12:00:00.000Z");

test("runDeterministicSections emits a metrics_comparison seal input for peer_comparison", async () => {
  const { db } = fakeDb();
  const seals = await runDeterministicSections(
    { db: db as unknown as QueryExecutor, peers: resolver, stats, clock: CLOCK },
    { playbook: peerComparison, primary: PRIMARY, snapshotId: SNAP, asOf: AS_OF },
  );

  assert.equal(seals.length, 1);
  assert.equal((seals[0].blocks[0] as { kind: string }).kind, "metrics_comparison");
  assert.ok(seals[0].manifest.fact_refs.length > 0);
});

test("runDeterministicSections returns [] when the playbook has no deterministic sections", async () => {
  const { db } = fakeDb();
  const seals = await runDeterministicSections(
    { db: db as unknown as QueryExecutor, peers: resolver, stats },
    { playbook: earningsQuality, primary: PRIMARY, snapshotId: SNAP, asOf: AS_OF },
  );
  assert.deepEqual(seals, []);
});

test("runDeterministicSections skips peer_table when primary is null", async () => {
  const { db } = fakeDb();
  const seals = await runDeterministicSections(
    { db: db as unknown as QueryExecutor, peers: resolver, stats },
    { playbook: peerComparison, primary: null, snapshotId: SNAP, asOf: AS_OF },
  );
  assert.deepEqual(seals, []);
});
