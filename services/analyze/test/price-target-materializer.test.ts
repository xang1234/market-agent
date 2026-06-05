import test from "node:test";
import assert from "node:assert/strict";

import { materializePriceTargetFacts } from "../src/price-target-materializer.ts";
import type { QueryExecutor } from "../../evidence/src/types.ts";
import type { PriceTarget } from "../../fundamentals/src/analyst-consensus.ts";
import type { IssuerSubjectRef } from "../../fundamentals/src/subject-ref.ts";

const ISSUER: IssuerSubjectRef = { kind: "issuer", id: "22222222-2222-4222-a222-222222222222" };
const SRC = "00000000-0000-4000-a000-0000000000aa";
const CLOCK = () => new Date("2026-06-04T12:00:00.000Z");
const IDS: Record<string, string> = {
  price_target_low: "cccccccc-cccc-4ccc-8ccc-cccccccc0001",
  price_target_mean: "cccccccc-cccc-4ccc-8ccc-cccccccc0002",
  price_target_high: "cccccccc-cccc-4ccc-8ccc-cccccccc0003",
};

const priceTarget: PriceTarget = {
  currency: "USD", low: 170, mean: 220.5, median: 215, high: 280,
  contributor_count: 38, as_of: "2026-06-04T00:00:00.000Z", source_id: SRC,
};

function fakeDb() {
  const inserts: Array<Record<string, unknown>> = [];
  let n = 0;
  const db: QueryExecutor = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async query(text: string, params?: unknown[]): Promise<any> {
      if (/from metrics/i.test(text)) {
        const keys = (params?.[0] as string[]) ?? [];
        return { rows: keys.filter((k) => k in IDS).map((k) => ({ metric_key: k, metric_id: IDS[k] })) };
      }
      if (/insert into facts/i.test(text)) {
        const v = params ?? [];
        const row = { fact_id: `fac00000-0000-4000-8000-0000000000${(++n).toString(16).padStart(2, "0")}`,
          subject_kind: v[0], subject_id: v[1], metric_id: v[2], period_kind: v[3], period_start: v[4],
          period_end: v[5], fiscal_year: v[6], fiscal_period: v[7], value_num: v[8], value_text: v[9],
          unit: v[10], currency: v[11], scale: v[12], as_of: v[13], reported_at: v[14], observed_at: v[15],
          source_id: v[16], method: v[17], adjustment_basis: v[18], definition_version: v[19],
          verification_status: v[20], freshness_class: v[21], coverage_level: v[22], quality_flags: [],
          entitlement_channels: [], confidence: v[25], supersedes: null, superseded_by: null,
          invalidated_at: null, ingestion_batch_id: null, created_at: v[15], updated_at: v[15] };
        inserts.push(row);
        return { rows: [row] };
      }
      throw new Error(`unexpected query: ${text}`);
    },
  };
  return { db, inserts };
}

test("materializePriceTargetFacts mints 3 issuer vendor facts and returns refs+values", async () => {
  const { db, inserts } = fakeDb();
  const result = await materializePriceTargetFacts(db, { issuer: ISSUER, priceTarget, clock: CLOCK });
  assert.equal(result.factRows.length, 3);
  assert.equal(result.currency, "USD");
  assert.equal(result.low.value, 170);
  assert.equal(result.mean.value, 220.5);
  assert.equal(result.high.value, 280);
  assert.equal(result.low.ref, inserts[0].fact_id);
  for (const row of inserts) {
    assert.equal(row.subject_kind, "issuer");
    assert.equal(row.method, "vendor");
    assert.equal(row.unit, "currency");
    assert.equal(row.currency, "USD");
    assert.equal(row.source_id, SRC);
  }
  // Lean rows: no freshness surfaced (analyst opinion, not a market price).
  assert.equal("freshness_class" in result.factRows[0], false);
});
