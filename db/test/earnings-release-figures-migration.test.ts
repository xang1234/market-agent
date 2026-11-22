import assert from "node:assert/strict";
import test from "node:test";
import { dockerAvailable } from "./docker-pg.ts";
import { applyCanonicalSchema, applyMigration, catalogSnapshot, createDatabase, IDS, seedLegacyEvidence, startServer } from "./financial-migration-helpers.ts";

const DOCUMENT = "0f000000-0000-4000-8000-0000000000f6";
const CANDIDATE = { kind: "result", metric: "revenue", basis: "gaap", low: 44.1e9, high: 44.1e9, quote: "Revenue was $44.1 billion." };

test("0086 earnings release figures", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for migration coverage");
    return;
  }
  const server = await startServer(t, "release-figures-0086");
  const db = await createDatabase(t, server, "release_figures_0086");
  await applyCanonicalSchema(db);
  await seedLegacyEvidence(db);
  await db.query(`insert into issuers (issuer_id, legal_name) values ($1, 'NVIDIA Corp')`, [IDS.issuer]);
  await db.query(
    `insert into documents (document_id, source_id, kind, content_hash, raw_blob_id) values ($1, $2, 'filing', 'hash-0086', 'sha256:0086')`,
    [DOCUMENT, IDS.publicSource],
  );
  const seedFigure = async () => {
    await db.query(`insert into earnings_release_quarters (document_id, issuer_id, quarter_end, filed_on) values ($1, $2, '2025-04-27', '2025-05-28') on conflict do nothing`, [DOCUMENT, IDS.issuer]);
    return (await db.query<{ figure_id: string }>(
      `insert into earnings_release_figures (document_id, kind, metric, basis, low, high, quote)
       values ($1, 'result', 'revenue', 'gaap', 44100000000, 44100000000, 'Revenue was $44.1 billion.') returning figure_id`,
      [DOCUMENT],
    )).rows[0]!.figure_id;
  };
  const queue = (figureId: string | null, factId: string | null = null) => db.query(
    `insert into fact_review_queue (candidate, reason, confidence, threshold, kind, status, reviewed_by, reviewed_at, release_figure_id, fact_id)
     values ($1::jsonb, 'basis not stated', 0.5, 0.8, 'release_figure', 'reviewed', 'reviewer', now(), $2, $3)`,
    [JSON.stringify(CANDIDATE), figureId, factId],
  );

  await t.test("a reviewed release figure names its figure and no fact; deleting its release clears the figure, not the review", async () => {
    const figureId = await seedFigure();
    await queue(figureId);
    await assert.rejects(queue(figureId, IDS.originalFact), /fact_review_queue_review_metadata_chk/);
    await assert.rejects(
      db.query(`insert into earnings_release_figures (document_id, kind, metric, basis, low, high, quote) values ($1, 'result', 'eps', 'gaap', 1, 2, 'EPS was $1.')`, [DOCUMENT]),
      /earnings_release_figures_check/,
    );
    await db.query(`delete from documents where document_id = $1`, [DOCUMENT]);
    assert.deepEqual(
      (await db.query(`select kind, release_figure_id from fact_review_queue where kind = 'release_figure'`)).rows,
      [{ kind: "release_figure", release_figure_id: null }],
    );
  });

  await t.test("down drops the figures and their reviews; up rebuilds what the canonical schema defines, and reruns cleanly", async () => {
    const canonical = await catalogSnapshot(db);
    await applyMigration(db, "0086", "down");
    assert.deepEqual(
      (await db.query(`select count(*)::int as n from information_schema.tables where table_name in ('earnings_release_quarters', 'earnings_release_figures')`)).rows,
      [{ n: 0 }],
    );
    assert.equal((await db.query(`select count(*)::int as n from fact_review_queue`)).rows[0].n, 0);
    await applyMigration(db, "0086", "up");
    await applyMigration(db, "0086", "up");
    assert.deepEqual(await catalogSnapshot(db), canonical);
  });
});
