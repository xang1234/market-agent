import test from "node:test";
import assert from "node:assert/strict";

import { emitPriceTargetRangeBlock } from "../src/price-target-range-emitter.ts";
import { verifySnapshotSeal } from "../../snapshot/src/snapshot-verifier.ts";
import type { QueryExecutor } from "../../evidence/src/types.ts";
import type { ConsensusRepository } from "../../fundamentals/src/consensus-repository.ts";
import type { AnalystConsensusEnvelope } from "../../fundamentals/src/analyst-consensus.ts";
import type { CurrentPriceSource } from "../src/current-price-source.ts";
import type { IssuerSubjectRef } from "../../fundamentals/src/subject-ref.ts";

const SNAP = "11111111-1111-4111-a111-111111111111";
const SRC_T = "00000000-0000-4000-a000-0000000000aa";
const SRC_P = "00000000-0000-4000-a000-0000000000bb";
const PRIMARY: IssuerSubjectRef = { kind: "issuer", id: "22222222-2222-4222-a222-222222222222" };
const LISTING = { kind: "listing", id: "55555555-5555-4555-a555-555555555555" } as const;
const CLOCK = () => new Date("2026-06-04T12:00:00.000Z");
const INPUT = { primary: PRIMARY, snapshotId: SNAP, blockId: "price_targets-1", asOf: "2026-06-04T00:00:00.000Z" };

const METRIC_IDS: Record<string, string> = {
  price_target_low: "cccccccc-cccc-4ccc-8ccc-cccccccc0001",
  price_target_mean: "cccccccc-cccc-4ccc-8ccc-cccccccc0002",
  price_target_high: "cccccccc-cccc-4ccc-8ccc-cccccccc0003",
  price: "cccccccc-cccc-4ccc-8ccc-cccccccc0004",
};

function envelope(): AnalystConsensusEnvelope {
  return {
    subject: PRIMARY, family: "analyst_consensus", analyst_count: 41, as_of: "2026-06-04T00:00:00.000Z",
    rating_distribution: null,
    price_target: { currency: "USD", low: 170, mean: 220.5, median: 215, high: 280, contributor_count: 38, as_of: "2026-06-04T00:00:00.000Z", source_id: SRC_T },
    estimates: [], coverage_warnings: [],
  };
}
function consensusRepo(env: AnalystConsensusEnvelope | null): ConsensusRepository { return { async find() { return env; } }; }
function priceSource(quote: unknown): CurrentPriceSource { return { async findByIssuer() { return quote as never; } }; }
const QUOTE = { listing: LISTING, price: 214.5, prev_close: 210, change_abs: 4.5, change_pct: 0.02, session_state: "regular", as_of: "2026-06-04T19:55:00.000Z", delay_class: "eod", currency: "USD", source_id: SRC_P };

function fakeDb(): QueryExecutor {
  let n = 0;
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async query(text: string, params?: unknown[]): Promise<any> {
      if (/from metrics/i.test(text)) {
        const keys = (params?.[0] as string[]) ?? [];
        return { rows: keys.filter((k) => k in METRIC_IDS).map((k) => ({ metric_key: k, metric_id: METRIC_IDS[k] })) };
      }
      if (/insert into facts/i.test(text)) {
        const v = params ?? [];
        return { rows: [{ fact_id: `fac00000-0000-4000-8000-0000000000${(++n).toString(16).padStart(2, "0")}`,
          subject_kind: v[0], subject_id: v[1], metric_id: v[2], period_kind: v[3], period_start: v[4], period_end: v[5],
          fiscal_year: v[6], fiscal_period: v[7], value_num: v[8], value_text: v[9], unit: v[10], currency: v[11],
          scale: v[12], as_of: v[13], reported_at: v[14], observed_at: v[15], source_id: v[16], method: v[17],
          adjustment_basis: v[18], definition_version: v[19], verification_status: v[20], freshness_class: v[21],
          coverage_level: v[22], quality_flags: [], entitlement_channels: [], confidence: v[25], supersedes: null,
          superseded_by: null, invalidated_at: null, ingestion_batch_id: null, created_at: v[15], updated_at: v[15] }] };
      }
      throw new Error(`unexpected query: ${text}`);
    },
  };
}

test("emitPriceTargetRangeBlock seals a price_target_range + disclosure that passes the verifier", async () => {
  const seal = await emitPriceTargetRangeBlock({ db: fakeDb(), consensus: consensusRepo(envelope()), price: priceSource(QUOTE), clock: CLOCK }, INPUT);
  assert.ok(seal);
  assert.equal(seal.blocks[0].kind, "price_target_range");
  assert.equal(seal.blocks.length, 2);
  assert.equal((seal.blocks[1] as { kind: string }).kind, "disclosure");
  assert.equal(seal.manifest.fact_refs.length, 4);
  const verification = await verifySnapshotSeal(seal);
  assert.equal(verification.ok, true, verification.ok ? "" : JSON.stringify(verification.failures, null, 2));
});

test("emitPriceTargetRangeBlock returns null when no price_target or no quote", async () => {
  const noTarget = { ...envelope(), price_target: null };
  assert.equal(await emitPriceTargetRangeBlock({ db: fakeDb(), consensus: consensusRepo(noTarget), price: priceSource(QUOTE), clock: CLOCK }, INPUT), null);
  assert.equal(await emitPriceTargetRangeBlock({ db: fakeDb(), consensus: consensusRepo(envelope()), price: priceSource(null), clock: CLOCK }, INPUT), null);
});
