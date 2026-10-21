import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { bootstrapDatabase, connectedClient, dockerAvailable, workspaceRoot } from "../../../db/test/docker-pg.ts";
import { emitAnalystConsensusBlock } from "../src/analyst-consensus-emitter.ts";
import { emitPriceTargetRangeBlock } from "../src/price-target-range-emitter.ts";
import { verifySnapshotSeal } from "../../snapshot/src/snapshot-verifier.ts";
import type { AnalystConsensusEnvelope } from "../../fundamentals/src/analyst-consensus.ts";
import { YAHOO_FINANCE_DEV_FUNDAMENTALS_SOURCE_ID } from "../../fundamentals/src/provider-sources.ts";
import type { IssuerSubjectRef } from "../../fundamentals/src/subject-ref.ts";
import { POLYGON_MARKET_SOURCE_ID } from "../../market/src/provider-sources.ts";
import { normalizedQuote } from "../../market/src/quote.ts";

const SNAP = "11111111-1111-4111-a111-111111111111";
const PRIMARY: IssuerSubjectRef = { kind: "issuer", id: "22222222-2222-4222-a222-222222222222" };
const AS_OF = "2026-10-01T00:00:00.000Z";
const CLOCK = () => new Date("2026-10-02T12:00:00.000Z");

const ENVELOPE: AnalystConsensusEnvelope = {
  subject: PRIMARY, family: "analyst_consensus", analyst_count: 20, as_of: AS_OF,
  rating_distribution: {
    counts: { strong_buy: 5, buy: 8, hold: 6, sell: 1, strong_sell: 0 },
    contributor_count: 20, as_of: AS_OF, source_id: YAHOO_FINANCE_DEV_FUNDAMENTALS_SOURCE_ID,
  },
  price_target: { currency: "USD", low: 90, mean: 120, median: 118, high: 150, contributor_count: 20, as_of: AS_OF, source_id: YAHOO_FINANCE_DEV_FUNDAMENTALS_SOURCE_ID },
  estimates: [], coverage_warnings: [],
};
const QUOTE = normalizedQuote({
  listing: { kind: "listing", id: "55555555-5555-4555-a555-555555555555" },
  price: 100, prev_close: 99, session_state: "regular",
  as_of: AS_OF, delay_class: "delayed_15m", currency: "USD", source_id: POLYGON_MARKET_SOURCE_ID,
});

test("earnings_quality vendor sections minted in Postgres pass the seal verifier (#421)", { skip: !dockerAvailable(), timeout: 120_000 }, async (t) => {
  const { databaseUrl } = await bootstrapDatabase(t, "analyze-vendor-seal");
  const db = await connectedClient(t, databaseUrl);
  await db.query(await readFile(join(workspaceRoot, "db", "seed", "metrics.sql"), "utf8"));
  await db.query(await readFile(join(workspaceRoot, "db", "seed", "sources.sql"), "utf8"));
  const consensus = { async find() { return ENVELOPE; } };
  const price = { async findByIssuer() { return QUOTE; } };
  const input = { primary: PRIMARY, snapshotId: SNAP, asOf: AS_OF };

  const sections = [
    { factCount: 6, seal: await emitAnalystConsensusBlock({ db, consensus, clock: CLOCK }, { ...input, blockId: "analyst_overview-1" }) },
    { factCount: 4, seal: await emitPriceTargetRangeBlock({ db, consensus, price, clock: CLOCK }, { ...input, blockId: "price_targets-1" }) },
  ];
  for (const { factCount, seal } of sections) {
    assert.ok(seal);
    const verification = await verifySnapshotSeal(seal);
    assert.equal(verification.ok, true, verification.ok ? "" : JSON.stringify(verification.failures, null, 2));
    const periodEnds = seal.blocks.flatMap((block) =>
      ((block.data_ref?.params?.fact_bindings ?? []) as Array<{ period_end: unknown }>).map((binding) => binding.period_end));
    assert.deepEqual(periodEnds, Array(factCount).fill("2026-10-01"));
  }
});
