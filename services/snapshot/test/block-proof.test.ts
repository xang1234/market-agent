import assert from "node:assert/strict";
import test from "node:test";

import { comparisonProofKey, deriveBlockProof, UNPROVEN, type SealedSnapshotRecord } from "../src/block-proof.ts";

const SNAPSHOT: SealedSnapshotRecord = {
  fact_refs: ["00000000-0000-4000-8000-0000000000f1", "00000000-0000-4000-8000-0000000000f2"],
  claim_refs: ["00000000-0000-4000-8000-0000000000c1"],
  event_refs: [],
  document_refs: [],
  source_ids: ["00000000-0000-4000-8000-0000000000a1"],
  series_refs: ["00000000-0000-4000-8000-0000000000e1", "00000000-0000-4000-8000-0000000000e2"],
  checked_series_refs: ["00000000-0000-4000-8000-0000000000e1", "00000000-0000-4000-8000-0000000000e2"],
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
  for (const kind of ["line_chart", "segment_trajectory", "sentiment_trend", "mention_volume"]) {
    for (const params of [{ series_ref: SEALED }, { series_refs: [SEALED] }, { fact_bindings: [{ fact_id: FACT }] }]) {
      const chart = { kind, data_ref: { kind, id: "c", params }, series: drawn };
      assert.equal(deriveBlockProof(chart, SNAPSHOT).evidence, "unknown", `${kind} ${JSON.stringify(params)}`);
    }
  }
});

test("a price chart is source-linked when each drawn line has its own sealed series (#236)", () => {
  const [NVDA, AMD] = SNAPSHOT.series_refs;
  const line = (name: string) => ({ name, unit: "%", points: [{ x: "2026-01-02", y: 10 }] });
  const perf = (seriesRefs: string[], series?: unknown[]) => ({
    kind: "perf_comparison",
    data_ref: { kind: "perf_comparison", id: "p", params: { series_refs: seriesRefs } },
    source_refs: [SNAPSHOT.source_ids[0]],
    ...(series === undefined ? {} : { series }),
  });
  assert.deepEqual(deriveBlockProof(perf([NVDA, AMD], [line("NVDA"), line("AMD")]), SNAPSHOT), {
    evidence: "linked",
    calculation: "not_verified",
    public_by_cutoff: "unknown",
  });
  assert.equal(deriveBlockProof(perf([NVDA, NVDA], [line("NVDA"), line("AMD")]), SNAPSHOT).evidence, "unknown", "two lines, one series");
  assert.equal(deriveBlockProof(perf([NVDA], [line("NVDA"), line("AMD")]), SNAPSHOT).evidence, "unknown", "a line with no series");
  assert.equal(deriveBlockProof(perf([NVDA, "00000000-0000-4000-8000-0000000000e9"], [line("NVDA"), line("AMD")]), SNAPSHOT).evidence, "unknown", "an unsealed series");
  assert.equal(deriveBlockProof(perf([NVDA, AMD]), SNAPSHOT).evidence, "unknown", "live-rendered: no points");
  assert.equal(deriveBlockProof(perf([], []), SNAPSHOT).evidence, "unknown", "nothing drawn");
  assert.equal(
    deriveBlockProof(perf([NVDA, AMD], [line("NVDA"), line("AMD")]), { ...SNAPSHOT, checked_series_refs: [NVDA] }).evidence,
    "unknown",
    "a series sealed before the point check",
  );
});

