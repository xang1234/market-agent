import test from "node:test";
import assert from "node:assert/strict";

import { materializePriceFact, mapDelayClassToFreshness } from "../src/price-fact-materializer.ts";
import { DELAY_CLASSES, type NormalizedQuote } from "../../market/src/quote.ts";
import type { QueryExecutor } from "../../evidence/src/types.ts";

const LISTING = { kind: "listing", id: "55555555-5555-4555-a555-555555555555" } as const;
const SRC = "00000000-0000-4000-a000-0000000000aa";
const PRICE_METRIC_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbb0001";
const CLOCK = () => new Date("2026-06-04T12:00:00.000Z");

function quote(overrides: Partial<NormalizedQuote> = {}): NormalizedQuote {
  return {
    listing: LISTING,
    price: 214.5,
    prev_close: 210,
    change_abs: 4.5,
    change_pct: 0.0214,
    session_state: "regular",
    as_of: "2026-06-04T19:55:00.000Z",
    delay_class: "delayed_15m",
    currency: "USD",
    source_id: SRC,
    ...overrides,
  };
}

function fakeDb() {
  const inserts: Array<Record<string, unknown>> = [];
  const db: QueryExecutor = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async query(text: string, params?: unknown[]): Promise<any> {
      if (/from metrics/i.test(text)) return { rows: [{ metric_id: PRICE_METRIC_ID }] };
      if (/insert into facts/i.test(text)) {
        const v = params ?? [];
        const row = {
          fact_id: "fac00000-0000-4000-8000-000000000001", subject_kind: v[0], subject_id: v[1],
          metric_id: v[2], period_kind: v[3], period_start: v[4], period_end: v[5], fiscal_year: v[6],
          fiscal_period: v[7], value_num: v[8], value_text: v[9], unit: v[10], currency: v[11],
          scale: v[12], as_of: v[13], reported_at: v[14], observed_at: v[15], source_id: v[16],
          method: v[17], adjustment_basis: v[18], definition_version: v[19], verification_status: v[20],
          freshness_class: v[21], coverage_level: v[22], quality_flags: [], entitlement_channels: [],
          confidence: v[25], supersedes: null, superseded_by: null, invalidated_at: null,
          ingestion_batch_id: null, created_at: v[15], updated_at: v[15],
        };
        inserts.push(row);
        return { rows: [row] };
      }
      throw new Error(`unexpected query: ${text}`);
    },
  };
  return { db, inserts };
}

test("materializePriceFact mints a listing-scoped vendor price fact carrying freshness", async () => {
  const { db, inserts } = fakeDb();
  const fact = await materializePriceFact(db, { quote: quote(), clock: CLOCK });
  assert.equal(inserts.length, 1);
  const row = inserts[0];
  assert.equal(row.subject_kind, "listing");
  assert.equal(row.subject_id, LISTING.id);
  assert.equal(row.metric_id, PRICE_METRIC_ID);
  assert.equal(row.period_kind, "point");
  assert.equal(row.period_end, "2026-06-04");
  assert.equal(row.value_num, 214.5);
  assert.equal(row.unit, "currency");
  assert.equal(row.currency, "USD");
  assert.equal(row.method, "vendor");
  assert.equal(row.freshness_class, "delayed_15m");
  assert.equal(row.source_id, SRC);
  // The returned row surfaces freshness (unlike the analyst lean row).
  assert.equal(fact.freshness_class, "delayed_15m");
});

test("mapDelayClassToFreshness maps every delay class", () => {
  assert.equal(mapDelayClassToFreshness("real_time"), "real_time");
  assert.equal(mapDelayClassToFreshness("delayed_15m"), "delayed_15m");
  assert.equal(mapDelayClassToFreshness("eod"), "eod");
  assert.equal(mapDelayClassToFreshness("unknown"), "stale");
  // Guard: the map covers every DelayClass value.
  assert.equal(DELAY_CLASSES.length, 4);
});

test("materializePriceFact throws when the price metric is not registered", async () => {
  const db: QueryExecutor = { async query() { return { rows: [] }; } };
  await assert.rejects(() => materializePriceFact(db, { quote: quote() }), /no metric_id registered/);
});
