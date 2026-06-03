import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { type TestContext } from "node:test";

import { Pool } from "pg";

import { ANALYZE_PLAYBOOKS } from "../../analyze/src/playbook.ts";
import { runDeterministicSections } from "../../analyze/src/section-runner.ts";
import { createSqlPeerSetResolver } from "../../fundamentals/src/peer-set-resolver.ts";
import {
  createSecBackedStatementRepository,
  createSecBackedStatsRepository,
} from "../../fundamentals/src/sec-facts-repository.ts";
import { SEC_EDGAR_FILING_SOURCE_ID } from "../../fundamentals/src/provider-sources.ts";
import { verifySnapshotSeal } from "../../snapshot/src/snapshot-verifier.ts";

// fra-clqb: end-to-end proof that the per-section run flow produces a real,
// verifier-valid metrics_comparison block from live fundamentals facts.
//
// The income facts come from SEC ingestion (not the static db/seed), so this
// can't run against a bootstrapped empty schema — point it at a populated dev DB
// via PEER_COMPARISON_E2E_DATABASE_URL to run it; it skips otherwise.
//   PEER_COMPARISON_E2E_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54329/market_agent \
//     node --experimental-strip-types --test test/peer-comparison-run.integration.test.ts
//
// Everything runs inside one transaction that is rolled back, so neither the
// industry edit nor the emitter's materialized derived facts touch the shared DB
// (the materializer expects the caller to own the transaction boundary).
const E2E_URL = process.env.PEER_COMPARISON_E2E_DATABASE_URL;
const E2E_INDUSTRY = "__peer_comparison_e2e__";

test(
  "peer_comparison run flow emits a verifier-valid metrics_comparison block from live facts",
  { skip: !E2E_URL, timeout: 120_000 },
  async (t: TestContext) => {
    const pool = new Pool({ connectionString: E2E_URL });
    const db = await pool.connect();
    t.after(async () => {
      await db.query("ROLLBACK");
      db.release();
      await pool.end();
    });
    await db.query("BEGIN");

    // Two issuers that already have revenue + gross_profit facts (so the stats
    // repo can materialize the comparison metrics).
    const candidates = (
      await db.query<{ issuer_id: string }>(
        `select i.issuer_id
           from issuers i
           join facts f on f.subject_id = i.issuer_id and f.subject_kind = 'issuer'
           join metrics m on m.metric_id = f.metric_id and m.metric_key in ('revenue', 'gross_profit')
          group by i.issuer_id
         having count(*) filter (where m.metric_key = 'revenue') > 0
            and count(*) filter (where m.metric_key = 'gross_profit') > 0
          order by i.issuer_id
          limit 2`,
      )
    ).rows;
    if (candidates.length < 2) {
      t.skip("need >= 2 issuers with revenue + gross_profit facts");
      return;
    }
    const [primaryId, peerId] = candidates.map((r) => r.issuer_id);

    // Align both to a private industry so they resolve as same-industry peers.
    // The surrounding transaction is rolled back, so this never persists.
    await db.query(`update issuers set industry = $2 where issuer_id = any($1::uuid[])`, [
      [primaryId, peerId],
      E2E_INDUSTRY,
    ]);

    const statements = createSecBackedStatementRepository(db, {
      fetcher: null,
      sourceId: SEC_EDGAR_FILING_SOURCE_ID,
    });
    const stats = createSecBackedStatsRepository(db, { statements, fetcher: null });
    const playbook = ANALYZE_PLAYBOOKS.find((p) => p.playbook_id === "peer_comparison")!;

    const seals = await runDeterministicSections(
      { db, peers: createSqlPeerSetResolver(db), stats },
      {
        playbook,
        primary: { kind: "issuer", id: primaryId },
        snapshotId: randomUUID(),
        asOf: "2026-06-03T00:00:00.000Z",
      },
    );

    assert.equal(seals.length, 1, "the peer_table section produced one seal input");
    assert.equal(
      (seals[0].blocks[0] as { kind: string }).kind,
      "metrics_comparison",
      "the section block is a metrics_comparison",
    );
    assert.ok(seals[0].manifest.fact_refs.length > 0, "the manifest binds real cell facts");

    const verification = await verifySnapshotSeal(seals[0]);
    assert.equal(
      verification.ok,
      true,
      verification.ok ? "" : JSON.stringify(verification.failures, null, 2),
    );
  },
);
