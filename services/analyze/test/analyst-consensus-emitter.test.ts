import test from "node:test";
import assert from "node:assert/strict";

import { emitAnalystConsensusBlock } from "../src/analyst-consensus-emitter.ts";
import { verifySnapshotSeal } from "../../snapshot/src/snapshot-verifier.ts";
import type { QueryExecutor } from "../../evidence/src/types.ts";
import type { ConsensusRepository } from "../../fundamentals/src/consensus-repository.ts";
import type { AnalystConsensusEnvelope } from "../../fundamentals/src/analyst-consensus.ts";
import type { IssuerSubjectRef } from "../../fundamentals/src/subject-ref.ts";

const SNAP = "11111111-1111-4111-a111-111111111111";
const SRC = "00000000-0000-4000-a000-00000000000d";
const PRIMARY: IssuerSubjectRef = { kind: "issuer", id: "22222222-2222-4222-a222-222222222222" };
const CLOCK = () => new Date("2026-06-04T12:00:00.000Z");
const INPUT = { primary: PRIMARY, snapshotId: SNAP, blockId: "analyst_overview-1", asOf: "2026-06-04T00:00:00.000Z" };

const METRIC_IDS: Record<string, string> = {
  analyst_count: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0001",
  analyst_rating_strong_buy: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0002",
  analyst_rating_buy: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0003",
  analyst_rating_hold: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0004",
  analyst_rating_sell: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0005",
  analyst_rating_strong_sell: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0006",
};

function envelope(): AnalystConsensusEnvelope {
  return {
    subject: PRIMARY, family: "analyst_consensus", analyst_count: 41, as_of: "2026-06-04T00:00:00.000Z",
    rating_distribution: {
      counts: { strong_buy: 14, buy: 17, hold: 8, sell: 1, strong_sell: 1 },
      contributor_count: 41, as_of: "2026-06-04T00:00:00.000Z", source_id: SRC,
    },
    price_target: null, estimates: [], coverage_warnings: [],
  };
}

function consensusRepo(env: AnalystConsensusEnvelope | null): ConsensusRepository {
  return { async find() { return env; } };
}

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
        const factId = `fac00000-0000-4000-8000-0000000000${(++n).toString(16).padStart(2, "0")}`;
        return { rows: [{
          fact_id: factId, subject_kind: v[0], subject_id: v[1], metric_id: v[2], period_kind: v[3],
          period_start: v[4], period_end: v[5], fiscal_year: v[6], fiscal_period: v[7], value_num: v[8],
          value_text: v[9], unit: v[10], currency: v[11], scale: v[12], as_of: v[13], reported_at: v[14],
          observed_at: v[15], source_id: v[16], method: v[17], adjustment_basis: v[18], definition_version: v[19],
          verification_status: v[20], freshness_class: v[21], coverage_level: v[22],
          quality_flags: JSON.parse((v[23] as string) ?? "[]"), entitlement_channels: JSON.parse((v[24] as string) ?? "[]"),
          confidence: v[25], supersedes: v[26] ?? null, superseded_by: null, invalidated_at: null,
          ingestion_batch_id: v[27] ?? null, created_at: v[15], updated_at: v[15],
        }] };
      }
      throw new Error(`unexpected query: ${text}`);
    },
  };
}

test("emitAnalystConsensusBlock builds a block that passes the real verifier", async () => {
  const seal = await emitAnalystConsensusBlock({ db: fakeDb(), consensus: consensusRepo(envelope()), clock: CLOCK }, INPUT);
  assert.ok(seal);
  assert.equal(seal.blocks[0].kind, "analyst_consensus");
  assert.equal(seal.manifest.fact_refs.length, 6);
  const verification = await verifySnapshotSeal(seal);
  assert.equal(verification.ok, true, verification.ok ? "" : JSON.stringify(verification.failures, null, 2));
});

test("emitAnalystConsensusBlock returns null when the envelope is null", async () => {
  const seal = await emitAnalystConsensusBlock({ db: fakeDb(), consensus: consensusRepo(null), clock: CLOCK }, INPUT);
  assert.equal(seal, null);
});

test("emitAnalystConsensusBlock returns null when rating_distribution is null", async () => {
  const env = { ...envelope(), rating_distribution: null };
  const seal = await emitAnalystConsensusBlock({ db: fakeDb(), consensus: consensusRepo(env), clock: CLOCK }, INPUT);
  assert.equal(seal, null);
});
