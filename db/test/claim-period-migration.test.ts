import assert from "node:assert/strict";
import test from "node:test";
import { dockerAvailable } from "./docker-pg.ts";
import { applyCanonicalSchema, applyMigration, catalogSnapshot, createDatabase, expectRejected, IDS, seedLegacyEvidence, startServer } from "./financial-migration-helpers.ts";

const DOCUMENT = "0f000000-0000-4000-8000-0000000000f1";

function claim(period: { kind: string | null; end: string | null; bound: string | null }): string {
  const literal = (value: string | null) => (value === null ? "null" : `'${value}'`);
  return `insert into claims (document_id, predicate, text_canonical, polarity, modality, reported_by_source_id, confidence, status, period_kind, period_end, period_bound_at)
          values ('${DOCUMENT}', 'management.explanation.gross_margin', 'Gross margin fell on an inventory charge.', 'negative', 'asserted',
                  '${IDS.publicSource}', 0.9, 'extracted', ${literal(period.kind)}, ${literal(period.end)}, ${literal(period.bound)})`;
}

test("0073 claim periods", { timeout: 300_000 }, async (t) => {
  if (!dockerAvailable()) {
    t.skip("Docker is required for migration coverage");
    return;
  }
  const server = await startServer(t, "claim-period-0073");
  const db = await createDatabase(t, server, "claim_period_0073");
  await applyCanonicalSchema(db);
  await seedLegacyEvidence(db);
  await db.query(
    `insert into documents (document_id, source_id, kind, content_hash, raw_blob_id) values ($1, $2, 'filing', 'hash-0073', 'sha256:0073')`,
    [DOCUMENT, IDS.publicSource],
  );
  const periods = async () =>
    (await db.query(`select period_kind, period_end::text, period_bound_at::text from claims order by period_end nulls first`)).rows;
  const BOUND = "2025-08-05 20:00:00+00";

  await t.test("a claim's period is a fiscal quarter or year, its end and when it was bound, all or none", async () => {
    await expectRejected(db, claim({ kind: null, end: "2025-06-28", bound: BOUND }), /claims_period_pair/);
    await expectRejected(db, claim({ kind: "fiscal_q", end: null, bound: BOUND }), /claims_period_pair/);
    await expectRejected(db, claim({ kind: "fiscal_q", end: "2025-06-28", bound: null }), /claims_period_pair/);
    await expectRejected(db, claim({ kind: null, end: null, bound: BOUND }), /claims_period_pair/);
    await expectRejected(db, claim({ kind: "ttm", end: "2025-06-28", bound: BOUND }), /claims_period_kind_check/);
    await db.query(claim({ kind: null, end: null, bound: null }));
    await db.query(claim({ kind: "fiscal_q", end: "2025-06-28", bound: BOUND }));
    await db.query(claim({ kind: "fiscal_y", end: "2025-12-27", bound: BOUND }));
    assert.deepEqual(await periods(), [
      { period_kind: null, period_end: null, period_bound_at: null },
      { period_kind: "fiscal_q", period_end: "2025-06-28", period_bound_at: BOUND },
      { period_kind: "fiscal_y", period_end: "2025-12-27", period_bound_at: BOUND },
    ]);
  });

  await t.test("a period is set once, from null; a bound claim's period never changes, and the claim can still be superseded", async () => {
    const LATER = "2025-11-04 21:00:00+00";
    const { rows: [unbound] } = await db.query(`${claim({ kind: null, end: null, bound: null })} returning claim_id`);
    const { rows: [bound] } = await db.query(`${claim({ kind: "fiscal_q", end: "2025-06-28", bound: BOUND })} returning claim_id`);
    const set = (id: string, kind: string | null, end: string | null, at: string | null) =>
      `update claims set period_kind = ${kind === null ? "null" : `'${kind}'`}, period_end = ${end === null ? "null" : `'${end}'`},
              period_bound_at = ${at === null ? "null" : `'${at}'`} where claim_id = '${id}'`;
    await db.query(set(unbound.claim_id, "fiscal_q", "2025-09-27", LATER));
    await expectRejected(db, set(bound.claim_id, "fiscal_q", "2025-09-27", LATER), /claims_period_bound_once/);
    await expectRejected(db, set(bound.claim_id, "fiscal_y", "2025-06-28", BOUND), /claims_period_bound_once/);
    await expectRejected(db, set(bound.claim_id, "fiscal_q", "2025-06-28", LATER), /claims_period_bound_once/);
    await expectRejected(db, set(bound.claim_id, null, null, null), /claims_period_bound_once/);
    await db.query(`update claims set superseded_at = now() where claim_id = $1`, [bound.claim_id]);
    const { rows } = await db.query(
      `select claim_id, period_kind, period_end::text, period_bound_at::text, superseded_at is not null as superseded
         from claims where claim_id = any($1::uuid[]) order by period_end`,
      [[unbound.claim_id, bound.claim_id]],
    );
    assert.deepEqual(rows, [
      { claim_id: bound.claim_id, period_kind: "fiscal_q", period_end: "2025-06-28", period_bound_at: BOUND, superseded: true },
      { claim_id: unbound.claim_id, period_kind: "fiscal_q", period_end: "2025-09-27", period_bound_at: LATER, superseded: false },
    ]);
    await db.query(`delete from claims where claim_id = any($1::uuid[])`, [[unbound.claim_id, bound.claim_id]]);
  });

  await t.test("down drops the period and keeps the claims; up rebuilds what the canonical schema defines, and reruns cleanly", async () => {
    const canonical = await catalogSnapshot(db);
    await applyMigration(db, "0073", "down");
    assert.equal((await db.query(`select count(*)::int as n from claims`)).rows[0].n, 3);
    assert.equal(
      (await db.query(`select count(*)::int as n from information_schema.columns where table_name = 'claims' and column_name in ('period_kind', 'period_end', 'period_bound_at')`)).rows[0].n,
      0,
    );
    assert.deepEqual(
      (await db.query(`select (select count(*)::int from pg_trigger where tgname = 'claims_period_bound_once') as triggers,
                              (select count(*)::int from pg_proc where proname = 'prevent_claim_period_rebinding') as functions`)).rows[0],
      { triggers: 0, functions: 0 },
    );
    await applyMigration(db, "0073", "up");
    await applyMigration(db, "0073", "up");
    assert.deepEqual(await catalogSnapshot(db), canonical);
    assert.deepEqual(await periods(), [
      { period_kind: null, period_end: null, period_bound_at: null },
      { period_kind: null, period_end: null, period_bound_at: null },
      { period_kind: null, period_end: null, period_bound_at: null },
    ]);
    await expectRejected(db, claim({ kind: "fiscal_q", end: "2025-06-28", bound: null }), /claims_period_pair/);
  });
});