test("prose citing a price return is source-linked only when its series was sealed with the point check (#317)", () => {
  const [NVDA, AMD] = SNAPSHOT.series_refs;
  const prose = {
    kind: "rich_text",
    source_refs: [SNAPSHOT.source_ids[0]],
    segments: [
      { type: "text", text: "NVDA returned " },
      { type: "ref", ref_kind: "series", ref_id: NVDA, format: "6.6%" },
      { type: "text", text: " and AMD " },
      { type: "ref", ref_kind: "series", ref_id: AMD, format: "3.58%" },
    ],
  };
  assert.deepEqual(deriveBlockProof(prose, SNAPSHOT), { evidence: "linked", calculation: "not_verified", public_by_cutoff: "unknown" });
  assert.equal(deriveBlockProof(prose, { ...SNAPSHOT, checked_series_refs: [NVDA] }).evidence, "unknown", "a series sealed before the point check");
  assert.equal(deriveBlockProof(prose, { ...SNAPSHOT, series_refs: [NVDA], checked_series_refs: [NVDA, AMD] }).evidence, "unknown", "a series the snapshot did not seal");
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

test("a scenario price comparison is source-linked, never a verified calculation, and only as its seal bound it while its certificate and sources stand; its link back follows the certificate alone (#224)", () => {
  const [PRICE_SOURCE] = SNAPSHOT.source_ids;
  const EPS_SOURCE = "00000000-0000-4000-8000-0000000000a2";
  const comparison = {
    scenario: { snapshot_id: "00000000-0000-4000-8000-0000000000d1", run_id: "run-1", unit_id: "unit-1", presentation_hash: "a".repeat(64) },
    outcome: { kind: "comparison", price: { observation_id: "00000000-0000-4000-8000-0000000000b1", source_id: PRICE_SOURCE } },
  };
  const block = (change: Record<string, unknown> = {}) =>
    ({ kind: "scenario_price_comparison", snapshot_id: "00000000-0000-4000-8000-0000000000e1", source_refs: [EPS_SOURCE, PRICE_SOURCE], comparison, ...change });
  const key = comparisonProofKey(block())!;
  const sealed = { ...SNAPSHOT, source_ids: [PRICE_SOURCE!, EPS_SOURCE], live_comparisons: [{ key, sources_public: true }] };
  const UNPROVEN_COMPARISON = { ...UNPROVEN, scenario_calculation: "not_verified" };
  const CERTIFIED_ONLY = { ...UNPROVEN, scenario_calculation: "verified" };
  assert.deepEqual(deriveBlockProof(block(), sealed), { evidence: "linked", calculation: "not_verified", public_by_cutoff: "unknown", scenario_calculation: "verified" });
  // The snapshot's certificate is the scenario's own run and unit, and still awards this block nothing verified.
  assert.equal(deriveBlockProof(block({ presentation_hash: "a".repeat(64), financial: { run_id: "run-1", unit_id: "unit-1" } }), sealed).calculation, "not_verified");
  assert.deepEqual(deriveBlockProof(block(), { ...sealed, live_comparisons: [] }), UNPROVEN_COMPARISON, "the certificate erased, or no seal bound it");
  assert.deepEqual(deriveBlockProof(block(), { ...sealed, live_comparisons: [{ key, sources_public: false }] }), CERTIFIED_ONLY, "a source no longer public");
  assert.deepEqual(deriveBlockProof(block(), { ...sealed, live_comparisons: undefined }), UNPROVEN_COMPARISON, "a view that did not check");
  const uncited = block({ source_refs: [EPS_SOURCE] });
  assert.deepEqual(deriveBlockProof(uncited, { ...sealed, live_comparisons: [{ key: comparisonProofKey(uncited)!, sources_public: true }] }), CERTIFIED_ONLY, "the price's source not cited");
  assert.deepEqual(deriveBlockProof(uncited, sealed), UNPROVEN_COMPARISON, "cited sources other than its seal bound");
  assert.deepEqual(deriveBlockProof(block({ as_of: "2024-06-10T13:00:00.000Z" }), sealed), UNPROVEN_COMPARISON, "any field of the block other than its seal bound");
  assert.deepEqual(deriveBlockProof(block(), { ...sealed, source_ids: [EPS_SOURCE] }), CERTIFIED_ONLY, "the price's source not sealed");
  assert.deepEqual(deriveBlockProof(block({ comparison: { ...comparison, outcome: { kind: "gap", reason: "price_coverage_missing" } } }), sealed), UNPROVEN_COMPARISON, "a gap shows no value");
  assert.deepEqual(deriveBlockProof(block(), null), UNPROVEN);
  const changed = { ...comparison, scenario: { ...comparison.scenario, presentation_hash: "b".repeat(64) } };
  assert.deepEqual(deriveBlockProof(block({ comparison: changed }), sealed), UNPROVEN_COMPARISON, "content other than what its seal bound");
  assert.deepEqual(deriveBlockProof(block({ snapshot_id: "00000000-0000-4000-8000-0000000000e2" }), sealed), UNPROVEN_COMPARISON, "another snapshot's binding");
  assert.equal(comparisonProofKey(block({ comparison: { ...comparison, scenario: { ...comparison.scenario, run_id: 1.5 } } })), null, "content that is no canonical JSON");
});

test("a Call claims nothing on read, however its snapshot is sealed (#604)", () => {
  // It cites only what its snapshot sealed, which would link any other block.
  const call = { kind: "call", data_ref: { kind: "call", id: "c", params: { fact_bindings: [{ fact_id: SNAPSHOT.fact_refs[0] }] } }, source_refs: SNAPSHOT.source_ids, call: { version: "call.v1" } };
  assert.equal(deriveBlockProof({ ...call, kind: "metrics_comparison" }, SNAPSHOT).evidence, "linked");
  assert.deepEqual(deriveBlockProof(call, SNAPSHOT), UNPROVEN);
});
