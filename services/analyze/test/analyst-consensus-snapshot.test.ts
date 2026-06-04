import test from "node:test";
import assert from "node:assert/strict";

import { buildAnalystConsensusBlock } from "../src/analyst-consensus-block-builder.ts";
import { buildAnalystConsensusSealInput } from "../src/analyst-consensus-snapshot.ts";
import type { MaterializedConsensus } from "../src/analyst-consensus-materializer.ts";
import type { FactRow } from "../../evidence/src/fact-repo.ts";
import type { IssuerSubjectRef } from "../../fundamentals/src/subject-ref.ts";

const SNAP = "11111111-1111-4111-a111-111111111111";
const SRC = "00000000-0000-4000-a000-00000000000d";
const PRIMARY: IssuerSubjectRef = { kind: "issuer", id: "22222222-2222-4222-a222-222222222222" };
const IDS = [1, 2, 3, 4, 5, 6].map((n) => `fac00000-0000-4000-8000-00000000000${n}`);

const materialized: MaterializedConsensus = {
  analyst_count_ref: IDS[0],
  analyst_count: 41,
  buckets: [
    { rating: "strong_buy", bucket: "Strong Buy", count: 14, count_ref: IDS[1] },
    { rating: "buy", bucket: "Buy", count: 17, count_ref: IDS[2] },
    { rating: "hold", bucket: "Hold", count: 8, count_ref: IDS[3] },
    { rating: "sell", bucket: "Sell", count: 1, count_ref: IDS[4] },
    { rating: "strong_sell", bucket: "Strong Sell", count: 1, count_ref: IDS[5] },
  ],
  factRows: [],
};

function factRow(id: string): FactRow {
  return {
    fact_id: id, subject_kind: "issuer", subject_id: PRIMARY.id, metric_id: id,
    period_kind: "point", period_start: null, period_end: "2026-06-04", fiscal_year: null,
    fiscal_period: null, value_num: 1, value_text: null, unit: "count", currency: null,
    scale: 1, as_of: "2026-06-04T00:00:00.000Z", reported_at: null,
    observed_at: "2026-06-04T12:00:00.000Z", source_id: SRC, method: "vendor",
    adjustment_basis: null, definition_version: 1, verification_status: "authoritative",
    freshness_class: "eod", coverage_level: "full", quality_flags: [],
    entitlement_channels: [], confidence: 1, supersedes: null, superseded_by: null,
    invalidated_at: null, ingestion_batch_id: null, created_at: "2026-06-04T12:00:00.000Z",
    updated_at: "2026-06-04T12:00:00.000Z",
  } as FactRow;
}

test("buildAnalystConsensusSealInput binds all 6 facts + the issuer subject", () => {
  const block = buildAnalystConsensusBlock({
    materialized,
    base: { id: "analyst_overview-1", snapshot_id: SNAP, as_of: "2026-06-04T00:00:00.000Z", source_refs: [SRC] },
  });
  const seal = buildAnalystConsensusSealInput({ block, facts: IDS.map(factRow), primary: PRIMARY });
  assert.deepEqual([...seal.manifest.fact_refs], IDS);
  assert.deepEqual([...seal.manifest.subject_refs], [{ kind: "issuer", id: PRIMARY.id }]);
  const bindings = (seal.blocks[0].data_ref.params?.fact_bindings ?? []) as ReadonlyArray<{ fact_id: string }>;
  assert.deepEqual(new Set(bindings.map((b) => b.fact_id)), new Set(IDS));
});
