import test from "node:test";
import assert from "node:assert/strict";

import { runDeterministicSections } from "../src/section-runner.ts";
import { ANALYZE_PLAYBOOKS } from "../src/playbook.ts";
import type { QueryExecutor } from "../../evidence/src/types.ts";
import type { AnalystConsensusEnvelope } from "../../fundamentals/src/analyst-consensus.ts";
import type { IssuerSubjectRef } from "../../fundamentals/src/subject-ref.ts";

const SNAP = "11111111-1111-4111-a111-111111111111";
const AS_OF = "2026-06-04T00:00:00.000Z";
const PRIMARY: IssuerSubjectRef = { kind: "issuer", id: "22222222-2222-4222-a222-222222222222" };
const METRICS = [
  "analyst_count", "analyst_rating_strong_buy", "analyst_rating_buy", "analyst_rating_hold", "analyst_rating_sell",
  "analyst_rating_strong_sell", "price_target_low", "price_target_mean", "price_target_high", "price",
];

const ENVELOPE: AnalystConsensusEnvelope = {
  subject: PRIMARY, family: "analyst_consensus", analyst_count: 41, as_of: AS_OF,
  rating_distribution: {
    counts: { strong_buy: 14, buy: 17, hold: 8, sell: 1, strong_sell: 1 },
    contributor_count: 41, as_of: AS_OF, source_id: "00000000-0000-4000-a000-00000000000d",
  },
  price_target: { currency: "USD", low: 170, mean: 220.5, median: 215, high: 280, contributor_count: 38, as_of: AS_OF, source_id: "00000000-0000-4000-a000-0000000000aa" },
  estimates: [], coverage_warnings: [],
};

const QUOTE = {
  listing: { kind: "listing", id: "55555555-5555-4555-a555-555555555555" }, price: 214.5, prev_close: 210, change_abs: 4.5,
  change_pct: 0.02, session_state: "regular", as_of: "2026-06-04T19:55:00.000Z", delay_class: "eod", currency: "USD",
  source_id: "00000000-0000-4000-a000-0000000000bb",
};

function fakeDb(): QueryExecutor {
  let n = 0;
  const rowsFor = (text: string, v: unknown[] = []): Array<Record<string, unknown>> => {
    if (/from metrics/i.test(text)) {
      const keys = (v[0] as string[]) ?? [];
      return keys.filter((key) => METRICS.includes(key)).map((key) => ({ metric_key: key, metric_id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(METRICS.indexOf(key)).padStart(12, "0")}` }));
    }
    if (/insert into facts/i.test(text)) {
      return [{ fact_id: `fac00000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
        subject_kind: v[0], subject_id: v[1], metric_id: v[2], period_kind: v[3], period_start: v[4], period_end: v[5],
        fiscal_year: v[6], fiscal_period: v[7], value_num: v[8], value_text: v[9], unit: v[10], currency: v[11],
        scale: v[12], as_of: v[13], reported_at: v[14], observed_at: v[15], source_id: v[16], method: v[17],
        adjustment_basis: v[18], definition_version: v[19], verification_status: v[20], freshness_class: v[21],
        coverage_level: v[22], quality_flags: [], entitlement_channels: [], confidence: v[25], supersedes: null,
        superseded_by: null, invalidated_at: null, ingestion_batch_id: null, created_at: v[15], updated_at: v[15] }];
    }
    throw new Error(`unexpected query: ${text}`);
  };
  return {
    async query<R extends Record<string, unknown>>(text: string, params?: unknown[]) {
      const rows = rowsFor(text, params) as R[];
      return { rows, command: "", rowCount: rows.length, oid: 0, fields: [] };
    },
  };
}

test("an earnings_quality memo seals only its vendor-estimate sections; numerical sections come from the engine", async () => {
  const earningsQuality = ANALYZE_PLAYBOOKS.find((playbook) => playbook.playbook_id === "earnings_quality")!;
  const deps = {
    db: fakeDb(),
    consensus: { async find() { return ENVELOPE; } },
    price: { async findByIssuer() { return QUOTE as never; } },
    clock: () => new Date("2026-06-04T12:00:00.000Z"),
  };
  const seals = await runDeterministicSections(deps, { playbook: earningsQuality, primary: PRIMARY, snapshotId: SNAP, asOf: AS_OF });
  assert.deepEqual(seals.map((seal) => seal.blocks[0]!.kind), ["analyst_consensus", "price_target_range"]);
  assert.deepEqual(await runDeterministicSections(deps, { playbook: earningsQuality, primary: null, snapshotId: SNAP, asOf: AS_OF }), []);
});
