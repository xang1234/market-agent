import test from "node:test";
import assert from "node:assert/strict";

import { buildRevenueBarsBlock } from "../src/revenue-bars-block-builder.ts";
import { buildRevenueBarsSealInput, type RevenueBarsFactRow } from "../src/revenue-bars-snapshot.ts";
import type { IssuerSubjectRef } from "../../fundamentals/src/subject-ref.ts";

const SNAP = "11111111-1111-4111-a111-111111111111";
const SRC = "00000000-0000-4000-a000-0000000000ed";
const PRIMARY: IssuerSubjectRef = { kind: "issuer", id: "22222222-2222-4222-a222-222222222222" };
const F1 = "f0000000-0000-4000-8000-000000000001";
const F2 = "f0000000-0000-4000-8000-000000000002";

function block() {
  return buildRevenueBarsBlock({
    base: { id: "revenue_trend-1", snapshot_id: SNAP, as_of: "2026-03-31T00:00:00.000Z", source_refs: [SRC] },
    facts: [
      { fact_id: F1, fiscal_year: 2025, fiscal_period: "Q1", value_num: 1_000_000_000, scale: 1, currency: "USD" },
      { fact_id: F2, fiscal_year: 2025, fiscal_period: "Q2", value_num: 2_000_000_000, scale: 1, currency: "USD" },
    ],
  });
}

function factRow(id: string, fp: string): RevenueBarsFactRow {
  return { fact_id: id, source_id: SRC, unit: "currency", period_kind: "fiscal_q", period_start: null, period_end: "2025-03-31", fiscal_year: 2025, fiscal_period: fp };
}

test("buildRevenueBarsSealInput binds every bar fact + the issuer subject", () => {
  const seal = buildRevenueBarsSealInput({
    block: block(),
    facts: [factRow(F1, "Q1"), factRow(F2, "Q2")],
    primary: PRIMARY,
  });

  assert.deepEqual([...seal.manifest.fact_refs], [F1, F2]);
  assert.deepEqual([...seal.manifest.subject_refs], [{ kind: "issuer", id: PRIMARY.id }]);
  const bindings = (seal.blocks[0].data_ref.params?.fact_bindings ?? []) as ReadonlyArray<{ fact_id: string }>;
  assert.deepEqual(new Set(bindings.map((b) => b.fact_id)), new Set([F1, F2]));
});

test("buildRevenueBarsSealInput throws when a bar fact row is missing", () => {
  assert.throws(
    () => buildRevenueBarsSealInput({ block: block(), facts: [factRow(F1, "Q1")], primary: PRIMARY }),
    /missing fact rows/,
  );
});
