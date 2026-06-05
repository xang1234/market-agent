import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { Pool } from "pg";

import { emitRevenueBarsBlock } from "../../analyze/src/revenue-bars-emitter.ts";
import { verifySnapshotSeal } from "../../snapshot/src/snapshot-verifier.ts";

// fra-ef24: end-to-end proof that the revenue_bars emitter produces a real,
// verifier-valid block from live quarterly revenue facts. Lives in dev-api
// because that's the service with `pg` (mirrors peer-comparison-run.integration).
//
// Income facts come from SEC ingestion (not the static db/seed), so this can't
// run against a bootstrapped empty schema — point it at a populated dev DB via
// REVENUE_BARS_E2E_DATABASE_URL to run it; it skips otherwise.
//   REVENUE_BARS_E2E_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54329/market_agent \
//     node --experimental-strip-types --test test/revenue-bars-run.integration.test.ts
const E2E_URL = process.env.REVENUE_BARS_E2E_DATABASE_URL;

test(
  "revenue_bars emitter yields a verifier-valid block from live quarterly facts",
  { skip: !E2E_URL, timeout: 120_000 },
  async (t: TestContext) => {
    const pool = new Pool({ connectionString: E2E_URL });
    const db = await pool.connect();
    t.after(async () => {
      db.release();
      await pool.end();
    });

    // Pick an issuer that already has >= 2 quarterly revenue facts.
    const issuer = (
      await db.query<{ subject_id: string }>(
        `select f.subject_id
           from facts f
           join metrics m on m.metric_id = f.metric_id
          where f.subject_kind = 'issuer'
            and m.metric_key = 'revenue'
            and f.period_kind = 'fiscal_q'
            and f.method = 'reported'
            and f.superseded_by is null
            and f.invalidated_at is null
          group by f.subject_id
         having count(*) >= 2
          limit 1`,
      )
    ).rows[0];
    if (!issuer) {
      t.skip("no issuer with >= 2 quarterly revenue facts");
      return;
    }

    const seal = await emitRevenueBarsBlock(
      { db },
      {
        primary: { kind: "issuer", id: issuer.subject_id },
        snapshotId: randomUUID(),
        blockId: "revenue_trend-1",
        asOf: "2026-06-04T00:00:00.000Z",
      },
    );
    assert.ok(seal, "a seal input was emitted");
    assert.equal(seal.blocks[0].kind, "revenue_bars");
    assert.ok(seal.manifest.fact_refs.length >= 2, "the manifest binds real revenue facts");

    const verification = await verifySnapshotSeal(seal);
    assert.equal(verification.ok, true, verification.ok ? "" : JSON.stringify(verification.failures, null, 2));
  },
);
