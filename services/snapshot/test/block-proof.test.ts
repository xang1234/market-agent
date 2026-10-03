import assert from "node:assert/strict";
import test from "node:test";

import { deriveBlockProof, UNPROVEN, type SealedSnapshotRecord } from "../src/block-proof.ts";

const SNAPSHOT: SealedSnapshotRecord = {
  fact_refs: ["00000000-0000-4000-8000-0000000000f1", "00000000-0000-4000-8000-0000000000f2"],
  claim_refs: ["00000000-0000-4000-8000-0000000000c1"],
  event_refs: [],
  document_refs: [],
  source_ids: ["00000000-0000-4000-8000-0000000000a1"],
  series_refs: ["00000000-0000-4000-8000-0000000000e1"],
  certificates: [{ run_id: "run-1", unit_id: "unit-1", presentation_hash: "a".repeat(64) }],
};

const table = {
  kind: "metrics_comparison",
  data_ref: { kind: "metrics_comparison", id: "t", params: { fact_bindings: [{ fact_id: "00000000-0000-4000-8000-0000000000f1" }] } },
  cells: [[{ value_ref: "00000000-0000-4000-8000-0000000000f1", format: "$1B" }, { value_ref: "00000000-0000-4000-8000-0000000000f2", format: "2%" }]],
};
const certified = {
  kind: "financial_answer",
  presentation_hash: "a".repeat(64),
  financial: { run_id: "run-1", unit_id: "unit-1", presentation_version: "v1" },
};
const narrative = { kind: "rich_text", segments: [{ type: "text", text: "NVDA leads on margin." }] };

test("an ordinary source-linked table is linked but not a verified calculation (#193)", () => {
  assert.deepEqual(deriveBlockProof(table, SNAPSHOT), { evidence: "linked", calculation: "not_verified", public_by_cutoff: "unknown" });
});

test("a chart of literal points is never source-linked: nothing ties its points to the sealed series (#193)", () => {
  const SEALED = "00000000-0000-4000-8000-0000000000e1";
  const FACT = "00000000-0000-4000-8000-0000000000f1";
  const drawn = [{ name: "NVDA", points: [{ x: "2026-01-02", y: 999 }] }];
  for (const kind of ["line_chart", "perf_comparison", "segment_trajectory", "sentiment_trend", "mention_volume"]) {
    for (const params of [{ series_ref: SEALED }, { series_refs: [SEALED] }, { fact_bindings: [{ fact_id: FACT }] }]) {
      const chart = { kind, data_ref: { kind, id: "c", params }, series: drawn };
      assert.equal(deriveBlockProof(chart, SNAPSHOT).evidence, "unknown", `${kind} ${JSON.stringify(params)}`);
    }
  }
});

test("a table of literal cells is not source-linked by one binding elsewhere on it", () => {
  const literal = {
    kind: "table",
    data_ref: { kind: "table", id: "t", params: { fact_bindings: [{ fact_id: "00000000-0000-4000-8000-0000000000f1" }] } },
    columns: ["Metric", "Value"],
    rows: [["Revenue", "$1B"], ["Margin", "99%"]],
  };
  assert.equal(deriveBlockProof(literal, SNAPSHOT).evidence, "unknown");
});

test("a certified financial answer carries verified arithmetic and public-by-cutoff proof", () => {
  assert.deepEqual(deriveBlockProof(certified, SNAPSHOT), { evidence: "linked", calculation: "verified", public_by_cutoff: "proven" });
});

test("narrative beside a certified result inherits nothing", () => {
  assert.deepEqual(deriveBlockProof(narrative, SNAPSHOT), UNPROVEN, "no cited values: not even linked");
});

test("a forged status cannot upgrade a block", () => {
  // A status written into the block is ignored.
  const claimed = { ...narrative, proof: { evidence: "linked", calculation: "verified", public_by_cutoff: "proven" } };
  assert.deepEqual(deriveBlockProof(claimed, SNAPSHOT), UNPROVEN);
  // A financial answer without a matching certificate is not verified.
  assert.equal(deriveBlockProof({ ...certified, presentation_hash: "b".repeat(64) }, SNAPSHOT).calculation, "not_verified");
  assert.equal(deriveBlockProof({ ...certified, financial: { ...certified.financial, run_id: "run-2" } }, SNAPSHOT).public_by_cutoff, "unknown");
  // A cited value outside the sealed manifest, or one the seal cannot read, is not linked.
  assert.equal(deriveBlockProof({ ...table, cells: [[{ value_ref: "not-a-uuid" }]] }, SNAPSHOT).evidence, "unknown");
  const stray = { ...table, cells: [[{ value_ref: "00000000-0000-4000-8000-0000000000f9", format: "$1B" }]] };
  assert.equal(deriveBlockProof(stray, SNAPSHOT).evidence, "unknown");
});

test("a block without a sealed snapshot (legacy) claims nothing", () => {
  assert.deepEqual(deriveBlockProof(certified, null), UNPROVEN);
  assert.deepEqual(deriveBlockProof(table, null), UNPROVEN);
});
